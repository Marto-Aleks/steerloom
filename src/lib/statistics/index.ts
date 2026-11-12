import type {
  BoardSelectionSummary,
  CycleTimePoint,
  CycleTimeTrendPoint,
  DistributionPoint,
  FlowBoardSnapshot,
  FlowMetrics,
  WorkInProgressAgePoint,
} from '../../types'
import { uniqueIssuesByIdentity } from '../issue-identity'
import { collectAgingWork } from './aging-work'
import {
  boardJourneys,
  issueJourney,
  orderedEventsByIssue,
  stageZoneLookup,
} from './journey'

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  }
  return sorted[middle] ?? 0
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const bounded = Math.min(100, Math.max(0, percentileValue))
  const index = (bounded / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower] ?? 0
  const weight = index - lower
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight
}

export function throughputRateForWindow(
  completedItemCount: number,
  windowDays: number | null,
): number | null {
  if (
    windowDays === null ||
    !Number.isFinite(windowDays) ||
    windowDays <= 0 ||
    !Number.isFinite(completedItemCount) ||
    completedItemCount < 0
  ) {
    return null
  }
  return completedItemCount / (windowDays / 7)
}

export function cycleTimeDays(
  started: string,
  completed: string,
): number | null {
  const plainNumber = /^-?\d+(?:\.\d+)?$/
  if (plainNumber.test(started.trim()) && plainNumber.test(completed.trim())) {
    const difference = Number(completed) - Number(started)
    return difference >= 0 ? difference : null
  }
  const start = Date.parse(started)
  const end = Date.parse(completed)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null
  return Math.max(0, (end - start) / 86_400_000)
}

/** The Monday (UTC, YYYY-MM-DD) of the week a completion belongs to. */
export function weekStart(value: string): string {
  const date = new Date(value)
  const day = date.getUTCDay()
  const difference = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + difference)
  return date.toISOString().slice(0, 10)
}

function throughputPeriod(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const day = Number(value)
    const lower = Math.floor(day / 7) * 7
    return `Days ${lower}–${lower + 6}`
  }
  return weekStart(value)
}

function sortValue(value: string): number {
  if (/^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value)
  return Date.parse(value)
}

function completionLabel(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(value.trim())) return `Day ${value}`
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toISOString().slice(0, 10)
}

export function isUsableDate(value: string): boolean {
  // Data from a provider can arrive in another shape; it is unusable, not fatal.
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return (
    /^-?\d+(?:\.\d+)?$/.test(trimmed) ||
    (trimmed.length > 0 && Number.isFinite(Date.parse(trimmed)))
  )
}

export function summarizeBoardSelection(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): BoardSelectionSummary {
  const selectedStatusIds = new Set(
    snapshot.board.columns
      .filter((column) => selectedColumnIds.includes(column.id))
      .flatMap((column) => column.statusIds),
  )
  const issueIds = new Set(snapshot.issues.map((issue) => issue.id))
  const enteredIssueIds = new Set<string>()
  let selectedTransitionCount = 0

  snapshot.transitions.forEach((transition) => {
    if (!issueIds.has(transition.issueId)) return
    if (!Number.isFinite(sortValue(transition.enteredAt))) return
    if (selectedStatusIds.has(transition.statusId)) {
      enteredIssueIds.add(transition.issueId)
      selectedTransitionCount += 1
    }
  })

  const workInProgressItemCount = selectedStatusIds.size
    ? [...boardJourneys(snapshot, selectedColumnIds).values()].filter(
        (journey) => journey.outcome === 'active',
      ).length
    : 0

  return {
    enteredItemCount: enteredIssueIds.size,
    workInProgressItemCount,
    selectedTransitionCount,
  }
}

const cycleTimeBands = [
  { range: '0–7d', upperExclusive: 8 },
  { range: '8–14d', upperExclusive: 15 },
  { range: '15–30d', upperExclusive: 31 },
  { range: '31–60d', upperExclusive: 61 },
  { range: '61–90d', upperExclusive: 91 },
  { range: '91–120d', upperExclusive: 121 },
  { range: '121–180d', upperExclusive: 181 },
  { range: '181–365d', upperExclusive: 366 },
  { range: '366d+', upperExclusive: Number.POSITIVE_INFINITY },
] as const

/** The distribution band a cycle time falls in, as the chart labels it. */
export function cycleTimeRange(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  return (
    cycleTimeBands.find(({ upperExclusive }) => value < upperExclusive)
      ?.range ?? null
  )
}

export function cycleTimeDistribution(values: number[]): DistributionPoint[] {
  const usableValues = values.filter(
    (value) => Number.isFinite(value) && value >= 0,
  )
  if (!usableValues.length) return []

  const percentile85Value = percentile(usableValues, 85)
  const finalBandIndex = cycleTimeBands.findIndex(
    ({ upperExclusive }) => Math.max(...usableValues) < upperExclusive,
  )
  const visibleBands = cycleTimeBands.slice(
    0,
    finalBandIndex === -1 ? cycleTimeBands.length : finalBandIndex + 1,
  )
  let cumulativeItems = 0

  return visibleBands.map(({ range, upperExclusive }, index) => {
    const lowerInclusive =
      index === 0 ? 0 : cycleTimeBands[index - 1]!.upperExclusive
    const items = usableValues.filter(
      (value) => value >= lowerInclusive && value < upperExclusive,
    ).length
    cumulativeItems += items

    return {
      range,
      items,
      share: (items / usableValues.length) * 100,
      cumulativeShare: (cumulativeItems / usableValues.length) * 100,
      containsPercentile85:
        percentile85Value >= lowerInclusive &&
        percentile85Value < upperExclusive,
    }
  })
}

export function rollingCycleTimeTrend(
  cycleTimes: CycleTimePoint[],
  rollingWeeks = 4,
): CycleTimeTrendPoint[] {
  if (!Number.isInteger(rollingWeeks) || rollingWeeks < 1) return []

  const completed = cycleTimes
    .map((point) => ({ point, exitTime: Date.parse(point.cycleEnd) }))
    .filter(({ exitTime }) => Number.isFinite(exitTime))
  if (!completed.length) return []

  const weekMilliseconds = 7 * 86_400_000
  const weekStarts = completed.map(({ exitTime }) =>
    Date.parse(weekStart(new Date(exitTime).toISOString())),
  )
  const firstWeek = Math.min(...weekStarts)
  const lastWeek = Math.max(...weekStarts)
  const trend: CycleTimeTrendPoint[] = []

  for (let week = firstWeek; week <= lastWeek; week += weekMilliseconds) {
    const weekEnd = week + weekMilliseconds
    const rollingStart = week - (rollingWeeks - 1) * weekMilliseconds
    const rollingValues = completed
      .filter(({ exitTime }) => exitTime >= rollingStart && exitTime < weekEnd)
      .map(({ point }) => point.cycleTime)
    const completedItemCount = completed.filter(
      ({ exitTime }) => exitTime >= week && exitTime < weekEnd,
    ).length

    trend.push({
      week: new Date(week).toISOString().slice(0, 10),
      completedItemCount,
      rollingItemCount: rollingValues.length,
      rollingMedianCycleTime: rollingValues.length
        ? median(rollingValues)
        : null,
      rollingPercentile85CycleTime: rollingValues.length
        ? percentile(rollingValues, 85)
        : null,
    })
  }

  return trend
}

export function calculateBoardMetrics(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): FlowMetrics | null {
  const selectedColumns = snapshot.board.columns.filter((column) =>
    selectedColumnIds.includes(column.id),
  )
  const selectedStatusIds = new Set(
    selectedColumns.flatMap((column) => column.statusIds),
  )
  if (!selectedStatusIds.size) return null

  const validTransitionCount = snapshot.transitions.filter((transition) =>
    Number.isFinite(sortValue(transition.enteredAt)),
  ).length
  const zoneOf = stageZoneLookup(snapshot.board, selectedColumnIds)
  const eventsByIssue = orderedEventsByIssue(snapshot)

  const completedItems: Array<{
    item: string
    browseUrl?: string
    title?: string
    cycleTime: number
    cycleStart: string
    cycleEnd: string
    exitTime: number
  }> = []
  const uniqueIssues = uniqueIssuesByIdentity(snapshot.issues)

  // Finished means moved past the last measured stage, not cancelled.
  uniqueIssues.forEach((issue) => {
    const journey = issueJourney(
      issue,
      eventsByIssue.get(issue.id) ?? [],
      zoneOf,
    )
    if (journey.outcome !== 'finished') return
    completedItems.push({
      item: issue.key,
      browseUrl: issue.browseUrl,
      ...(issue.title ? { title: issue.title } : {}),
      cycleTime: journey.trackedDays,
      cycleStart: journey.firstEntry,
      cycleEnd: journey.finishedAt,
      exitTime: journey.finishedTime,
    })
  })

  if (!completedItems.length) return null

  const cycleItems = completedItems
    .sort((left, right) => left.exitTime - right.exitTime)
    .map((item, index) => ({ ...item, sequence: index + 1 }))
  const values = cycleItems.map((item) => item.cycleTime)
  const p85 = percentile(values, 85)
  const med = median(values)

  const weekly = new Map<string, number>()
  completedItems.forEach((item) => {
    const week = throughputPeriod(item.cycleEnd)
    weekly.set(week, (weekly.get(week) ?? 0) + 1)
  })

  const columnNames = selectedColumns.map((column) => column.name).join(', ')
  const explanation =
    p85 - med <= Math.max(2, med * 0.35)
      ? `Across ${columnNames}, half of tickets spent ${med.toFixed(1)} days or less and 85% spent ${p85.toFixed(1)} days or less. Repeat visits are included, and this flow is relatively consistent.`
      : `Across ${columnNames}, the median is ${med.toFixed(1)} days but the 85th percentile is ${p85.toFixed(1)} days. Repeat visits are included; the gap signals meaningful variation worth reviewing.`

  return {
    uniqueItemCount: uniqueIssues.length,
    validTransitionCount,
    workItemCount: completedItems.length,
    cycleTimeItemCount: cycleItems.length,
    medianCycleTime: med,
    percentile85CycleTime: p85,
    weeklyThroughput: [...weekly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, items]) => ({ week, items })),
    cycleTimes: cycleItems.map(
      ({
        item,
        browseUrl,
        title,
        cycleTime,
        sequence,
        cycleStart,
        cycleEnd,
      }) => ({
        item,
        browseUrl,
        ...(title ? { title } : {}),
        cycleTime,
        sequence,
        cycleStart,
        cycleEnd,
        completedLabel: completionLabel(cycleEnd),
      }),
    ),
    distribution: cycleTimeDistribution(values),
    explanation,
  }
}

export function findDelayedWorkInProgress(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
  delayThresholdDays: number,
): WorkInProgressAgePoint[] {
  if (!Number.isFinite(delayThresholdDays) || delayThresholdDays < 0) return []

  return collectAgingWork(snapshot, selectedColumnIds)
    .filter((item) => item.ageInSelectedColumns > delayThresholdDays)
    .map(({ item, browseUrl, title, ageInSelectedColumns, currentStatus }) => ({
      item,
      browseUrl,
      ...(title ? { title } : {}),
      ageInSelectedColumns,
      currentStatus,
    }))
}
