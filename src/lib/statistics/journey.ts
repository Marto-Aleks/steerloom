import type { FlowBoard, FlowBoardSnapshot, FlowIssue } from '../../types'

/**
 * Where a status sits relative to the measured stages, using board order:
 *  - tracked: a selected column; its time counts.
 *  - paused: an unselected column between the first and last selected one
 *    (for example Blocked); its time does not count, but the item is still
 *    on its way and not finished.
 *  - before: left of the first selected column (To do, Backlog).
 *  - after: right of the last selected column (Testing, Done).
 *
 * Statuses that are not on the board use the provider's category: done is
 * after, to do is before, in progress is paused. Without a category they
 * count as after, as they always have.
 */
export type StageZone = 'tracked' | 'paused' | 'before' | 'after'

/**
 * A zone per status, plus whether the status itself means the work was
 * dropped (a "Won't do" column, which Trello and many Jira boards use instead
 * of a resolution).
 */
export type ZoneLookup = ((statusId: string) => StageZone) & {
  cancelled?: (statusId: string) => boolean
}

export function stageZoneLookup(
  board: FlowBoard,
  selectedColumnIds: string[],
): ZoneLookup {
  const selected = new Set(selectedColumnIds)
  const selectedIndexes = board.columns
    .map((column, index) => (selected.has(column.id) ? index : -1))
    .filter((index) => index >= 0)
  const first = Math.min(...selectedIndexes)
  const last = Math.max(...selectedIndexes)
  const zones = new Map<string, StageZone>()
  board.columns.forEach((column, index) => {
    const zone: StageZone = selected.has(column.id)
      ? 'tracked'
      : index < first
        ? 'before'
        : index > last
          ? 'after'
          : 'paused'
    column.statusIds.forEach((statusId) => {
      // A status in a selected column is tracked even if it also appears in
      // another column.
      if (zone === 'tracked' || !zones.has(statusId)) zones.set(statusId, zone)
    })
  })
  const categories = new Map(
    board.statuses.map((status) => [status.id, status.category]),
  )
  const lookup: ZoneLookup = (statusId) => {
    const zone = zones.get(statusId)
    if (zone) return zone
    if (!selectedIndexes.length) return 'before'
    const category = categories.get(statusId)
    return category === 'todo'
      ? 'before'
      : category === 'in-progress'
        ? 'paused'
        : 'after'
  }
  // Column names count too: a status may be absent while its column is not.
  const cancelledIds = new Set(
    [
      ...board.statuses,
      ...board.columns.flatMap((column) =>
        column.statusIds.map((id) => ({ id, name: column.name })),
      ),
    ]
      .filter(({ name }) => isCancelledResolution(name))
      .map(({ id }) => id),
  )
  lookup.cancelled = (statusId) => cancelledIds.has(statusId)
  return lookup
}

export type JourneyOutcome =
  /** Never reached a measured stage. */
  | 'never-entered'
  /** In a measured or paused stage now. */
  | 'active'
  /** Moved past the last measured stage. */
  | 'finished'
  /** Finished, but with a resolution that means it was not delivered. */
  | 'cancelled'
  /** Went back before the first measured stage. */
  | 'returned'
  /** Archived while still in progress (Trello). */
  | 'removed'

export interface JourneyVisit {
  enteredAt: string
  exitedAt: string
  durationDays: number
}

export interface IssueJourney {
  outcome: JourneyOutcome
  /** Days spent in measured stages, all visits included, up to the last event. */
  trackedDays: number
  /** First entry into a measured stage. */
  firstEntry: string
  /** When the item entered its current run of later stages (finished/cancelled). */
  finishedAt: string
  finishedTime: number
  /** Separate trips through the measured stages; more than one is rework. */
  journeys: number
  /** Passed the last measured stage at some point, then came back. */
  reopened: boolean
  /** Completed visits to measured stages, for evidence. */
  visits: JourneyVisit[]
  currentStatusId: string
}

export interface OrderedEvent {
  statusId: string
  enteredAt: string
  time: number
}

/** One item's way through the measured stages, from its ordered status events. */
export function issueJourney(
  issue: Pick<FlowIssue, 'archived' | 'resolution'>,
  events: OrderedEvent[],
  zoneOf: ZoneLookup,
): IssueJourney {
  let trackedMs = 0
  let firstEntry = ''
  let journeys = 0
  let reopened = false
  let wasAfterOnce = false
  let finishedAt = ''
  let finishedTime = Number.NaN
  const visits: JourneyVisit[] = []
  let visitStart = ''
  let visitMs = 0
  let runHasTracked = false
  let previousZone: StageZone | null = null

  events.forEach((event, index) => {
    const zone = zoneOf(event.statusId)
    const inRun = zone === 'tracked' || zone === 'paused'
    const wasInRun = previousZone === 'tracked' || previousZone === 'paused'
    if (inRun && !wasInRun) runHasTracked = false
    if (zone === 'tracked' && !runHasTracked) {
      runHasTracked = true
      journeys += 1
      if (wasAfterOnce) reopened = true
    }
    if (zone === 'after' && previousZone !== 'after') {
      finishedAt = event.enteredAt
      finishedTime = event.time
      if (firstEntry) wasAfterOnce = true
    }

    const next = events[index + 1]
    if (zone === 'tracked') {
      if (!firstEntry) firstEntry = event.enteredAt
      if (!visitStart) visitStart = event.enteredAt
      if (next && next.time >= event.time) {
        trackedMs += next.time - event.time
        visitMs += next.time - event.time
      }
    }
    if (visitStart && next && zoneOf(next.statusId) !== 'tracked') {
      visits.push({
        enteredAt: visitStart,
        exitedAt: next.enteredAt,
        durationDays: visitMs / 86_400_000,
      })
      visitStart = ''
      visitMs = 0
    }
    previousZone = zone
  })

  const current = events.at(-1)
  const currentZone = current ? zoneOf(current.statusId) : null
  const outcome: JourneyOutcome = !firstEntry
    ? 'never-entered'
    : currentZone === 'after'
      ? isCancelledResolution(issue.resolution) ||
        (current && zoneOf.cancelled?.(current.statusId))
        ? 'cancelled'
        : 'finished'
      : currentZone === 'before'
        ? 'returned'
        : issue.archived
          ? 'removed'
          : 'active'

  return {
    outcome,
    trackedDays: trackedMs / 86_400_000,
    firstEntry,
    finishedAt:
      outcome === 'finished' || outcome === 'cancelled' ? finishedAt : '',
    finishedTime:
      outcome === 'finished' || outcome === 'cancelled'
        ? finishedTime
        : Number.NaN,
    journeys,
    reopened,
    visits,
    currentStatusId: current?.statusId ?? '',
  }
}

/** Status events per issue, with valid times, oldest first. */
export function orderedEventsByIssue(
  snapshot: Pick<FlowBoardSnapshot, 'transitions'>,
  asOf = Number.POSITIVE_INFINITY,
): Map<string, OrderedEvent[]> {
  const byIssue = new Map<string, OrderedEvent[]>()
  snapshot.transitions.forEach((transition) => {
    const time = Date.parse(transition.enteredAt)
    if (!Number.isFinite(time) || time > asOf) return
    const events = byIssue.get(transition.issueId) ?? []
    events.push({
      statusId: transition.statusId,
      enteredAt: transition.enteredAt,
      time,
    })
    byIssue.set(transition.issueId, events)
  })
  byIssue.forEach((events) =>
    events.sort((left, right) => left.time - right.time),
  )
  return byIssue
}

/** Journeys for every issue in the snapshot, keyed by issue id. */
export function boardJourneys(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): Map<string, IssueJourney> {
  const zoneOf = stageZoneLookup(snapshot.board, selectedColumnIds)
  const events = orderedEventsByIssue(snapshot)
  return new Map(
    snapshot.issues.map((issue) => [
      issue.id,
      issueJourney(issue, events.get(issue.id) ?? [], zoneOf),
    ]),
  )
}

/**
 * Resolutions, and status or column names, that mean the work was closed
 * without being delivered. Matched case-insensitively as a whole name; any
 * other (Done, Fixed, …) counts as done.
 */
export const CANCELLED_RESOLUTIONS = [
  "won't do",
  "won't fix",
  'duplicate',
  'cannot reproduce',
  "can't reproduce",
  'declined',
  'rejected',
  'cancelled',
  'canceled',
  'abandoned',
  'obsolete',
  'invalid',
  'not a bug',
  'removed',
] as const

const cancelled = new Set<string>(CANCELLED_RESOLUTIONS)

export function isCancelledResolution(resolution: string | undefined): boolean {
  if (!resolution) return false
  return cancelled.has(
    resolution.trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' '),
  )
}
