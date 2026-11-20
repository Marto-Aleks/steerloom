import type {
  FlowBoardSnapshot,
  SprintItemRecord,
  SprintRecord,
} from '../../types'
import { buildJiraFilter, type FocusSignal } from './focus-now'
import { percentile } from './index'

/*
 * Scrum boards: will the running sprint land, what changed in it, what keeps
 * rolling over, what the last sprints finished, and whether the team's points
 * predict time. Item-level, never per person. Every number comes from the
 * board's own history: sprint membership is rebuilt from the Sprint field's
 * changes, finishing means reaching the board's last column.
 */

const DAY = 86_400_000
/**
 * Items in the sprint by the end of its first day count as planned: teams
 * often start the sprint, then finish planning or close the last one.
 */
const PLAN_GRACE = DAY
/** Finished items the forecast learns from. */
const SAMPLE_DAYS = 90
/** A chance at or above this reads "on track". */
export const LIKELY = 0.7
const HISTORY_SPRINTS = 5
/** Finished items with an estimate needed to say whether points predict time. */
const POINTS_SAMPLE = 15

/** open: in progress, when there is too little history to forecast. */
export type SprintItemState = 'done' | 'track' | 'risk' | 'todo' | 'open'

/** An item as a sprint list shows it: key, title on hover, link. */
export interface SprintRef {
  key: string
  title?: string
  browseUrl?: string
  points?: number
}

export interface SprintItemView extends SprintRef {
  state: SprintItemState
  /** Chance of reaching the last column by the sprint's end, 0 to 1. */
  chance?: number
  /** Where it sits now, and why it matters: "In progress · 3rd sprint". */
  status: string
  /** Sprints it has been in, this one included. */
  sprints: number
  /** The earlier sprints it rolled over from, by name where known. */
  carriedFrom: string[]
  added: boolean
  /** Days in the measured stages so far, when started. */
  ageDays?: number
}

export interface ActiveSprintView {
  sprint: SprintRecord
  /** Day of the sprint and how many it has, in calendar days like every
   * other number in Steerloom: day 1 is the day it started. */
  day: number
  days: number
  items: SprintItemView[]
  /** Done plus on track. */
  likely: number
  /** At least this many finish, with 85% confidence. */
  atLeast: number
  /** Finished items the forecast learned from; 0 means no forecast. */
  sample: number
  /** Items finished in the last 90 days, forecast or not. */
  finishedRecently: number
  points?: {
    likely: number
    total: number
    atRisk: number
    unestimated: number
  }
  planned: SprintRef[]
  added: SprintRef[]
  removed: SprintRef[]
}

export interface ClosedSprintView {
  sprint: SprintRecord
  planned: SprintRef[]
  finished: SprintRef[]
  notFinished: SprintRef[]
  added: SprintRef[]
  /** Planned items no longer in the sprint at its end. */
  removed: SprintRef[]
  /** Of the removed: put into a later sprint. The rest went to the backlog. */
  movedOn: SprintRef[]
  /**
   * Work that did not finish here and continued in a later sprint, however
   * it got there: Jira moved it when the sprint was completed, or someone
   * took it out and put it in the next one. This is what "carried over"
   * means; work taken out for good is not in it.
   */
  carriedOver: SprintRef[]
  /** Planned items that finished: the say/do numerator. */
  finishedPlanned: number
  /** Points in the plan on its first day. */
  plannedPoints: number
  /** Points finished, added work included: the sprint's velocity. */
  finishedPoints: number
}

export interface PlanningView {
  sprint: SprintRecord
  /** What the next sprint holds now, with each item's estimate. */
  items: SprintRef[]
  planned: number
  unestimated: number
  low: number
  high: number
  usual: number
  sprints: number
}

export interface PointsTimeView {
  verdict: 'yes' | 'partly' | 'no'
  rows: Array<{
    points: number
    items: number
    from: number
    to: number
    median: number
  }>
  items: number
  /** Estimates at or below this are "small". */
  smallUpTo: number
  smallMedian: number
  largeMedian: number
}

export interface SprintBriefing {
  unit: 'points' | 'items'
  unavailable?: 'permission'
  active?: ActiveSprintView
  history: ClosedSprintView[]
  planning?: PlanningView
  /** Why there is no planning check, in one line, when there is none. */
  planningGap?: string
  pointsTime?: PointsTimeView
  /** Points boards without the check: how many estimated items finished. */
  pointsTimeGap?: { estimated: number; needed: number }
  signals: FocusSignal[]
}

export function buildSprintBriefing(
  snapshot: FlowBoardSnapshot,
): SprintBriefing | undefined {
  const data = snapshot.sprints
  if (!data) return undefined
  const unit = data.estimate.kind
  if (data.unavailable)
    return { unit, unavailable: data.unavailable, history: [], signals: [] }
  const now = Date.parse(snapshot.loadedAt)
  const board = boardModel(snapshot)
  /** When the plan is read: the first day after the sprint really started. */
  const planFrom = (sprint: SprintRecord) => {
    const start = Math.max(
      Date.parse(sprint.startAt ?? '') || 0,
      Date.parse(sprint.activatedAt ?? '') || 0,
    )
    const end = Date.parse(sprint.completedAt ?? sprint.endAt ?? '') || now
    return Math.min(start + PLAN_GRACE, end, now)
  }
  const records = new Map(
    data.items
      .filter((record) => board.issues.has(record.issueId))
      .map((record) => [record.issueId, record]),
  )
  const names = new Map(data.sprints.map((s) => [s.id, s.name]))
  const future = new Set(
    data.sprints.filter((s) => s.state === 'future').map((s) => s.id),
  )
  const ref = (issueId: string, at = now): SprintRef => {
    const issue = board.issues.get(issueId)!
    const points = pointsAt(records.get(issueId), at)
    return {
      key: issue.key,
      ...(issue.title ? { title: issue.title } : {}),
      ...(issue.browseUrl ? { browseUrl: issue.browseUrl } : {}),
      ...(points !== null ? { points } : {}),
    }
  }
  const membersAt = (sprintId: string, at: number) =>
    [...records.values()]
      .filter(
        (record) =>
          Date.parse(board.issues.get(record.issueId)!.createdAt) <= at &&
          sprintsAt(record, at).includes(sprintId),
      )
      .map((record) => record.issueId)

  const startedAt = (sprint: SprintRecord) =>
    Math.max(
      Date.parse(sprint.startAt ?? '') || 0,
      Date.parse(sprint.activatedAt ?? '') || 0,
    )
  /** Every sprint the item is or ever was in, from its field and its history. */
  const everIn = (issueId: string) => {
    const record = records.get(issueId)
    return new Set([
      ...(record?.sprintIds ?? []),
      ...(record?.sprintChanges ?? []).flatMap((change) => [
        ...change.from,
        ...change.to,
      ]),
    ])
  }

  const history = data.sprints
    .filter((sprint) => sprint.state === 'closed' && sprint.startAt)
    .slice(-HISTORY_SPRINTS)
    .map((sprint): ClosedSprintView => {
      const start = planFrom(sprint)
      const end = Date.parse(sprint.completedAt ?? sprint.endAt ?? '') || now
      const planned = membersAt(sprint.id, start)
      const atEnd = membersAt(sprint.id, end)
      const finished = atEnd.filter((id) => board.doneAt(id, end))
      const plannedSet = new Set(planned)
      const endSet = new Set(atEnd)
      // The running and the planned sprints come after any closed one; a
      // closed sprint comes after when it started later.
      const later = new Set(
        data.sprints
          .filter(
            (other) =>
              other.id !== sprint.id &&
              (other.state !== 'closed' ||
                startedAt(other) > startedAt(sprint)),
          )
          .map((other) => other.id),
      )
      const wentOn = (id: string) =>
        [...everIn(id)].some((sprintId) => later.has(sprintId))
      const removed = planned.filter((id) => !endSet.has(id))
      // The three ways unfinished work leaves a sprint: Jira moves it on
      // when the sprint is completed (it stays in this sprint too), someone
      // takes it out and adds it to the next sprint, or someone takes it out
      // for good. The first two are carry-over, whichever the team does.
      const carriedOver = [
        ...atEnd.filter((id) => !board.doneAt(id, end)),
        ...removed.filter((id) => !board.doneAt(id, end)),
      ].filter(wentOn)
      return {
        sprint,
        planned: planned.map((id) => ref(id, start)),
        finished: finished.map((id) => ref(id, end)),
        notFinished: atEnd
          .filter((id) => !board.doneAt(id, end))
          .map((id) => ref(id, end)),
        added: atEnd
          .filter((id) => !plannedSet.has(id))
          .map((id) => ref(id, end)),
        removed: removed.map((id) => ref(id, end)),
        movedOn: removed.filter(wentOn).map((id) => ref(id, end)),
        carriedOver: carriedOver.map((id) => ref(id, end)),
        finishedPlanned: finished.filter((id) => plannedSet.has(id)).length,
        plannedPoints: planned.reduce(
          (sum, id) => sum + (pointsAt(records.get(id), start) ?? 0),
          0,
        ),
        finishedPoints: finished.reduce(
          (sum, id) => sum + (pointsAt(records.get(id), end) ?? 0),
          0,
        ),
      }
    })

  const sample = board.sample(now)
  const pointsTime =
    unit === 'points' ? pointsTimeView(sample, records, board) : undefined
  const sized =
    pointsTime && pointsTime.verdict !== 'no' ? pointsTime : undefined

  const running = data.sprints.find((sprint) => sprint.state === 'active')
  const active = running ? activeView(running) : undefined

  function activeView(sprint: SprintRecord): ActiveSprintView {
    const start = Date.parse(sprint.startAt ?? '') || now
    const end = Date.parse(sprint.endAt ?? '') || now
    const current = [...records.values()]
      .filter((record) => record.sprintIds.includes(sprint.id))
      .map((record) => record.issueId)
    const planned = membersAt(sprint.id, planFrom(sprint))
    const plannedSet = new Set(planned)
    const currentSet = new Set(current)
    const left = Math.max(0, (end - now) / DAY)
    const forecast = sample.length >= 5
    const items = current.map((issueId): SprintItemView => {
      const record = records.get(issueId)!
      const points = pointsAt(record, now)
      const stage = board.stageNow(issueId)
      const sprints = record.sprintIds.filter((id) => !future.has(id)).length
      const added = !plannedSet.has(issueId)
      const age = stage === 'active' ? board.age(issueId, now) : undefined
      const learnFrom = sizedSample(sample, sized, points)
      const chance =
        stage === 'done' || !forecast
          ? undefined
          : stage === 'active'
            ? chanceStarted(learnFrom, age ?? 0, left)
            : chanceNotStarted(learnFrom, left)
      // Without a forecast nothing is called on track or at risk.
      const state: SprintItemState =
        stage === 'done'
          ? 'done'
          : chance === undefined
            ? stage === 'todo'
              ? 'todo'
              : 'open'
            : chance >= LIKELY
              ? 'track'
              : stage === 'todo'
                ? 'todo'
                : 'risk'
      const detail =
        stage === 'done'
          ? undefined
          : sprints >= 2
            ? `${ordinal(sprints)} sprint`
            : added
              ? `added on day ${dayAdded(record, sprint)}`
              : age !== undefined
                ? formatDays(age)
                : undefined
      return {
        ...ref(issueId),
        state,
        ...(chance !== undefined ? { chance } : {}),
        status: [board.columnName(issueId), detail].filter(Boolean).join(' · '),
        sprints,
        carriedFrom: record.sprintIds
          .filter((id) => id !== sprint.id && !future.has(id))
          .map((id) => names.get(id) ?? 'an earlier sprint'),
        added,
        ...(age !== undefined && stage !== 'done' ? { ageDays: age } : {}),
      }
    })
    const order: Record<SprintItemState, number> = {
      done: 0,
      track: 1,
      open: 2,
      risk: 3,
      todo: 4,
    }
    items.sort(
      (a, b) =>
        order[a.state] - order[b.state] || (b.chance ?? 1) - (a.chance ?? 1),
    )
    const done = items.filter((item) => item.state === 'done').length
    const likely = forecast
      ? items.filter((item) => item.state === 'done' || item.state === 'track')
          .length
      : done
    const open = items.filter((item) => item.state !== 'done')
    const atLeast =
      done +
      confidentAtLeast(
        open.map((item) => item.chance ?? (item.state === 'track' ? 0.9 : 0)),
        0.85,
      )
    const pointsOf = (list: SprintItemView[]) =>
      list.reduce((sum, item) => sum + (item.points ?? 0), 0)
    return {
      sprint,
      day: Math.min(sprintDay(start, now), sprintLength(start, end)),
      days: sprintLength(start, end),
      items,
      likely,
      // Never above the headline: several items at 50–69% can make a higher
      // count 85% safe, but the card must not read "3 likely, at least 4".
      atLeast: forecast ? Math.min(atLeast, likely) : done,
      sample: forecast ? sample.length : 0,
      finishedRecently: sample.length,
      ...(unit === 'points'
        ? {
            points: {
              likely: pointsOf(
                items.filter((i) => i.state === 'done' || i.state === 'track'),
              ),
              total: pointsOf(items),
              atRisk: pointsOf(
                items.filter((i) => i.state === 'risk' || i.state === 'todo'),
              ),
              unestimated: items.filter((i) => i.points === undefined).length,
            },
          }
        : {}),
      planned: planned.map((id) => ref(id, start)),
      added: current.filter((id) => !plannedSet.has(id)).map((id) => ref(id)),
      removed: planned.filter((id) => !currentSet.has(id)).map((id) => ref(id)),
    }
  }

  const next = data.sprints.find((sprint) => sprint.state === 'future')
  const counted = history.filter((view) => view.planned.length)
  const done = counted.map((view) =>
    unit === 'points' ? view.finishedPoints : view.finished.length,
  )
  const queued = next
    ? [...records.values()]
        .filter((record) => record.sprintIds.includes(next.id))
        .map((record) => record.issueId)
    : []
  const planning: PlanningView | undefined =
    next && queued.length && done.length >= 3
      ? {
          sprint: next,
          items: queued.map((id) => ref(id)),
          planned:
            unit === 'points'
              ? queued.reduce(
                  (sum, id) => sum + (pointsAt(records.get(id), now) ?? 0),
                  0,
                )
              : queued.length,
          unestimated:
            unit === 'points'
              ? queued.filter((id) => pointsAt(records.get(id), now) === null)
                  .length
              : 0,
          low: Math.min(...done),
          high: Math.max(...done),
          usual: Math.round(percentile(done, 50)),
          sprints: done.length,
        }
      : undefined
  const planningGap = planning
    ? undefined
    : !next
      ? 'Create the next sprint in Jira to check its plan against what the team usually finishes.'
      : !queued.length
        ? `${next.name} has no items yet.`
        : `This compares with the last 3 finished sprints; ${done.length ? `${done.length} found so far` : 'none found yet'}.`
  const estimated = sample.filter(
    (point) => typeof point.points === 'number',
  ).length

  return {
    unit,
    ...(active ? { active } : {}),
    history,
    ...(planning ? { planning } : { planningGap }),
    ...(pointsTime ? { pointsTime } : {}),
    ...(unit === 'points' && !pointsTime
      ? { pointsTimeGap: { estimated, needed: POINTS_SAMPLE } }
      : {}),
    signals: active ? sprintSignals(active, board.p85(sample)) : [],
  }
}

/* ---------------------------------------------------------------------------
 * The board: columns, finishing, ages and the finished sample.
 * ------------------------------------------------------------------------- */

function boardModel(snapshot: FlowBoardSnapshot) {
  const columns = snapshot.board.columns
  const columnIndex = new Map<string, number>()
  columns.forEach((column, index) =>
    column.statusIds.forEach((status) => columnIndex.set(status, index)),
  )
  const category = new Map(
    snapshot.board.statuses.map((status) => [status.id, status.category]),
  )
  const last = columns.length - 1
  // Parts and containers of other work are not sprint items.
  const issues = new Map(
    snapshot.issues
      .filter((issue) => !issue.hierarchy)
      .map((issue) => [issue.id, issue]),
  )
  const moves = new Map<string, Array<{ statusId: string; at: number }>>()
  for (const transition of snapshot.transitions) {
    const list = moves.get(transition.issueId) ?? []
    list.push({
      statusId: transition.statusId,
      at: Date.parse(transition.enteredAt),
    })
    moves.set(transition.issueId, list)
  }
  for (const list of moves.values()) list.sort((a, b) => a.at - b.at)
  const statusAt = (issueId: string, at: number) =>
    moves
      .get(issueId)
      ?.filter((move) => move.at <= at)
      .at(-1)?.statusId
  // Sprint terms, as Jira's sprint report: done is the board's last column,
  // not started is its first; the flow briefing's measured stages do not
  // matter here.
  const isDone = (statusId: string | undefined) =>
    statusId !== undefined &&
    (columnIndex.has(statusId)
      ? columnIndex.get(statusId) === last
      : category.get(statusId) === 'done')
  const isWaiting = (statusId: string | undefined) =>
    statusId === undefined ||
    (columnIndex.has(statusId)
      ? columnIndex.get(statusId) === 0
      : category.get(statusId) === 'todo')
  /**
   * When the latest attempt started: the first move out of the first column
   * after the item last sat there. Work that went back to the backlog and
   * was picked up again counts from the pick-up, not from months before.
   */
  const startedAt = (issueId: string, before = Infinity) => {
    const list = (moves.get(issueId) ?? []).filter((move) => move.at <= before)
    let from = 0
    list.forEach((move, index) => {
      if (isWaiting(move.statusId)) from = index + 1
    })
    return list
      .slice(from)
      .find((move) => !isWaiting(move.statusId) && !isDone(move.statusId))?.at
  }
  /** When it reached the last column for good. */
  const finishedAt = (issueId: string) => {
    const list = moves.get(issueId) ?? []
    if (!isDone(list.at(-1)?.statusId)) return undefined
    let index = list.length - 1
    while (index > 0 && isDone(list[index - 1]!.statusId)) index--
    return list[index]!.at
  }
  return {
    issues,
    doneAt: (issueId: string, at: number) => isDone(statusAt(issueId, at)),
    stageNow(issueId: string): 'todo' | 'active' | 'done' {
      const statusId = moves.get(issueId)?.at(-1)?.statusId
      return isDone(statusId) ? 'done' : isWaiting(statusId) ? 'todo' : 'active'
    },
    /** Days since work started, for items in progress. */
    age(issueId: string, at: number) {
      const start = startedAt(issueId)
      return start === undefined ? undefined : Math.max(0, (at - start) / DAY)
    },
    columnName(issueId: string) {
      const statusId = moves.get(issueId)?.at(-1)?.statusId
      const index =
        statusId === undefined ? undefined : columnIndex.get(statusId)
      return index === undefined ? 'Off the board' : columns[index]!.name
    },
    /** Items finished in the last 90 days: days from start to done. */
    sample(at: number): Sample {
      return [...issues.values()].flatMap((issue) => {
        const end = finishedAt(issue.id)
        const start = end === undefined ? undefined : startedAt(issue.id, end)
        if (end === undefined || start === undefined || end < start) return []
        if (end > at || end < at - SAMPLE_DAYS * DAY) return []
        return [{ key: issue.key, days: (end - start) / DAY }]
      })
    },
    p85: (sample: Array<{ days: number }>) =>
      sample.length
        ? percentile(
            sample.map((point) => point.days),
            85,
          )
        : null,
  }
}

/** A finished item: its key, days from start to done, and estimate once known. */
type Sample = Array<{ key: string; days: number; points?: number | null }>

/* ---------------------------------------------------------------------------
 * Membership and estimates over time.
 * ------------------------------------------------------------------------- */

/** The item's sprints at a moment, rebuilt backwards from today's. */
export function sprintsAt(record: SprintItemRecord, at: number): string[] {
  let ids = record.sprintIds
  for (let index = record.sprintChanges.length - 1; index >= 0; index--) {
    const change = record.sprintChanges[index]!
    if (Date.parse(change.at) <= at) break
    ids = change.from
  }
  return ids
}

/** The item's estimate at a moment, or null when it had none. */
export function pointsAt(
  record: SprintItemRecord | undefined,
  at: number,
): number | null {
  if (!record) return null
  let value: number | null = record.points ?? null
  for (let index = record.pointChanges.length - 1; index >= 0; index--) {
    const change = record.pointChanges[index]!
    if (Date.parse(change.at) <= at) break
    value = change.from
  }
  return value
}

/* ---------------------------------------------------------------------------
 * The forecast: each item's chance from how long similar items took.
 * ------------------------------------------------------------------------- */

function sizedSample(
  sample: Sample,
  sized: PointsTimeView | undefined,
  points: number | null,
): Sample {
  if (!sized || points === null) return sample
  const small = points <= sized.smallUpTo
  const group = sample.filter(
    (point) =>
      point.points !== undefined &&
      point.points !== null &&
      point.points <= sized.smallUpTo === small,
  )
  return group.length >= 8 ? group : sample
}

/** Started: of items that took longer than this one's age, how many finished within the days left. */
export function chanceStarted(sample: Sample, age: number, left: number) {
  const longer = sample.filter((point) => point.days > age)
  if (!longer.length) return 0.05
  const within = longer.filter((point) => point.days <= age + left).length
  return (within + 0.5) / (longer.length + 1)
}

/** Not started: how many items took no longer than the days left. */
export function chanceNotStarted(sample: Sample, left: number) {
  if (left <= 0 || !sample.length) return 0
  const within = sample.filter((point) => point.days <= left).length
  return (within + 0.5) / (sample.length + 1)
}

/**
 * The most items that finish with at least this confidence, when each has
 * its own chance (a Poisson binomial distribution, computed exactly).
 */
export function confidentAtLeast(chances: number[], confidence: number) {
  let distribution = [1]
  for (const chance of chances) {
    const next = new Array<number>(distribution.length + 1).fill(0)
    distribution.forEach((p, count) => {
      next[count]! += p * (1 - chance)
      next[count + 1]! += p * chance
    })
    distribution = next
  }
  let atLeast = 0
  let tail = 0
  for (let count = distribution.length - 1; count >= 0; count--) {
    tail += distribution[count]!
    if (tail >= confidence) {
      atLeast = count
      break
    }
  }
  return atLeast
}

/* ---------------------------------------------------------------------------
 * Do points predict time?
 * ------------------------------------------------------------------------- */

function pointsTimeView(
  sample: Sample,
  records: Map<string, SprintItemRecord>,
  board: ReturnType<typeof boardModel>,
): PointsTimeView | undefined {
  const byKey = new Map(
    [...records.values()].flatMap((record) => {
      const issue = board.issues.get(record.issueId)
      return issue && record.points !== undefined
        ? [[issue.key, record.points] as const]
        : []
    }),
  )
  for (const point of sample) point.points = byKey.get(point.key) ?? null
  const estimated = sample.filter(
    (point): point is { key: string; days: number; points: number } =>
      typeof point.points === 'number',
  )
  if (estimated.length < POINTS_SAMPLE) return undefined
  const rho = spearman(
    estimated.map((point) => point.points),
    estimated.map((point) => point.days),
  )
  const sizes = [...new Set(estimated.map((point) => point.points))].sort(
    (a, b) => a - b,
  )
  const rows = sizes
    .map((points) => {
      const days = estimated
        .filter((point) => point.points === points)
        .map((point) => point.days)
      return {
        points,
        items: days.length,
        from: percentile(days, 15),
        to: percentile(days, 85),
        median: percentile(days, 50),
      }
    })
    .filter((row) => row.items >= 3)
    .slice(0, 7)
  const smallUpTo = percentile(
    estimated.map((point) => point.points),
    50,
  )
  const median = (list: number[]) => (list.length ? percentile(list, 50) : 0)
  return {
    verdict: rho >= 0.5 ? 'yes' : rho >= 0.25 ? 'partly' : 'no',
    rows,
    items: estimated.length,
    smallUpTo,
    smallMedian: median(
      estimated.filter((p) => p.points <= smallUpTo).map((p) => p.days),
    ),
    largeMedian: median(
      estimated.filter((p) => p.points > smallUpTo).map((p) => p.days),
    ),
  }
}

/** Rank correlation, ties averaged. */
export function spearman(x: number[], y: number[]): number {
  const rank = (values: number[]) => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value)
    const ranks = new Array<number>(values.length)
    for (let start = 0; start < order.length; ) {
      let end = start
      while (
        end + 1 < order.length &&
        order[end + 1]!.value === order[start]!.value
      )
        end++
      for (let index = start; index <= end; index++)
        ranks[order[index]!.index] = (start + end) / 2
      start = end + 1
    }
    return ranks
  }
  const rx = rank(x)
  const ry = rank(y)
  const n = x.length
  const mean = (n - 1) / 2
  let top = 0
  let sx = 0
  let sy = 0
  for (let index = 0; index < n; index++) {
    const dx = rx[index]! - mean
    const dy = ry[index]! - mean
    top += dx * dy
    sx += dx * dx
    sy += dy * dy
  }
  return sx && sy ? top / Math.sqrt(sx * sy) : 0
}

/* ---------------------------------------------------------------------------
 * Signals that need a decision this sprint.
 * ------------------------------------------------------------------------- */

function sprintSignals(
  active: ActiveSprintView,
  p85: number | null,
): FocusSignal[] {
  const signals: FocusSignal[] = []
  const { sprint, planned, added, removed, items } = active
  const changed = added.length + removed.length
  if (changed >= Math.max(2, Math.ceil(planned.length * 0.15))) {
    const unlikely = items.filter(
      (item) => item.added && (item.state === 'risk' || item.state === 'todo'),
    ).length
    signals.push({
      id: 'sprint-scope',
      severity: unlikely ? 'warning' : 'info',
      title: `${sprint.name} changed after it started`,
      evidence: [
        `${planned.length} planned when it started.`,
        added.length ? `Added since: ${keyList(added)}.` : '',
        removed.length ? `Removed: ${keyList(removed)}.` : '',
        unlikely
          ? `${unlikely} of the added ${unlikely === 1 ? 'item is' : 'items are'} unlikely to finish.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      meta: `${added.length} added · ${removed.length} removed`,
      action:
        'Agree whether the added work replaces planned work, and say so in the review.',
      jiraFilter: buildJiraFilter(
        [...added, ...removed].map(asTicket),
        'Open the changed items in Jira',
      ),
    })
  }
  const carried = items
    .filter((item) => item.state !== 'done' && item.sprints >= 2)
    .sort((a, b) => b.sprints - a.sprints)
  const top = carried[0]
  if (top && (top.sprints >= 3 || carried.length >= 3)) {
    const others = carried.slice(1)
    signals.push({
      id: 'sprint-carry-over',
      severity: 'warning',
      title:
        top.sprints >= 3
          ? `${top.key} is in its ${ordinal(top.sprints)} sprint`
          : `${carried.length} items carried over into ${sprint.name}`,
      evidence:
        top.sprints >= 3
          ? `Carried over from ${listText(top.carriedFrom)}.${top.ageDays !== undefined ? ` ${formatDays(top.ageDays)} in progress${p85 ? `, ${(top.ageDays / p85).toFixed(1)}× the usual` : ''}.` : ''}`
          : `${keyList(carried)} did not finish in the last sprint.`,
      ...(top.sprints >= 3 && others.length
        ? { meta: `Also carried over: ${keyList(others)}` }
        : {}),
      action: 'Split it, swarm it, or descope it before the next planning.',
      jiraFilter: buildJiraFilter(
        carried.map(asTicket),
        'Open the carried-over items in Jira',
      ),
    })
  }
  return signals
}

const asTicket = (ref: SprintRef) => ({
  item: ref.key,
  ...(ref.browseUrl ? { browseUrl: ref.browseUrl } : {}),
})

/* ---------------------------------------------------------------------------
 * Questions for Steerloom AI.
 * ------------------------------------------------------------------------- */

/*
 * A question is what the person would ask, in a sentence. The sprint's facts
 * travel with the briefing data and how to answer lives with the assistant,
 * so a question stays short however large the sprint is.
 */

/** A sprint goal is free text: quoted in a question up to this length. */
const GOAL_IN_QUESTION = 240

function quotedGoal(goal: string | undefined): string {
  const text = (goal ?? '').replace(/\s+/g, ' ').trim()
  return text.length > GOAL_IN_QUESTION
    ? `${text.slice(0, GOAL_IN_QUESTION - 1).trimEnd()}…`
    : text
}

export function sprintDescopePrompt(active: ActiveSprintView): string {
  const goal = quotedGoal(active.sprint.goal)
  return `What should we descope, swarm or finish first in ${active.sprint.name}, now and not at the review?${goal ? ` Its goal: "${goal}".` : ''}`
}

/** What needs raising today in the running sprint. No meeting assumed. */
export function sprintTodayPrompt(active: ActiveSprintView): string {
  return `What should we raise today in ${active.sprint.name}, on day ${active.day} of ${active.days}? Look at the sprint's items at risk, not started, rolled over or added mid-sprint, read the ones that matter with detail, and give at most four points, each with the question for its owner.`
}

/** The sprint goal, judged from the items that serve it. */
export function sprintGoalPrompt(active: ActiveSprintView): string {
  return `Will ${active.sprint.name} meet its goal: "${quotedGoal(active.sprint.goal)}"? Read the sprint's items to decide which ones serve the goal, then say whether it is likely met, partly met or not met by the end, which items decide it, and what would change the outcome.`
}

/** What the last sprints say, for the next planning. */
export function sprintHistoryPrompt(history: ClosedSprintView[]): string {
  return `What do the last ${history.length} sprints tell us for the next planning?`
}

export function sprintPlanningPrompt(
  planning: PlanningView,
  unit: 'points' | 'items',
): string {
  const word = unit === 'points' ? 'points' : 'items'
  return `${planning.sprint.name} holds ${planning.planned} ${word} so far. The last ${planning.sprints} sprints finished ${planning.low}–${planning.high} ${word}, usually ${planning.usual}.${planning.unestimated ? ` ${planning.unestimated} planned items have no estimate.` : ''} Help me choose what to leave out or make optional, so the plan fits what the team usually finishes. Look at each planned item's size, dependencies and age, and end with a plan the team can commit to.`
}

/* ---------------------------------------------------------------------------
 * Small helpers.
 * ------------------------------------------------------------------------- */

/**
 * How many days a sprint has, from the start and end Jira holds: four weeks
 * from one Thursday to the Thursday four weeks on are 28 days, not 29. A part of a day at the
 * end counts as a day.
 */
export function sprintLength(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1
  return Math.max(1, Math.ceil((end - start) / DAY))
}

/** The sprint day a moment falls on: day 1 starts when the sprint does. */
export function sprintDay(start: number, at: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return 0
  return Math.floor((at - start) / DAY) + 1
}

/** The sprint day the item joined, when it came after the start. */
function dayAdded(record: SprintItemRecord, sprint: SprintRecord): number {
  const joined = [...record.sprintChanges]
    .reverse()
    .find(
      (change) =>
        change.to.includes(sprint.id) && !change.from.includes(sprint.id),
    )
  const start = Date.parse(sprint.activatedAt ?? sprint.startAt ?? '')
  return joined ? Math.max(1, sprintDay(start, Date.parse(joined.at))) : 1
}

export function ordinal(value: number): string {
  const tens = value % 100
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][value % 10] ?? 'th')
  return `${value}${suffix}`
}

function formatDays(days: number): string {
  const rounded = Math.round(days)
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}

function listText(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? 'earlier sprints')
}

function keyList(refs: SprintRef[]): string {
  const keys = refs.map((ref) => ref.key)
  return keys.length > 4
    ? `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`
    : keys.join(', ')
}
