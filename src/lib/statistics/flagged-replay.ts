import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import { uniqueIssuesByIdentity } from '../issue-identity'
import { calculateBoardMetrics, findDelayedWorkInProgress } from '.'
import { collectAgingWork } from './aging-work'
import { findReenteredWorkInProgress } from './focus-now'
import { issueJourney, orderedEventsByIssue, stageZoneLookup } from './journey'
import { filterBoardSnapshot, snapshotAtTime } from './snapshot-filter'

/*
 * Did flagging work? The briefing a week ago named the items past the usual
 * limit and the ones that came back into the flow. The board history says
 * what the briefing would have said then, and what happened to each item
 * since. Nothing is recorded: the past briefing is replayed from the same
 * rules at the earlier date, so this needs no action from anyone.
 */

export type FlaggedReason = 'late' | 'reentered'

export type FlaggedOutcome =
  /** Left the measured stages for good after the flag. */
  | 'finished'
  /** Changed column after the flag and is still in progress. */
  | 'moved'
  /** Same column as when it was flagged. */
  | 'waiting'
  /** Went back before the measured stages, was archived or cancelled. */
  | 'returned'

export interface FlaggedItemOutcome {
  item: string
  browseUrl?: string
  title?: string
  reason: FlaggedReason
  /** What the briefing said then, in the words it used. */
  flaggedAs: string
  outcome: FlaggedOutcome
  /** What happened since, in plain words. */
  detail: string
  /** Days from the flag to the first change of column, if there was one. */
  movedAfterDays: number | null
}

export interface FlaggedReplay {
  /** The date the earlier briefing is replayed at. */
  flaggedAt: string
  daysAgo: number
  items: FlaggedItemOutcome[]
  /** Items that changed column within QUICK_MOVE_DAYS of the flag. */
  movedQuickly: number
  limitThen: number | null
  limitNow: number | null
}

export const QUICK_MOVE_DAYS = 2
const DAY = 86_400_000

export function replayFlaggedItems(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  now: Date,
  daysAgo = 7,
): FlaggedReplay | null {
  if (!filters.selectedColumnIds.length) return null
  const nowTime = now.getTime()
  if (!Number.isFinite(nowTime)) return null
  const flagTime = nowTime - daysAgo * DAY
  if (!historyReaches(snapshot, flagTime)) return null
  const flaggedAt = new Date(flagTime).toISOString()
  const then = new Date(flagTime)

  // The briefing as it would have read then: same rules, earlier date.
  const past = snapshotAtTime(snapshot, flaggedAt)
  const pastWork = filterBoardSnapshot(past, { ...filters, windowDays: null })
  const limitThen =
    calculateBoardMetrics(
      filterBoardSnapshot(past, filters, then),
      filters.selectedColumnIds,
    )?.percentile85CycleTime ?? null
  const late = findDelayedWorkInProgress(
    pastWork,
    filters.selectedColumnIds,
    limitThen ?? Number.POSITIVE_INFINITY,
  ).sort((a, b) => b.ageInSelectedColumns - a.ageInSelectedColumns)
  const lateKeys = new Set(late.map(({ item }) => item))
  const reentered = findReenteredWorkInProgress(
    pastWork,
    filters.selectedColumnIds,
  ).filter(({ item }) => !lateKeys.has(item))
  if (!late.length && !reentered.length) return null

  // Where each item stands now.
  const work = filterBoardSnapshot(snapshot, { ...filters, windowDays: null })
  const zoneOf = stageZoneLookup(work.board, filters.selectedColumnIds)
  const columnOf = columnLookup(work, filters.selectedColumnIds)
  const eventsByIssue = orderedEventsByIssue(work)
  const ageNow = new Map(
    collectAgingWork(work, filters.selectedColumnIds).map((item) => [
      item.item,
      item.ageInSelectedColumns,
    ]),
  )
  const issuesByKey = new Map(
    uniqueIssuesByIdentity(work.issues).map((issue) => [issue.key, issue]),
  )
  const limitNow =
    calculateBoardMetrics(
      filterBoardSnapshot(snapshot, filters, now),
      filters.selectedColumnIds,
    )?.percentile85CycleTime ?? null

  const describe = (
    key: string,
    reason: FlaggedReason,
    flaggedAs: string,
  ): FlaggedItemOutcome | null => {
    const issue = issuesByKey.get(key)
    if (!issue) return null
    const events = eventsByIssue.get(issue.id) ?? []
    const journey = issueJourney(issue, events, zoneOf)
    const before = events.filter((event) => event.time <= flagTime)
    const columnThen = columnOf(before.at(-1)?.statusId ?? '')
    const firstMove = events.find(
      (event) =>
        event.time > flagTime && columnOf(event.statusId) !== columnThen,
    )
    const movedAfterDays = firstMove ? (firstMove.time - flagTime) / DAY : null
    const base = {
      item: issue.key,
      browseUrl: issue.browseUrl,
      ...(issue.title ? { title: issue.title } : {}),
      reason,
      flaggedAs,
      movedAfterDays,
    }
    if (
      (journey.outcome === 'finished' || journey.outcome === 'cancelled') &&
      journey.finishedTime > flagTime
    ) {
      const when = later((journey.finishedTime - flagTime) / DAY)
      return journey.outcome === 'finished'
        ? { ...base, outcome: 'finished', detail: `Finished ${when}` }
        : { ...base, outcome: 'returned', detail: `Cancelled ${when}` }
    }
    if (journey.outcome === 'returned')
      return {
        ...base,
        outcome: 'returned',
        detail: `Went back to ${columnOf(journey.currentStatusId)}`,
      }
    if (journey.outcome === 'removed')
      return {
        ...base,
        outcome: 'returned',
        detail: 'Archived while in progress',
      }
    const columnNow = columnOf(journey.currentStatusId)
    if (firstMove)
      return {
        ...base,
        outcome: 'moved',
        detail: `Moved to ${columnNow} ${later(movedAfterDays ?? 0)}`,
      }
    const age = ageNow.get(issue.key)
    return {
      ...base,
      outcome: 'waiting',
      detail:
        age === undefined
          ? `Still in ${columnNow}`
          : `Still in ${columnNow}, now ${days(age)}`,
    }
  }

  const items = [
    ...late.map(({ item, ageInSelectedColumns }) =>
      describe(
        item,
        'late',
        limitThen
          ? `${days(ageInSelectedColumns)} in progress, ${multiple(ageInSelectedColumns / limitThen)} the usual`
          : `${days(ageInSelectedColumns)} in progress`,
      ),
    ),
    ...reentered.map(({ item }) =>
      describe(item, 'reentered', 'Came back into the flow'),
    ),
  ].filter((item): item is FlaggedItemOutcome => item !== null)
  if (!items.length) return null

  return {
    flaggedAt,
    daysAgo,
    items,
    movedQuickly: items.filter(
      ({ movedAfterDays }) =>
        movedAfterDays !== null && movedAfterDays <= QUICK_MOVE_DAYS,
    ).length,
    limitThen,
    limitNow,
  }
}

function historyReaches(snapshot: FlowBoardSnapshot, time: number) {
  return snapshot.transitions.some((transition) => {
    const entered = Date.parse(transition.enteredAt)
    return Number.isFinite(entered) && entered < time
  })
}

/** Column name for a status, preferring a measured column when shared. */
function columnLookup(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): (statusId: string) => string {
  const byStatus = new Map<string, string>()
  snapshot.board.columns.forEach((column) => {
    const selected = selectedColumnIds.includes(column.id)
    column.statusIds.forEach((statusId) => {
      if (!byStatus.has(statusId) || selected)
        byStatus.set(statusId, column.name)
    })
  })
  const names = new Map(
    snapshot.board.statuses.map((status) => [status.id, status.name]),
  )
  return (statusId) => byStatus.get(statusId) ?? names.get(statusId) ?? statusId
}

function later(daysAfter: number) {
  if (daysAfter < 1) return 'the same day'
  if (daysAfter < 2) return 'the next day'
  return `${Math.round(daysAfter)} days later`
}

function days(value: number) {
  const rounded = value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return `${rounded} ${value === 1 ? 'day' : 'days'}`
}

function multiple(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`
}
