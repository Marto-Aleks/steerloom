import { toAiSprintContext } from '../../lib/ai/sprint-context'
import type { SprintBriefing } from '../../lib/statistics/sprint'
import type { AiReportContext } from '../../lib/ai/report-context'
import { buildAiReportContext } from '../../lib/ai/report-context'
import {
  buildPullRequestEvidence,
  CODE_LOOKUP_LIMIT,
} from '../../lib/ai/pull-request-evidence'
import type {
  BranchRecord,
  PullRequestRecord,
} from '../../lib/data-source/github'
import {
  calculateBoardMetrics,
  rollingCycleTimeTrend,
  throughputRateForWindow,
} from '../../lib/statistics'
import {
  agingBaselineState,
  collectAgingWork,
} from '../../lib/statistics/aging-work'
import { assessDataQuality } from '../../lib/statistics/data-quality'
import { buildBriefing, stageLoads } from '../../lib/statistics/briefing'
import {
  buildFlowPeriodComparison,
  buildMetricEvidence,
} from '../../lib/statistics/flow-evidence'
import {
  QUICK_MOVE_DAYS,
  replayFlaggedItems,
} from '../../lib/statistics/flagged-replay'
import { buildFocusNowSummary } from '../../lib/statistics/focus-now'
import { forecastThroughput } from '../../lib/statistics/forecast'
import { pullRequestInsight } from '../../lib/statistics/pull-requests'
import {
  filterBoardSnapshot,
  resolveExitPeriod,
} from '../../lib/statistics/snapshot-filter'
import {
  stageTimeShares,
  startFinishBalance,
} from '../../lib/statistics/stage-time'
import { weeklyThroughputForPeriod } from '../../lib/statistics/weekly-throughput'
import type {
  AnalysisFilters,
  FlowBoardSnapshot,
  FlowMetrics,
} from '../../types'
import type { CodeReviewGroup } from './code-review-types'
import { describeTrend, isPartialWeek } from './format'

/*
 * What a dashboard derives from its board and code, without React: the
 * numbers, the code trail and what Steerloom AI is given. The dashboard,
 * the demo's recorded answers and their recorder all use these, so the
 * three cannot drift apart.
 */

// Every number on the dashboard is derived here, once per snapshot and filter
// set, so interaction state (modals, filters) never re-runs the statistics or
// restarts chart animations.
export function computeReport(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
) {
  const loadedAt = new Date(snapshot.loadedAt)
  const reportNow = Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date()
  const currentPeriod = resolveExitPeriod(filters.windowDays, reportNow)
  const scopedSnapshot = filterBoardSnapshot(snapshot, filters, reportNow)
  const selectedColumns = scopedSnapshot.board.columns.filter((column) =>
    filters.selectedColumnIds.includes(column.id),
  )
  const completedMetrics = calculateBoardMetrics(
    scopedSnapshot,
    filters.selectedColumnIds,
  )
  const baseMetrics: FlowMetrics = completedMetrics ?? {
    uniqueItemCount: scopedSnapshot.issues.length,
    validTransitionCount: scopedSnapshot.transitions.length,
    workItemCount: 0,
    cycleTimeItemCount: 0,
    medianCycleTime: null,
    percentile85CycleTime: null,
    weeklyThroughput: [],
    cycleTimes: [],
    distribution: [],
    explanation:
      'No completed observations in this scope. Cycle-time estimates and the P85 baseline are unavailable. Current-work signals use the observed board history.',
  }
  const metrics: FlowMetrics = {
    ...baseMetrics,
    weeklyThroughput: weeklyThroughputForPeriod(
      baseMetrics.cycleTimes,
      currentPeriod,
    ),
  }
  const fullWindowThroughput = throughputRateForWindow(
    metrics.workItemCount,
    filters.windowDays,
  )
  const metricEvidence = buildMetricEvidence(
    snapshot,
    filters,
    metrics,
    currentPeriod,
  )
  const periodComparison = buildFlowPeriodComparison(
    snapshot,
    filters,
    reportNow,
  )
  const cycleTimeTrend = rollingCycleTimeTrend(metrics.cycleTimes)
  const completedOutliers = metrics.cycleTimes
    .filter(
      ({ cycleTime }) =>
        metrics.percentile85CycleTime !== null &&
        cycleTime > metrics.percentile85CycleTime,
    )
    .sort((left, right) => right.cycleTime - left.cycleTime)
  const workInProgressSnapshot = filterBoardSnapshot(snapshot, {
    ...filters,
    windowDays: null,
  })
  // Where finished work in this period spent its time, per measured stage.
  const timeShares = stageTimeShares(scopedSnapshot, filters.selectedColumnIds)
  const focusNow = buildFocusNowSummary({
    snapshot: workInProgressSnapshot,
    selectedColumnIds: filters.selectedColumnIds,
    metrics,
    windowDays: filters.windowDays,
    timeShares,
  })
  const agingWork = collectAgingWork(
    workInProgressSnapshot,
    filters.selectedColumnIds,
  )
  const beyondLimit = agingWork.filter(
    (item) =>
      agingBaselineState(
        item.ageInSelectedColumns,
        metrics.percentile85CycleTime,
      ) === 'beyond',
  ).length
  // The forecast samples its own recent window (last 8 weeks), independent of
  // the selected report period, so it always reflects the latest pace.
  const forecast = forecastThroughput({
    completedExits:
      calculateBoardMetrics(
        workInProgressSnapshot,
        filters.selectedColumnIds,
      )?.cycleTimes.map(({ cycleEnd }) => cycleEnd) ?? [],
    asOf: reportNow.toISOString(),
    currentWorkInProgress: agingWork.length,
    historyStart: earliestTransition(workInProgressSnapshot),
  })
  const dataQuality = assessDataQuality(
    snapshot,
    filters,
    reportNow,
    new Date(),
  )
  // What the briefing named a week ago and what happened to it since.
  const flagged = replayFlaggedItems(snapshot, filters, reportNow)
  const briefing = buildBriefing({
    completedCount: metrics.workItemCount,
    medianDays: metrics.medianCycleTime,
    p85Days: metrics.percentile85CycleTime,
    signals: focusNow.signals,
    activeCount: agingWork.length,
    beyondLimitCount: beyondLimit,
    reenteredCount: focusNow.reenteredWorkInProgress.length,
    comparison: periodComparison,
    dataQuality: dataQuality.status,
  })
  const isLate = (item: (typeof agingWork)[number]) =>
    agingBaselineState(
      item.ageInSelectedColumns,
      metrics.percentile85CycleTime,
    ) === 'beyond'
  const loads = stageLoads(
    snapshot.board.columns,
    filters.selectedColumnIds,
    agingWork,
    isLate,
  ).map((load) => {
    const share = timeShares.get(load.id)
    return share === undefined ? load : { ...load, timeShare: share }
  })
  const balance = startFinishBalance(
    workInProgressSnapshot,
    filters.selectedColumnIds,
  )
  const partialWeeks = new Set(
    metrics.weeklyThroughput
      .filter(({ week }) => isPartialWeek(week, currentPeriod, reportNow))
      .map(({ week }) => week),
  )
  const comparisonDays = periodComparison?.previous.period.days ?? 0
  const trends = {
    completed: describeTrend(
      periodComparison?.current.completedObservations ?? null,
      periodComparison?.previous.completedObservations ?? null,
      'count',
      'higher',
      comparisonDays,
    ),
    median: describeTrend(
      periodComparison?.current.medianCycleTimeDays ?? null,
      periodComparison?.previous.medianCycleTimeDays ?? null,
      'days',
      'lower',
      comparisonDays,
    ),
    p85: describeTrend(
      periodComparison?.current.percentile85CycleTimeDays ?? null,
      periodComparison?.previous.percentile85CycleTimeDays ?? null,
      'days',
      'lower',
      comparisonDays,
    ),
    throughput: describeTrend(
      periodComparison?.current.exitThroughputPerWeek ?? null,
      periodComparison?.previous.exitThroughputPerWeek ?? null,
      'throughput',
      'higher',
      comparisonDays,
    ),
  }

  return {
    loadedAt,
    reportNow,
    currentPeriod,
    scopedSnapshot,
    selectedColumns,
    completedMetrics,
    metrics,
    fullWindowThroughput,
    metricEvidence,
    periodComparison,
    cycleTimeTrend,
    completedOutliers,
    focusNow,
    agingWork,
    beyondLimit,
    forecast,
    dataQuality,
    flagged,
    briefing,
    loads,
    balance,
    partialWeeks,
    trends,
  }
}

function earliestTransition(snapshot: FlowBoardSnapshot): string | undefined {
  let earliest = Number.POSITIVE_INFINITY
  snapshot.transitions.forEach(({ enteredAt }) => {
    const time = Date.parse(enteredAt)
    if (Number.isFinite(time) && time < earliest) earliest = time
  })
  return Number.isFinite(earliest)
    ? new Date(earliest).toISOString()
    : undefined
}

export type DashboardReport = ReturnType<typeof computeReport>

/**
 * Where each item's stage sits against the review stage (the first measured
 * stage named like Review), so board and code can be compared.
 */
export function codeStageOf({ selectedColumns, agingWork }: DashboardReport) {
  const order = selectedColumns.map((column) => column.id)
  const reviewAt = selectedColumns.findIndex((column) =>
    /review/i.test(column.name),
  )
  const byItem = new Map(
    agingWork.map((item) => [item.item, order.indexOf(item.columnId)]),
  )
  return (item: string) => {
    const at = byItem.get(item) ?? -1
    if (reviewAt < 0 || at < 0) return undefined
    return at < reviewAt ? 'early' : at === reviewAt ? 'review' : 'late'
  }
}

/**
 * What the code adds: one code trail per active item (branch, commits, pull
 * request, review, merge), the review timing and two signals. Timing only,
 * never per person.
 */
export function codeReview(
  report: DashboardReport,
  pullRequests: PullRequestRecord[] | undefined,
  branches: BranchRecord[] | undefined,
) {
  const { agingWork, completedMetrics, loadedAt } = report
  return pullRequests
    ? pullRequestInsight({
        pullRequests,
        branches: branches ?? [],
        active: agingWork,
        finished: completedMetrics?.cycleTimes ?? [],
        now: Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date(),
        stageOf: codeStageOf(report),
      })
    : undefined
}

export type DashboardCodeReview = NonNullable<ReturnType<typeof codeReview>>

/** Active items with what their code says added to the status line. */
export function activeItemsWithCode(
  agingWork: DashboardReport['agingWork'],
  review: DashboardCodeReview | undefined,
) {
  return review
    ? agingWork.map((item) => {
        const state = review.states.get(item.item.trim().toUpperCase())
        return state
          ? {
              ...item,
              currentStatus: `${item.currentStatus} · ${state.short}`,
              statusDetail: state.full,
            }
          : item
      })
    : agingWork
}

/** Code: every active item, grouped by what its code says, ringed where the board says otherwise. */
export function codeTrailGroups(
  { agingWork }: DashboardReport,
  review: DashboardCodeReview | undefined,
) {
  if (!review || !agingWork.length) return undefined
  const labels: Array<[CodeReviewGroup['id'], string]> = [
    ['nocode', 'no linked code'],
    ['coding', 'coding'],
    ['review', 'in review'],
    ['approved', 'approved'],
    ['merged', 'merged'],
  ]
  const entry = (item: string) => review.groups.get(item)
  const groups = labels.map(([id, label]) => ({
    id,
    label,
    items: agingWork
      .filter((item) => (entry(item.item)?.id ?? 'nocode') === id)
      .sort((a, b) => b.ageInSelectedColumns - a.ageInSelectedColumns)
      .map((item) => {
        const found = entry(item.item)
        return {
          key: item.item,
          detail: `${item.column} on the board. ${found?.detail ?? 'No linked code.'}`,
          ...(item.browseUrl ? { browseUrl: item.browseUrl } : {}),
          ...(found?.tone ? { tone: found.tone } : {}),
          ...(found?.mismatch ? { mismatch: true } : {}),
        }
      }),
  }))
  const all = groups.flatMap((group) => group.items)
  const mismatches = all.filter((item) => item.mismatch).length
  const quiet = all.filter((item) => item.tone === 'quiet').length
  const headline = mismatches
    ? `Board and code disagree on ${mismatches} ${mismatches === 1 ? 'item' : 'items'}`
    : quiet
      ? `${quiet} ${quiet === 1 ? 'item has' : 'items have'} gone quiet`
      : 'Board and code agree'
  return { groups, headline, total: all.length }
}

/** What Steerloom AI is given about this dashboard. */
export function dashboardAiContext({
  snapshot,
  filters,
  report,
  review,
  pullRequests,
  branches,
  teamNotes,
  sprint,
}: {
  snapshot: FlowBoardSnapshot
  filters: AnalysisFilters
  report: DashboardReport
  review: DashboardCodeReview | undefined
  pullRequests?: PullRequestRecord[]
  branches?: BranchRecord[]
  teamNotes?: string
  /** Scrum boards: the Sprint tab, so the assistant can answer about it. */
  sprint?: SprintBriefing
}): AiReportContext {
  const {
    loadedAt,
    selectedColumns,
    completedMetrics,
    metrics,
    fullWindowThroughput,
    periodComparison,
    cycleTimeTrend,
    completedOutliers,
    focusNow,
    agingWork,
    forecast,
    dataQuality,
    loads,
    flagged,
  } = report
  const reportSourceLabel = snapshot.source.projectKey
    ? `${snapshot.source.projectKey} · ${snapshot.source.label}`
    : snapshot.source.label
  const sprintContext = sprint ? toAiSprintContext(sprint) : undefined
  const context = buildAiReportContext({
    generatedAt: snapshot.loadedAt,
    sourceLabel: reportSourceLabel,
    boardName: snapshot.board.name,
    filters,
    selectedColumnNames: selectedColumns.map((column) => column.name),
    metrics,
    exitThroughputPerWeek: fullWindowThroughput,
    focusSignals: focusNow.signals,
    weeklyCycleTimeTrend: cycleTimeTrend,
    delayedWorkInProgress: focusNow.delayedWorkInProgress,
    completedOutliers,
    reenteredWorkInProgress: focusNow.reenteredWorkInProgress,
    periodComparison,
    forecast,
    currentWork: agingWork,
    dataQuality,
    stageLoads: loads,
    flagged,
    quickMoveDays: QUICK_MOVE_DAYS,
    teamNotes,
    ...(pullRequests && review
      ? {
          pullRequests: buildPullRequestEvidence({
            pullRequests,
            branches: branches ?? [],
            trail: review.groups,
            repositories: new Set(pullRequests.map((record) => record.repo))
              .size,
            active: agingWork,
            delayedKeys: focusNow.delayedWorkInProgress.map(
              (item) => item.item,
            ),
            finished: completedMetrics?.cycleTimes ?? [],
            inside: review.inside,
            finishedCount: metrics.workItemCount,
            now: Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date(),
          }),
          codeLookup: buildPullRequestEvidence({
            pullRequests,
            branches: branches ?? [],
            trail: review.groups,
            repositories: new Set(pullRequests.map((record) => record.repo))
              .size,
            active: agingWork,
            delayedKeys: focusNow.delayedWorkInProgress.map(
              (item) => item.item,
            ),
            finished: completedMetrics?.cycleTimes ?? [],
            inside: review.inside,
            finishedCount: metrics.workItemCount,
            now: Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date(),
            limit: CODE_LOOKUP_LIMIT,
          }).items,
        }
      : {}),
  })
  return sprintContext ? { ...context, sprint: sprintContext } : context
}
