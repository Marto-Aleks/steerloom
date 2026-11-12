import type {
  AnalysisFilters,
  CycleTimePoint,
  FlowBoardSnapshot,
  FlowMetrics,
} from '../../types'
import { uniqueIssuesByIdentity } from '../issue-identity'
import {
  calculateBoardMetrics,
  findDelayedWorkInProgress,
  throughputRateForWindow,
} from '.'
import { findReenteredWorkInProgress } from './focus-now'
import { boardJourneys } from './journey'
import {
  filterBoardSnapshotByExitPeriod,
  inTypeScope,
  previousExitPeriod,
  resolveExitPeriod,
  snapshotAtTime,
  type ExitPeriod,
} from './snapshot-filter'

export type FlowMetricId =
  | 'completed-observations'
  | 'median-cycle-time'
  | 'percentile-85'
  | 'exit-throughput'

export interface MetricEvidenceTicket {
  key: string
  browseUrl?: string
  title?: string
  cycleTimeDays: number
  firstEntry: string
  latestExit: string
  visits: Array<{
    enteredAt: string
    exitedAt: string
    durationDays: number
  }>
}

export interface MetricEvidenceExclusion {
  id:
    | 'never-entered'
    | 'current-wip'
    | 'returned'
    | 'cancelled'
    | 'removed'
    | 'no-exit-in-period'
  label: string
  description: string
  tickets: Array<{ key: string; browseUrl?: string; title?: string }>
}

export interface MetricEvidenceReport {
  period: ExitPeriod | null
  includedTickets: MetricEvidenceTicket[]
  exclusions: MetricEvidenceExclusion[]
  selectedColumnNames: string[]
  selectedTicketTypes: string[]
}

export interface FlowPeriodSummary {
  period: ExitPeriod
  completedObservations: number
  medianCycleTimeDays: number | null
  percentile85CycleTimeDays: number | null
  exitThroughputPerWeek: number
  delayedWorkInProgress: number | null
  reenteredWorkInProgress: number
  historyCoverage: 'complete' | 'partial'
}

export interface FlowPeriodComparison {
  current: FlowPeriodSummary
  previous: FlowPeriodSummary
}

export function buildMetricEvidence(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  metrics: FlowMetrics,
  period: ExitPeriod | null,
): MetricEvidenceReport {
  const selectedColumns = snapshot.board.columns.filter((column) =>
    filters.selectedColumnIds.includes(column.id),
  )
  const includedKeys = new Set(
    metrics.cycleTimes.map(({ item }) => normaliseKey(item)),
  )
  const issueIdByKey = new Map(
    uniqueIssuesByIdentity(snapshot.issues).map((issue) => [
      normaliseKey(issue.key),
      issue.id,
    ]),
  )
  const exclusions: Record<
    MetricEvidenceExclusion['id'],
    MetricEvidenceExclusion
  > = {
    'never-entered': {
      id: 'never-entered',
      label: 'Never reached these columns',
      description:
        'These items are in scope but never moved into the measured columns.',
      tickets: [],
    },
    'current-wip': {
      id: 'current-wip',
      label: 'Still in progress',
      description:
        'Work that is still inside the measured columns has no finish date yet, so it has no cycle time and is not an exit.',
      tickets: [],
    },
    returned: {
      id: 'returned',
      label: 'Went back to an earlier column',
      description:
        'These items left the measured columns backwards, to a column such as To do, so they are neither finished nor in progress.',
      tickets: [],
    },
    cancelled: {
      id: 'cancelled',
      label: 'Closed without being delivered',
      description:
        'These items were closed as Won’t Do, Duplicate or similar, so they do not count as finished work.',
      tickets: [],
    },
    removed: {
      id: 'removed',
      label: 'Archived while in progress',
      description:
        'These cards were archived inside the measured columns, so they never finished.',
      tickets: [],
    },
    'no-exit-in-period': {
      id: 'no-exit-in-period',
      label: period ? 'Finished outside this period' : 'Never left for good',
      description: period
        ? 'These items last left the measured columns before or after the reporting period, or their history is incomplete.'
        : 'These items reached the measured columns but never left them for good.',
      tickets: [],
    },
  }

  const journeys = boardJourneys(snapshot, filters.selectedColumnIds)
  uniqueIssuesByIdentity(snapshot.issues).forEach((issue) => {
    if (!inTypeScope(issue, filters.ticketTypes)) return
    if (includedKeys.has(normaliseKey(issue.key))) return
    const ticket = {
      key: issue.key,
      ...(issue.browseUrl ? { browseUrl: issue.browseUrl } : {}),
      ...(issue.title ? { title: issue.title } : {}),
    }
    const outcome = journeys.get(issue.id)?.outcome ?? 'never-entered'
    const bucket: MetricEvidenceExclusion['id'] =
      outcome === 'active'
        ? 'current-wip'
        : outcome === 'finished'
          ? 'no-exit-in-period'
          : outcome
    exclusions[bucket].tickets.push(ticket)
  })

  return {
    period,
    includedTickets: metrics.cycleTimes.map((point) => {
      const issueId = issueIdByKey.get(normaliseKey(point.item))
      return toEvidenceTicket(
        point,
        (issueId ? journeys.get(issueId)?.visits : undefined) ?? [],
      )
    }),
    exclusions: Object.values(exclusions).filter(
      ({ tickets }) => tickets.length > 0,
    ),
    selectedColumnNames: selectedColumns.map(({ name }) => name),
    selectedTicketTypes: filters.ticketTypes,
  }
}

export function buildFlowPeriodComparison(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  now = new Date(),
): FlowPeriodComparison | null {
  // List movements do not establish when Trello cards were archived or restored.
  // Reconstructing historical WIP from the current archived flag would mislead.
  if (snapshot.source.kind === 'trello') return null
  const currentPeriod = resolveExitPeriod(filters.windowDays, now)
  if (!currentPeriod) return null
  const previousPeriod = previousExitPeriod(currentPeriod)
  return {
    current: summarizePeriod(
      snapshot,
      filters,
      currentPeriod,
      snapshot.loadedAt,
    ),
    previous: summarizePeriod(
      snapshot,
      filters,
      previousPeriod,
      previousPeriod.end,
    ),
  }
}

export interface MetricExplanation {
  /** One plain sentence: what the number says about the team. */
  meaning: string
  /** How it was worked out, with this report's own numbers. */
  how: string
  /** The items the number was read from, to mark in the evidence table. */
  anchors: { key: string; role: string }[]
}

/** "In progress, Review" → "In progress and Review", for a sentence. */
function listColumns(columns: string[]): string {
  if (columns.length === 0) return 'the measured columns'
  if (columns.length === 1) return columns[0]!
  return `${columns.slice(0, -1).join(', ')} and ${columns[columns.length - 1]}`
}

function days(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? 'day' : 'days'}`
}

/**
 * The number explained for a reader, not a statistician: what it means, and
 * how it was read off this report's own items.
 */
export function explainMetric(
  metric: FlowMetricId,
  metrics: FlowMetrics,
  period: ExitPeriod | null,
  columns: string[],
  periodLabel: string | null,
): MetricExplanation {
  const count = metrics.workItemCount
  const items = `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}`
  const none: MetricExplanation = {
    meaning: 'No items finished in this scope yet.',
    how: 'The number appears once an item leaves the measured columns for good.',
    anchors: [],
  }
  if (metric === 'completed-observations') {
    if (!count) return none
    return {
      meaning: `${items} left ${listColumns(columns)} for good${periodLabel ? ` between ${periodLabel}` : ''}.`,
      how: 'Each item is counted once, on the day it last left. An item that came back and left again still counts once.',
      anchors: [],
    }
  }
  const sorted = [...metrics.cycleTimes].sort(
    (left, right) => left.cycleTime - right.cycleTime,
  )
  if (metric === 'median-cycle-time') {
    const median = metrics.medianCycleTime
    if (median === null || !sorted.length) return none
    const meaning = `Half of the finished items took ${days(median)} or less.`
    const stays = 'An item that came back has its stays added up.'
    if (count === 1) {
      return {
        meaning,
        how: `Only one item finished, so this is its own time. ${stays}`,
        anchors: [{ key: sorted[0]!.item, role: 'the only item' }],
      }
    }
    if (count % 2 === 0) {
      const lower = sorted[count / 2 - 1]!
      const upper = sorted[count / 2]!
      return {
        meaning,
        how: `${items}, sorted fastest to slowest; the two in the middle took ${days(lower.cycleTime)} and ${days(upper.cycleTime)}, so the median is ${days(median)}. ${stays}`,
        anchors: [
          { key: lower.item, role: 'middle' },
          { key: upper.item, role: 'middle' },
        ],
      }
    }
    const middle = sorted[(count - 1) / 2]!
    return {
      meaning,
      how: `${items}, sorted fastest to slowest; the one in the middle took ${days(middle.cycleTime)}. ${stays}`,
      anchors: [{ key: middle.item, role: 'middle' }],
    }
  }
  if (metric === 'percentile-85') {
    const limit = metrics.percentile85CycleTime
    if (limit === null || !sorted.length) return none
    const within = sorted.filter(
      (point) => point.cycleTime <= limit + 1e-9,
    ).length
    const meaning = `${within} of ${count} finished items took ${days(limit)} or less. That is the 85% mark, so anything older is late by this team's own history.`
    if (count === 1) {
      return {
        meaning,
        how: 'Only one item finished, so this is its own time.',
        anchors: [{ key: sorted[0]!.item, role: '85% mark' }],
      }
    }
    const rank = 0.85 * (count - 1)
    const lower = sorted[Math.floor(rank)]!
    const upper = sorted[Math.ceil(rank)]!
    if (lower === upper) {
      return {
        meaning,
        how: `Same sorted list, read at the 85% mark: that lands on ${lower.item} at ${days(lower.cycleTime)}.`,
        anchors: [{ key: lower.item, role: '85% mark' }],
      }
    }
    const sameTime = Math.abs(lower.cycleTime - upper.cycleTime) < 1e-9
    return {
      meaning,
      how: sameTime
        ? `Same sorted list, read at the 85% mark, which falls between ${lower.item} and ${upper.item}, both at ${days(lower.cycleTime)}, so the limit is ${days(limit)}.`
        : `Same sorted list, read at the 85% mark, which falls between ${lower.item} (${days(lower.cycleTime)}) and ${upper.item} (${days(upper.cycleTime)}).`,
      anchors: [
        { key: lower.item, role: '85% mark' },
        { key: upper.item, role: '85% mark' },
      ],
    }
  }
  if (!period) {
    return {
      meaning: 'Choose a fixed reporting period to work out a weekly rate.',
      how: 'A rate needs a known number of days to divide by.',
      anchors: [],
    }
  }
  const rate = throughputRateForWindow(count, period.days) ?? 0
  return {
    meaning: `${items} finished in ${period.days.toLocaleString()} days, about ${formatNumber(rate)} a week.`,
    how: 'Quiet weeks count too: this is the average over the whole period, not the best week.',
    anchors: [],
  }
}

function summarizePeriod(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  period: ExitPeriod,
  asOf: string,
): FlowPeriodSummary {
  const end = Math.min(Date.parse(period.end), Date.parse(asOf))
  const asOfSnapshot = snapshotAtTime(
    snapshot,
    new Date(Number.isFinite(end) ? end : Date.parse(period.end)).toISOString(),
  )
  const scopedSnapshot = filterBoardSnapshotByExitPeriod(
    asOfSnapshot,
    filters,
    period,
  )
  const metrics = calculateBoardMetrics(
    scopedSnapshot,
    filters.selectedColumnIds,
  )
  const typeScopedSnapshot = filterBoardSnapshotByExitPeriod(
    asOfSnapshot,
    { ...filters, windowDays: null },
    null,
  )
  const p85 = metrics?.percentile85CycleTime ?? null
  // A loop, not a spread: a spread over every transition overflows the call
  // stack on busy boards.
  let earliestTransition = Number.POSITIVE_INFINITY
  for (const { enteredAt } of typeScopedSnapshot.transitions) {
    const time = Date.parse(enteredAt)
    if (Number.isFinite(time) && time < earliestTransition)
      earliestTransition = time
  }

  return {
    period,
    completedObservations: metrics?.workItemCount ?? 0,
    medianCycleTimeDays: metrics?.medianCycleTime ?? null,
    percentile85CycleTimeDays: p85,
    exitThroughputPerWeek:
      throughputRateForWindow(metrics?.workItemCount ?? 0, period.days) ?? 0,
    delayedWorkInProgress:
      p85 === null
        ? null
        : findDelayedWorkInProgress(
            typeScopedSnapshot,
            filters.selectedColumnIds,
            p85,
          ).length,
    reenteredWorkInProgress: findReenteredWorkInProgress(
      typeScopedSnapshot,
      filters.selectedColumnIds,
    ).length,
    historyCoverage:
      Number.isFinite(earliestTransition) &&
      earliestTransition <= Date.parse(period.start)
        ? 'complete'
        : 'partial',
  }
}

function toEvidenceTicket(
  point: CycleTimePoint,
  visits: MetricEvidenceTicket['visits'],
): MetricEvidenceTicket {
  return {
    key: point.item,
    ...(point.browseUrl ? { browseUrl: point.browseUrl } : {}),
    ...(point.title ? { title: point.title } : {}),
    cycleTimeDays: point.cycleTime,
    firstEntry: point.cycleStart,
    latestExit: point.cycleEnd,
    visits,
  }
}

function normaliseKey(value: string) {
  return value.trim().toUpperCase()
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
