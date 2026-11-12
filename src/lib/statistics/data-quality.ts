import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import {
  duplicateIssueIdentityCount,
  uniqueIssuesByIdentity,
} from '../issue-identity'
import { calculateBoardMetrics } from '.'
import {
  boardJourneys,
  orderedEventsByIssue,
  stageZoneLookup,
  type IssueJourney,
} from './journey'
import { filterBoardSnapshot, inTypeScope } from './snapshot-filter'

export type DataQualityStatus = 'ready' | 'warning' | 'blocked'

/**
 * How far the numbers can be trusted. The same scale the AI's Data check
 * skill uses, so the panel and the assistant never disagree.
 */
export type TrustLevel = 'strong' | 'directional' | 'weak'

/** A one-click change that addresses a finding, where one exists. */
export type DataFix =
  | { kind: 'window'; days: number; label: string }
  | { kind: 'refresh'; label: string }

export interface DataFinding {
  id:
    | 'no-stage'
    | 'duplicate-items'
    | 'no-history'
    | 'unreadable-history'
    | 'no-finished-work'
    | 'small-sample'
    | 'late-history'
    | 'bulk-moves'
    | 'skipped-stages'
    | 'forgotten-work'
    | 'workflow-changed'
    | 'unmapped-statuses'
    | 'unused-stage'
    | 'stale-snapshot'
  severity: Exclude<DataQualityStatus, 'ready'>
  title: string
  /** What happened, with the evidence. */
  detail: string
  /** Which numbers it affects. */
  affects: string
  fix?: DataFix
}

export interface DataQualityReport {
  status: DataQualityStatus
  verdict: { level: TrustLevel; sentence: string }
  /** Only what needs attention, most serious first. */
  findings: DataFinding[]
  /** Plain names of the checks that found nothing. */
  passed: string[]
  passedCount: number
  checkCount: number
  uniqueIssueCount: number
  validTransitionCount: number
  invalidTransitionCount: number
  duplicateIssueCount: number
  orphanTransitionCount: number
  unmappedStatusEventCount: number
  futureTransitionCount: number
  sameTimestampIssueCount: number
  outOfOrderIssueCount: number
  selectedColumnsWithoutEvents: number
  completedObservationCount: number
  typeExcludedCount: number
  neverEnteredCount: number
  skippedStageCount: number
  workInProgressCount: number
  forgottenWorkCount: number
  exitedOutsideWindowCount: number
  incompleteHistoryCount: number
  returnedCount: number
  cancelledCount: number
  removedCount: number
  reopenedCount: number
  metricsReconciled: boolean
  snapshotAgeMinutes: number | null
}

const DAY = 86_400_000
/** Below this many finished items, percentiles and forecasts swing a lot. */
const SMALL_SAMPLE = 10
/** From this many, with nothing else in the way, the numbers are strong. */
const STRONG_SAMPLE = 20
/** This many items changing status in the same minute is a bulk edit. */
const BULK_MOVE_ITEMS = 10
// The periods the report settings offer.
const PERIODS = [30, 60, 90, 180] as const

interface QualityTransition {
  statusId: string
  time: number
}

export function assessDataQuality(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  /** The report's "now": the load time, so the window matches the headline. */
  now = new Date(),
  /** The wall clock, only for how old the loaded data is. */
  wallClock = now,
): DataQualityReport {
  const nowMs = now.getTime()
  const selectedColumns = snapshot.board.columns.filter((column) =>
    filters.selectedColumnIds.includes(column.id),
  )
  const stageNames = listOf(selectedColumns.map((column) => column.name))
  const selectedStatusIds = new Set(
    selectedColumns.flatMap((column) => column.statusIds),
  )
  const mappedStatusIds = new Set(
    snapshot.board.columns.flatMap((column) => column.statusIds),
  )
  const statusName = new Map(
    snapshot.board.statuses.map((status) => [status.id, status.name]),
  )
  const uniqueIssues = uniqueIssuesByIdentity(snapshot.issues)
  const knownIssueIds = new Set(snapshot.issues.map((issue) => issue.id))
  const transitionsByIssue = new Map<string, QualityTransition[]>()
  const observedStatusIds = new Set<string>()
  const unmappedStatuses = new Set<string>()
  const firstUse = new Map<string, number>()
  let validTransitionCount = 0
  let invalidTransitionCount = 0
  let orphanTransitionCount = 0
  let unmappedStatusEventCount = 0
  let futureTransitionCount = 0
  let earliest = Number.POSITIVE_INFINITY

  snapshot.transitions.forEach((transition) => {
    const time =
      typeof transition.enteredAt === 'string'
        ? Date.parse(transition.enteredAt)
        : Number.NaN
    if (!Number.isFinite(time)) {
      invalidTransitionCount += 1
      return
    }
    validTransitionCount += 1
    earliest = Math.min(earliest, time)
    observedStatusIds.add(transition.statusId)
    firstUse.set(
      transition.statusId,
      Math.min(firstUse.get(transition.statusId) ?? time, time),
    )
    if (!knownIssueIds.has(transition.issueId)) orphanTransitionCount += 1
    if (!mappedStatusIds.has(transition.statusId)) {
      unmappedStatusEventCount += 1
      unmappedStatuses.add(transition.statusId)
    }
    if (time > nowMs) futureTransitionCount += 1
    const transitions = transitionsByIssue.get(transition.issueId) ?? []
    transitions.push({ statusId: transition.statusId, time })
    transitionsByIssue.set(transition.issueId, transitions)
  })

  const duplicateIssueCount = duplicateIssueIdentityCount(snapshot.issues)
  let sameTimestampIssueCount = 0
  let outOfOrderIssueCount = 0
  transitionsByIssue.forEach((transitions) => {
    const times = transitions.map(({ time }) => time)
    if (new Set(times).size !== times.length) sameTimestampIssueCount += 1
    if (times.some((time, index) => index > 0 && time < times[index - 1]!)) {
      outOfOrderIssueCount += 1
    }
  })

  const unusedStages = selectedColumns.filter((column) =>
    column.statusIds.every((statusId) => !observedStatusIds.has(statusId)),
  )
  const endOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )
  const periodStart =
    filters.windowDays === null
      ? Number.NEGATIVE_INFINITY
      : endOfToday - filters.windowDays * DAY
  const inPeriod = (time: number) => time >= periodStart && time < endOfToday

  let completedObservationCount = 0
  let typeExcludedCount = 0
  let neverEnteredCount = 0
  let skippedStageCount = 0
  let workInProgressCount = 0
  let exitedOutsideWindowCount = 0
  let incompleteHistoryCount = 0
  let returnedCount = 0
  let cancelledCount = 0
  let removedCount = 0
  let reopenedCount = 0
  const finishTimes: number[] = []
  const quietSince: number[] = []
  const journeys =
    selectedStatusIds.size > 0
      ? boardJourneys(snapshot, filters.selectedColumnIds)
      : new Map<string, IssueJourney>()
  const zoneOf =
    selectedStatusIds.size > 0
      ? stageZoneLookup(snapshot.board, filters.selectedColumnIds)
      : () => 'before' as const
  const events = orderedEventsByIssue(snapshot)

  uniqueIssues.forEach((issue) => {
    if (!inTypeScope(issue, filters.ticketTypes)) {
      typeExcludedCount += 1
      return
    }
    const journey = journeys.get(issue.id)
    if (!journey || journey.outcome === 'never-entered') {
      neverEnteredCount += 1
      // Done without ever passing the measured stages: the board skipped them.
      const history = events.get(issue.id) ?? []
      const done = history.find((event) => zoneOf(event.statusId) === 'after')
      if (done && zoneOf(history.at(-1)!.statusId) === 'after') {
        if (inPeriod(done.time)) skippedStageCount += 1
      }
      return
    }
    if (journey.reopened) reopenedCount += 1
    switch (journey.outcome) {
      case 'active': {
        workInProgressCount += 1
        const last = events.get(issue.id)?.at(-1)?.time
        if (last !== undefined) quietSince.push(last)
        return
      }
      case 'returned':
        returnedCount += 1
        return
      case 'cancelled':
        cancelledCount += 1
        return
      case 'removed':
        removedCount += 1
        return
    }
    const latestExit = journey.finishedTime
    if (!Number.isFinite(latestExit)) {
      incompleteHistoryCount += 1
      return
    }
    finishTimes.push(latestExit)
    if (latestExit < periodStart || latestExit >= endOfToday) {
      exitedOutsideWindowCount += 1
      return
    }
    completedObservationCount += 1
  })

  const scopedSnapshot = filterBoardSnapshot(snapshot, filters, now)
  const metrics = calculateBoardMetrics(
    scopedSnapshot,
    filters.selectedColumnIds,
  )
  const cyclePointCount = metrics?.cycleTimes.length ?? 0
  const weeklyThroughputCount =
    metrics?.weeklyThroughput.reduce((sum, point) => sum + point.items, 0) ?? 0
  const distributionCount =
    metrics?.distribution.reduce((sum, point) => sum + point.items, 0) ?? 0
  const metricObservationCount = metrics?.workItemCount ?? 0
  // A self-test of the calculations, not something people act on.
  const metricsReconciled =
    completedObservationCount === metricObservationCount &&
    metricObservationCount === cyclePointCount &&
    cyclePointCount === weeklyThroughputCount &&
    weeklyThroughputCount === distributionCount
  const snapshotAgeMinutes = ageInMinutes(snapshot.loadedAt, wallClock)
  const p85 = metrics?.percentile85CycleTime

  // A longer period that would give a usable sample, if the history has one.
  const longerPeriod = (() => {
    if (filters.windowDays === null) return undefined
    const current = filters.windowDays
    const finishedWithin = (days: number) =>
      finishTimes.filter((time) => time >= endOfToday - days * DAY).length
    const longer = PERIODS.filter((days) => days > current)
    const enough = longer.find((days) => finishedWithin(days) >= SMALL_SAMPLE)
    const best = enough ?? longer.at(-1)
    return best !== undefined &&
      finishedWithin(best) > completedObservationCount
      ? { days: best, finished: finishedWithin(best) }
      : undefined
  })()
  const periodWords =
    filters.windowDays === null
      ? 'in the loaded history'
      : `in the last ${filters.windowDays} days`

  const findings: DataFinding[] = []
  const passed: string[] = []
  let checkCount = 0
  const check = (
    passedName: string,
    finding: DataFinding | false | undefined,
  ) => {
    checkCount += 1
    if (finding) findings.push(finding)
    else passed.push(passedName)
  }

  check(
    'stages chosen',
    selectedStatusIds.size === 0 && {
      id: 'no-stage',
      severity: 'blocked',
      title: 'No stages chosen',
      detail: 'Pick the stages where work happens so Steerloom can time it.',
      affects: 'Every number in the briefing.',
    },
  )
  check(
    'no duplicate items',
    duplicateIssueCount > 0 && {
      id: 'duplicate-items',
      severity: 'blocked',
      title: 'Some items appear twice',
      detail: `${count(duplicateIssueCount, 'item')} came back from the board more than once with different details, so Steerloom can’t tell which is right.`,
      affects: 'Every number in the briefing.',
    },
  )
  check(
    'status history present',
    validTransitionCount === 0 && {
      id: 'no-history',
      severity: 'blocked',
      title: 'No status history',
      detail:
        'The board returned items but no record of when they changed status.',
      affects: 'Every number in the briefing.',
    },
  )
  // Out-of-order histories are sorted by date and kept: not a problem.
  const unreadable =
    invalidTransitionCount + futureTransitionCount + orphanTransitionCount
  check(
    'all history readable',
    validTransitionCount > 0 &&
      unreadable > 0 && {
        id: 'unreadable-history',
        severity: 'warning',
        title: 'Some history couldn’t be read',
        detail: [
          invalidTransitionCount &&
            `${count(invalidTransitionCount, 'status change')} without a usable date`,
          futureTransitionCount &&
            `${count(futureTransitionCount, 'status change')} dated in the future`,
          orphanTransitionCount &&
            `${count(orphanTransitionCount, 'status change')} for items the board didn’t return`,
        ]
          .filter(Boolean)
          .join('; ')
          .replace(/^./, (first) => first.toUpperCase())
          .concat('. These changes are left out.'),
        affects: 'Cycle time for the items involved.',
      },
  )
  check(
    'finished work in the period',
    selectedStatusIds.size > 0 &&
      validTransitionCount > 0 &&
      completedObservationCount === 0 && {
        id: 'no-finished-work',
        severity: 'warning',
        title: 'Nothing has finished yet',
        detail: `No work has left ${stageNames} ${periodWords}${workInProgressCount ? `; ${count(workInProgressCount, 'item')} ${workInProgressCount === 1 ? 'is' : 'are'} still inside` : ''}.${longerPeriod ? ` ${count(longerPeriod.finished, 'item')} finished in the last ${longerPeriod.days} days.` : ''}`,
        affects: 'Cycle time, the usual limit (P85) and the forecast.',
        ...(longerPeriod
          ? {
              fix: {
                kind: 'window' as const,
                days: longerPeriod.days,
                label: `Measure the last ${longerPeriod.days} days`,
              },
            }
          : {}),
      },
  )
  check(
    'enough finished items',
    completedObservationCount > 0 &&
      completedObservationCount < SMALL_SAMPLE && {
        id: 'small-sample',
        severity: 'warning',
        title: 'Few finished items',
        detail: `Only ${count(completedObservationCount, 'item')} finished ${periodWords}. With so few, one slow or fast item moves the numbers a lot.${longerPeriod ? ` The last ${longerPeriod.days} days have ${longerPeriod.finished}.` : ''}`,
        affects: 'The usual limit (P85) and the forecast.',
        ...(longerPeriod
          ? {
              fix: {
                kind: 'window' as const,
                days: longerPeriod.days,
                label: `Measure the last ${longerPeriod.days} days`,
              },
            }
          : {}),
      },
  )
  check(
    'history covers the period',
    filters.windowDays !== null &&
      Number.isFinite(earliest) &&
      earliest > periodStart + 7 * DAY && {
        id: 'late-history',
        severity: 'warning',
        title: 'History starts partway through the period',
        detail: `The board’s recorded history begins on ${day(earliest)}, but the period starts on ${day(periodStart)}. Work finished before then isn’t in it.`,
        affects:
          'Throughput, items finished, and comparisons with the previous period.',
      },
  )

  // Many items changing status in the same minute: a clean-up or migration.
  const bulk = (() => {
    const byMinute = new Map<number, Set<string>>()
    events.forEach((history, issueId) => {
      history.slice(1).forEach((event) => {
        if (!inPeriod(event.time)) return
        const minute = Math.floor(event.time / 60_000)
        const items = byMinute.get(minute) ?? new Set<string>()
        items.add(issueId)
        byMinute.set(minute, items)
      })
    })
    let largest: { minute: number; items: number } | undefined
    let moments = 0
    byMinute.forEach((items, minute) => {
      if (items.size < BULK_MOVE_ITEMS) return
      moments += 1
      if (!largest || items.size > largest.items)
        largest = { minute, items: items.size }
    })
    return largest ? { ...largest, moments } : undefined
  })()
  check(
    'no bulk moves',
    bulk && {
      id: 'bulk-moves',
      severity: 'warning',
      title: 'Many items moved at once',
      detail: `${count(bulk.items, 'item')} changed status in the same minute on ${day(bulk.minute * 60_000)}${bulk.moments > 1 ? `, and it happened ${bulk.moments - 1} more ${bulk.moments === 2 ? 'time' : 'times'}` : ''}. That usually means a clean-up or migration, not real work, so those items’ times may be off.`,
      affects: 'Cycle time and throughput for the items involved.',
    },
  )

  const finishedOrSkipped = completedObservationCount + skippedStageCount
  check(
    'work passes the measured stages',
    skippedStageCount >= 3 &&
      skippedStageCount / Math.max(1, finishedOrSkipped) >= 0.2 && {
        id: 'skipped-stages',
        severity: 'warning',
        title: 'Work skips the measured stages',
        detail: `${count(skippedStageCount, 'item')} reached done ${periodWords} without ever passing ${stageNames}. Either the work happens in another stage, or the board isn’t moved while work happens.`,
        affects:
          'Items finished and throughput: skipped items aren’t counted as delivered.',
      },
  )

  // In progress, but not moved for far longer than work usually takes.
  const quietLimitDays = Math.max(30, p85 != null && p85 > 0 ? 3 * p85 : 90)
  const forgottenWorkCount = quietSince.filter(
    (time) => nowMs - time > quietLimitDays * DAY,
  ).length
  check(
    'no forgotten work',
    forgottenWorkCount > 0 && {
      id: 'forgotten-work',
      severity: 'warning',
      title: 'Some work may be forgotten',
      detail: `${count(forgottenWorkCount, 'item')} ${forgottenWorkCount === 1 ? 'has' : 'have'} been in progress without moving for more than ${Math.round(quietLimitDays)} days. If ${forgottenWorkCount === 1 ? 'it’s' : 'they’re'} no longer being worked on, closing ${forgottenWorkCount === 1 ? 'it' : 'them'} on the board keeps the numbers honest.`,
      affects: 'Work in progress, aging work and the forecast.',
    },
  )

  // A stage first used partway through the period, on a board with older
  // history: the workflow changed, so before and after differ.
  const changed = (() => {
    if (filters.windowDays === null) return
    const before = snapshot.transitions.filter((transition) => {
      const time = Date.parse(transition.enteredAt)
      return Number.isFinite(time) && time < periodStart
    }).length
    if (before < 20) return
    // The final column fills up as work finishes; first use there is no change.
    const finalStatuses = new Set(snapshot.board.columns.at(-1)?.statusIds)
    const doneStatuses = new Set(
      snapshot.board.statuses
        .filter((status) => status.category === 'done')
        .map((status) => status.id),
    )
    let first: { statusId: string; time: number } | undefined
    firstUse.forEach((time, statusId) => {
      if (!mappedStatusIds.has(statusId)) return
      if (finalStatuses.has(statusId) || doneStatuses.has(statusId)) return
      if (time <= periodStart + 7 * DAY || !inPeriod(time)) return
      if (!first || time < first.time) first = { statusId, time }
    })
    return first
  })()
  check(
    'steady workflow',
    changed && {
      id: 'workflow-changed',
      severity: 'warning',
      title: 'The workflow changed in this period',
      detail: `“${statusName.get(changed.statusId) ?? 'A status'}” was first used on ${day(changed.time)}. Times before and after that date aren’t fully comparable.`,
      affects: 'Comparisons with the previous period and trends.',
    },
  )

  const unmappedShare =
    unmappedStatusEventCount / Math.max(1, validTransitionCount)
  check(
    'statuses on the board',
    unmappedStatusEventCount >= 5 &&
      unmappedShare >= 0.02 && {
        id: 'unmapped-statuses',
        severity: 'warning',
        title: 'Statuses the board doesn’t show',
        detail: `${count(unmappedStatusEventCount, 'status change')} went to ${listOf(
          [...unmappedStatuses]
            .slice(0, 3)
            .map((id) => `“${statusName.get(id) ?? id}”`),
        )}${unmappedStatuses.size > 3 ? ' and others' : ''}, which ${unmappedStatuses.size === 1 ? 'isn’t' : 'aren’t'} in any board column. Time there counts as outside the measured stages.`,
        affects: 'Cycle time, if work really happens in those statuses.',
      },
  )
  check(
    'chosen stages in use',
    selectedStatusIds.size > 0 &&
      unusedStages.length > 0 && {
        id: 'unused-stage',
        severity: 'warning',
        title: `${listOf(unusedStages.map((column) => column.name))} ${unusedStages.length === 1 ? 'has' : 'have'} never been used`,
        detail: `No item has ever been in ${unusedStages.length === 1 ? 'this stage' : 'these stages'}, so ${unusedStages.length === 1 ? 'it adds' : 'they add'} nothing to the measurement.`,
        affects: 'Nothing directly; check the right stages are chosen.',
      },
  )
  check(
    'recently loaded',
    (snapshotAgeMinutes === null || snapshotAgeMinutes > 60) && {
      id: 'stale-snapshot',
      severity: 'warning',
      title: 'The data may be out of date',
      detail:
        snapshotAgeMinutes === null
          ? 'When the board was loaded is unknown.'
          : `The board was loaded ${formatAge(snapshotAgeMinutes)} ago.`,
      affects: 'Current work and aging.',
      fix: { kind: 'refresh', label: 'Refresh the board' },
    },
  )

  findings.sort(
    (left, right) =>
      Number(right.severity === 'blocked') -
      Number(left.severity === 'blocked'),
  )
  const status: DataQualityStatus = findings.some(
    (finding) => finding.severity === 'blocked',
  )
    ? 'blocked'
    : findings.length
      ? 'warning'
      : 'ready'

  return {
    status,
    verdict: verdictFor({
      status,
      findings,
      completed: completedObservationCount,
      periodWords,
    }),
    findings,
    passed,
    passedCount: passed.length,
    checkCount,
    uniqueIssueCount: uniqueIssues.length,
    validTransitionCount,
    invalidTransitionCount,
    duplicateIssueCount,
    orphanTransitionCount,
    unmappedStatusEventCount,
    futureTransitionCount,
    sameTimestampIssueCount,
    outOfOrderIssueCount,
    selectedColumnsWithoutEvents: unusedStages.length,
    completedObservationCount,
    typeExcludedCount,
    neverEnteredCount,
    skippedStageCount,
    workInProgressCount,
    forgottenWorkCount,
    exitedOutsideWindowCount,
    incompleteHistoryCount,
    returnedCount,
    cancelledCount,
    removedCount,
    reopenedCount,
    metricsReconciled,
    snapshotAgeMinutes,
  }
}

/** Findings that change how far the headline numbers can be trusted. */
const SHAKES_NUMBERS = new Set<DataFinding['id']>([
  'unreadable-history',
  'late-history',
  'bulk-moves',
  'skipped-stages',
  'workflow-changed',
  'unmapped-statuses',
])

function verdictFor({
  status,
  findings,
  completed,
  periodWords,
}: {
  status: DataQualityStatus
  findings: DataFinding[]
  completed: number
  periodWords: string
}): DataQualityReport['verdict'] {
  if (status === 'blocked')
    return {
      level: 'weak',
      sentence: `Weak: ${lowerFirst(findings[0]!.title)}, so the briefing can’t be calculated yet.`,
    }
  if (completed === 0)
    return {
      level: 'weak',
      sentence: `Weak: no work has finished ${periodWords}, so cycle time and the forecast can’t be calculated yet.`,
    }
  if (completed < 5)
    return {
      level: 'weak',
      sentence: `Weak: only ${count(completed, 'item')} finished ${periodWords}, too few for a reliable cycle time or forecast.`,
    }
  const caveats = findings.filter((finding) => SHAKES_NUMBERS.has(finding.id))
  if (completed < STRONG_SAMPLE || caveats.length)
    return {
      level: 'directional',
      sentence: `Directional: based on ${count(completed, 'finished item')}${caveats.length ? ` and ${caveats.length === 1 ? 'one thing' : `${caveats.length} things`} worth a look below` : ''}. Good for direction, less so for precise commitments.`,
    }
  return {
    level: 'strong',
    sentence: `Strong: ${count(completed, 'finished item')} with clean history. A sound basis for decisions.`,
  }
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString('en')} ${value === 1 ? noun : `${noun}s`}`
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'the measured stages'
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

function day(time: number): string {
  return new Date(time).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function ageInMinutes(value: string, now: Date): number | null {
  const loadedAt = Date.parse(value)
  if (!Number.isFinite(loadedAt)) return null
  return Math.max(0, Math.floor((now.getTime() - loadedAt) / 60_000))
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `${days} days`
}
