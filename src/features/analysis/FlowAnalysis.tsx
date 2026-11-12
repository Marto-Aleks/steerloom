import { AskAiTag } from '../../components/AskAiTag'
import { MetricCard } from './ReportMetricCard'
import { itemLinkResolver } from '../../lib/workspace/item-links'
import { MeasureScope } from './MeasureScope'
import { weeklyThroughputForPeriod } from '../../lib/statistics/weekly-throughput'
import { summarizeServiceExpectation } from '../../lib/statistics/service-expectation'
import { assessDataQuality } from '../../lib/statistics/data-quality'
import { DataQualityPanel } from './DataQualityPanel'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import {
  GlassButton,
  GlassModal,
  GlassPanel,
  StatusMessage,
} from '../../components/ui'
import { buildAiReportContext } from '../../lib/ai/report-context'
import {
  calculateBoardMetrics,
  rollingCycleTimeTrend,
  throughputRateForWindow,
} from '../../lib/statistics'
import {
  buildFlowPeriodComparison,
  buildMetricEvidence,
  type FlowMetricId,
} from '../../lib/statistics/flow-evidence'
import { analysisScopeLabel } from '../../lib/statistics/filter'
import { replayFlaggedItems } from '../../lib/statistics/flagged-replay'
import {
  stageTimeShares,
  startFinishBalance,
} from '../../lib/statistics/stage-time'
import { buildFocusNowSummary } from '../../lib/statistics/focus-now'
import { forecastThroughput } from '../../lib/statistics/forecast'
import { buildBriefing, stageLoads } from '../../lib/statistics/briefing'
import {
  filterBoardSnapshot,
  resolveExitPeriod,
} from '../../lib/statistics/snapshot-filter'
import type {
  AnalysisFilters,
  FlowBoardSnapshot,
  FlowMetrics,
} from '../../types'
import { AiChatPanel, type AiChatDraftRequest } from './AiChatPanel'
import {
  defaultMetrics,
  type DashboardMetric,
  type ReviewMode,
} from '../../lib/workspace/model'
import {
  agingBaselineState,
  collectAgingWork,
} from '../../lib/statistics/aging-work'
import { standupPrompt, periodSummaryPrompt } from '../../lib/ai/review-prompts'
import { AgingWorkPanel } from './AgingWorkPanel'
import {
  describeTrend,
  formatNumber,
  isPartialWeek,
  metricTitle,
} from './format'
import { MetricEvidenceView } from './MetricEvidenceView'
import { stagger } from './motion'
import { ReportMenu } from './ReportMenu'
import { HeroSignal, TodayPanel } from './TodayPanel'
import { WorkStagesPanel } from './WorkStagesPanel'
import { FlaggedPanel } from './FlaggedPanel'
import { ForecastPanel } from './ForecastPanel'
import { CodeReviewPanel, type CodeReviewGroup } from './CodeReviewPanel'
import { pullRequestInsight } from '../../lib/statistics/pull-requests'
import {
  buildPullRequestEvidence,
  CODE_LOOKUP_LIMIT,
} from '../../lib/ai/pull-request-evidence'
import type {
  BranchRecord,
  PullRequestRecord,
} from '../../lib/data-source/github'

const ReportCharts = lazy(() =>
  import('./ReportCharts').then((module) => ({
    default: module.ReportCharts,
  })),
)

interface FlowAnalysisProps {
  snapshot: FlowBoardSnapshot
  filters: AnalysisFilters
  selectedMetrics?: DashboardMetric[]
  /** Reloads the board; omitted where the report cannot be refreshed. */
  onRefresh?: () => void
  /** Opens report settings; omitted for read-only viewers. */
  onAdjust?: () => void
  /** Saves a new scope from the briefing itself; omitted for read-only viewers. */
  onFiltersChange?: (filters: AnalysisFilters) => void
  /** What the team wrote for Steerloom AI about how it works. */
  teamNotes?: string
  /** Owners and admins: save the team notes with this briefing. */
  onTeamNotesChange?: (notes: string) => void
  /** Owners and admins: the AI key form, shown inside the AI panel until a key works. */
  aiKeyForm?: ReactNode
  /** Changes when the workspace key changes, so the AI panel checks again. */
  aiConfigurationKey?: string
  refreshing?: boolean
  reviewMode?: ReviewMode
  /** The AI chat needs a workspace; the open demo has none. */
  aiChat?: boolean
  /** Pull requests from the dashboard's GitHub repositories, when connected. */
  pullRequests?: PullRequestRecord[]
  /** Branches that name the board's items, with their last commit. */
  branches?: BranchRecord[]
  /** Why pull requests could not be read; the briefing works without them. */
  pullRequestError?: string
  /** GitHub is being read for this load. */
  pullRequestsLoading?: boolean
  /** A closing line for the code view, such as where to get it for real. */
  codeHint?: ReactNode
}

// Every number on the dashboard is derived here, once per snapshot and filter
// set, so interaction state (modals, filters) never re-runs the statistics or
// restarts chart animations.
function computeReport(snapshot: FlowBoardSnapshot, filters: AnalysisFilters) {
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

export function FlowAnalysis({
  snapshot,
  filters,
  onRefresh,
  onAdjust,
  onFiltersChange,
  teamNotes,
  onTeamNotesChange,
  aiKeyForm,
  aiConfigurationKey,
  refreshing = false,
  selectedMetrics = defaultMetrics,
  aiChat = true,
  pullRequests,
  branches,
  pullRequestError,
  pullRequestsLoading,
  codeHint,
}: FlowAnalysisProps) {
  const [showMethod, setShowMethod] = useState(false)
  const enabled = (metric: DashboardMetric) => selectedMetrics.includes(metric)
  const showAging = enabled('aging-wip')
  const [activeMetric, setActiveMetric] = useState<FlowMetricId | null>(null)
  const [agingOpen, setAgingOpen] = useState(false)
  const [aiDraftRequest, setAiDraftRequest] = useState<AiChatDraftRequest>()
  // Data appears at once: managers read numbers, they do not watch them grow.
  const animate = false
  const [aiInvite, setAiInvite] = useState(false)
  const requestAiDraft = (prompt: string, fallback?: string) => {
    if (!aiChat) {
      setAiInvite(true)
      return
    }
    setAiDraftRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      prompt,
      autoSend: Boolean(fallback),
      fallback,
    }))
  }
  const report = useMemo(
    () => computeReport(snapshot, filters),
    [snapshot, filters],
  )
  const itemLinks = useMemo(() => itemLinkResolver(snapshot), [snapshot])
  const itemTitles = useMemo(() => {
    const titles = new Map(
      snapshot.issues.flatMap((issue) =>
        issue.title ? [[issue.key.trim().toUpperCase(), issue.title]] : [],
      ),
    )
    return (key: string) => titles.get(key.trim().toUpperCase())
  }, [snapshot])
  const {
    loadedAt,
    currentPeriod,
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
  } = report
  // Where each item's stage sits against the review stage (the first
  // measured stage named like Review), so board and code can be compared.
  const stageOf = useMemo(() => {
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
  }, [selectedColumns, agingWork])
  // What the code adds: one code trail per active item (branch, commits,
  // pull request, review, merge), the review timing and two signals. Timing
  // only, never per person.
  const review = useMemo(
    () =>
      pullRequests
        ? pullRequestInsight({
            pullRequests,
            branches: branches ?? [],
            active: agingWork,
            finished: completedMetrics?.cycleTimes ?? [],
            now: Number.isFinite(loadedAt.getTime()) ? loadedAt : new Date(),
            stageOf,
          })
        : undefined,
    [pullRequests, branches, agingWork, completedMetrics, loadedAt, stageOf],
  )
  const activeItems = useMemo(
    () =>
      review
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
        : agingWork,
    [review, agingWork],
  )
  // Says what GitHub added to this load, so "nothing shows" has an answer.
  const githubLine = useMemo(() => {
    if (pullRequestsLoading)
      return { text: 'Reading pull requests from GitHub…' }
    if (!pullRequests) return undefined
    const keys = new Set([
      ...pullRequests.flatMap((record) => record.keys),
      ...(branches ?? []).flatMap((record) => record.keys),
    ])
    const items = new Set(
      [
        ...agingWork.map((point) => point.item),
        ...(completedMetrics?.cycleTimes ?? []).map((point) => point.item),
      ].map((item) => item.trim().toUpperCase()),
    )
    const matched = [...items].filter((item) => keys.has(item)).length
    const plural = (value: number, word: string) =>
      `${value} ${word}${value === 1 ? '' : 'es'.slice(word.endsWith('h') ? 0 : 1)}`
    const branchCount = branches?.length ?? 0
    const full = `GitHub: ${plural(pullRequests.length, 'pull request')}${branchCount ? ` and ${plural(branchCount, 'branch')}` : ''} with item keys · ${matched} of this board’s items ${matched === 1 ? 'has' : 'have'} code`
    // When code was found, the count is enough and the rest is on hover.
    // When none was, the whole line is the answer to "why does nothing show".
    return matched
      ? {
          text: `GitHub · code for ${matched} ${matched === 1 ? 'item' : 'items'}`,
          detail: full,
        }
      : { text: full }
  }, [pullRequestsLoading, pullRequests, branches, agingWork, completedMetrics])
  // Code: every active item, grouped by what its code says, ringed where
  // the board says otherwise.
  const codeTrail = useMemo(() => {
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
  }, [review, agingWork])
  const delayedItems = useMemo(
    () =>
      review
        ? focusNow.delayedWorkInProgress.map(
            (item) =>
              activeItems.find((active) => active.item === item.item) ?? item,
          )
        : focusNow.delayedWorkInProgress,
    [review, focusNow, activeItems],
  )
  const stageFlowLabel = selectedColumns
    .map((column) => column.name)
    .join(' → ')
  const measuredColumnsLabel = stageFlowLabel || 'selected columns'
  const reportSourceLabel = snapshot.source.projectKey
    ? `${snapshot.source.projectKey} · ${snapshot.source.label}`
    : snapshot.source.label
  const serviceExpectation = filters.serviceExpectation
  const serviceSummary = serviceExpectation
    ? summarizeServiceExpectation(
        serviceExpectation,
        metrics.cycleTimes,
        agingWork,
      )
    : null
  // The full list of active work opens on request: the hero already shows
  // the items past the usual limit.
  const agingPanel = showAging ? (
    <GlassModal
      className="aging-work-modal"
      open={agingOpen}
      onClose={() => setAgingOpen(false)}
      title="Active work"
      description="Every active item, oldest first. Filter, open an item's history, or ask Steerloom AI about a selection."
    >
      <AgingWorkPanel
        items={activeItems}
        p85={metrics.percentile85CycleTime}
        sampleCount={metrics.workItemCount}
        onAsk={(prompt) => {
          setAgingOpen(false)
          requestAiDraft(prompt)
        }}
      />
    </GlassModal>
  ) : null
  const aiReportContext = buildAiReportContext({
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
  const aiJiraScope =
    (snapshot.source.kind === 'jira-data-center' ||
      snapshot.source.kind === 'jira-cloud') &&
    snapshot.source.connectionId &&
    snapshot.source.projectKey
      ? {
          connectionId: snapshot.source.connectionId,
          projectKey: snapshot.source.projectKey,
        }
      : snapshot.source.kind === 'trello' && snapshot.source.connectionId
        ? {
            connectionId: snapshot.source.connectionId,
            projectKey: 'CARD',
            provider: 'trello' as const,
            boardId: snapshot.board.id,
          }
        : snapshot.source.kind === 'azure-devops' &&
            snapshot.source.connectionId
          ? {
              connectionId: snapshot.source.connectionId,
              projectKey: 'ADO',
              provider: 'azure-devops' as const,
              boardId: snapshot.board.id,
            }
          : undefined
  const refreshedLabel = Number.isFinite(loadedAt.getTime())
    ? loadedAt.toLocaleString()
    : 'an unknown time'
  // One hero per briefing: work already past the usual limit outranks the
  // forecast; otherwise the forecast date (with its confidence) leads.
  const heroSignal = focusNow.signals.find(
    (signal) => signal.id === 'delayed-wip',
  )
  const otherSignals = [
    ...(heroSignal
      ? focusNow.signals.filter((signal) => signal !== heroSignal)
      : focusNow.signals),
    ...(review?.signals ?? []),
  ]
  const forecastStep = heroSignal ? 2 + Math.min(otherSignals.length, 3) : 0
  const metricsBase = forecastStep + 1
  const finishedCount = metrics.workItemCount
  const finishedLabel = `${finishedCount.toLocaleString()} finished ${finishedCount === 1 ? 'item' : 'items'}`
  const p85 = metrics.percentile85CycleTime

  const details = (
    <>
      <Suspense
        fallback={<div className="analysis-widget-grid" aria-hidden="true" />}
      >
        <ReportCharts
          metrics={metrics}
          completedOutliers={completedOutliers}
          partialWeeks={partialWeeks}
          enabled={enabled}
          animate={animate}
        />
      </Suspense>
    </>
  )
  const evidence = (
    <>
      <section className="briefing-metrics" aria-labelledby="metrics-title">
        <div className="briefing-metrics__header">
          <h2 id="metrics-title" className="briefing-metrics__title">
            How the team is trending
          </h2>
          {enabled('cycle-trend') &&
            periodComparison?.previous.historyCoverage === 'partial' && (
              <p className="briefing-metrics__note">
                The earlier period has partial history, so the changes are a
                rough guide.
              </p>
            )}
        </div>
        <div className="briefing-metrics__row" aria-label="Key measures">
          <MetricCard
            visible={enabled('exit-throughput')}
            metric="exit-throughput"
            label="Throughput"
            value={
              fullWindowThroughput === null
                ? 'Not available'
                : formatNumber(fullWindowThroughput)
            }
            unit={fullWindowThroughput === null ? undefined : 'items/week'}
            detail={
              fullWindowThroughput === null || filters.windowDays === null
                ? 'Choose a fixed period to calculate the weekly rate'
                : `Average over ${filters.windowDays} days, ${finishedLabel}`
            }
            trend={enabled('cycle-trend') ? trends.throughput : undefined}
            sparkline={metrics.weeklyThroughput.map((point) => point.items)}
            onExplain={setActiveMetric}
            style={stagger(metricsBase)}
          />
          <MetricCard
            visible={enabled('median-cycle-time')}
            metric="median-cycle-time"
            label="Cycle time"
            value={
              metrics.medianCycleTime === null
                ? 'Not available'
                : formatNumber(metrics.medianCycleTime)
            }
            unit={metrics.medianCycleTime === null ? undefined : 'days'}
            detail={
              metrics.medianCycleTime === null
                ? 'No finished items in this scope yet'
                : `Median of ${finishedLabel}`
            }
            trend={enabled('cycle-trend') ? trends.median : undefined}
            sparkline={cycleTimeTrend
              .map((point) => point.rollingMedianCycleTime)
              .filter((value): value is number => value !== null)}
            onExplain={setActiveMetric}
            style={stagger(metricsBase + 1)}
          />
          <MetricCard
            visible={enabled('percentile-85')}
            metric="percentile-85"
            label="Usual limit (P85)"
            value={p85 === null ? 'Not available' : formatNumber(p85)}
            unit={p85 === null ? undefined : 'days'}
            detail={
              p85 === null
                ? 'No finished items in this scope yet'
                : `85% of ${finishedLabel} took this long or less`
            }
            trend={enabled('cycle-trend') ? trends.p85 : undefined}
            sparkline={cycleTimeTrend
              .map((point) => point.rollingPercentile85CycleTime)
              .filter((value): value is number => value !== null)}
            onExplain={setActiveMetric}
            style={stagger(metricsBase + 2)}
          />
        </div>
      </section>
    </>
  )

  return (
    <section aria-labelledby="insights-title" className="screen-stack report">
      <header className="report-hero" data-tone={briefing.tone}>
        <div className="report-hero__copy">
          <div className="report-hero__intro">
            <div className="report-hero__text">
              <h1 id="insights-title" className="report-hero__headline">
                {briefing.headline}
              </h1>
              <p className="report-hero__summary">
                {briefing.summary}
                {beyondLimit > 0 && showAging && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="report-hero__link"
                      onClick={() => setAgingOpen(true)}
                    >
                      Show {beyondLimit === 1 ? 'it' : `these ${beyondLimit}`}
                    </button>
                  </>
                )}
              </p>
              <MeasureScope
                snapshot={snapshot}
                filters={filters}
                onChange={onFiltersChange}
                onMoreOptions={onAdjust}
              />
              {githubLine && !pullRequestError && (
                <p
                  className="metadata-copy"
                  role="status"
                  title={githubLine.detail}
                >
                  {githubLine.text}
                </p>
              )}
              {pullRequestError && (
                <StatusMessage variant="warning">
                  {pullRequestError}
                </StatusMessage>
              )}
            </div>
            <div className="report-hero__actions">
              {/* Both open the chat with the question ready to send, so the
                  group says where they go. */}
              <div
                className="report-hero__ask"
                role="group"
                aria-labelledby="report-hero-ask-label"
              >
                <span id="report-hero-ask-label">
                  <AskAiTag />
                </span>
                <button
                  type="button"
                  className="briefing-link"
                  title="Opens Steerloom AI with this question, ready to send"
                  onClick={() =>
                    requestAiDraft(
                      standupPrompt(agingWork, metrics.percentile85CycleTime),
                    )
                  }
                >
                  What to raise today <span aria-hidden="true">→</span>
                </button>
                <button
                  type="button"
                  className="briefing-link"
                  title="Opens Steerloom AI with this question, ready to send"
                  onClick={() => requestAiDraft(periodSummaryPrompt)}
                >
                  Summarise this period <span aria-hidden="true">→</span>
                </button>
              </div>
              <ReportMenu
                items={[
                  ...(onRefresh
                    ? [
                        {
                          label: refreshing ? 'Refreshing…' : 'Refresh board',
                          onSelect: onRefresh,
                          disabled: refreshing,
                        },
                      ]
                    : []),
                  ...(onAdjust
                    ? [{ label: 'Adjust report', onSelect: onAdjust }]
                    : []),
                  {
                    label: showMethod
                      ? 'Hide how this was measured'
                      : 'How this was measured',
                    onSelect: () => setShowMethod((value) => !value),
                  },
                ]}
              />
            </div>
          </div>
          {briefing.caveats.map((caveat) => (
            <p className="report-hero__caveat" key={caveat}>
              {caveat}
            </p>
          ))}
          {showMethod && (
            <section
              className="report-data-details"
              aria-label="How this was measured"
            >
              <p className="report-hero__meta metadata-copy">
                <span>{measuredColumnsLabel}</span>
                {' · '}
                <span>{analysisScopeLabel(filters)}</span>
                {' · '}
                <span>Refreshed {refreshedLabel}</span>
                {' · '}
                <span>{reportSourceLabel}</span>
              </p>
              <div className="report-header__metadata surface-inset">
                <span>
                  <strong>{metrics.uniqueItemCount.toLocaleString()}</strong>{' '}
                  {metrics.uniqueItemCount === 1 ? 'item' : 'items'} in this
                  report
                  {dataQuality.uniqueIssueCount !== metrics.uniqueItemCount &&
                    ` (of ${dataQuality.uniqueIssueCount.toLocaleString()} on the board)`}
                </span>
                <span>
                  <strong>{selectedColumns.length.toLocaleString()}</strong>{' '}
                  {selectedColumns.length === 1 ? 'stage' : 'stages'} measured
                </span>
                <span>Time in calendar days</span>
              </div>
              <p className="metadata-copy">
                An item counts as finished when it leaves the measured stages
                for the last time within the period. Its cycle time adds up
                every visit to those stages, including when work comes back, and
                leaves out time spent elsewhere. Work in progress uses all
                loaded history. The usual limit (P85) is the time within which
                85% of finished items were done: a reference, separate from any
                target your team sets.
              </p>
              <details className="report-method">
                <summary>Exact calculation</summary>
                <p className="metadata-copy">
                  Each finished item contributes one observation, on its latest
                  exit from the measured stages. Cycle time sums all observed
                  visits to those stages. P85 uses linear interpolation at index
                  0.85 × (n − 1) in the sorted sample. Days are calendar days of
                  24 hours.
                </p>
              </details>
              <DataQualityPanel
                report={dataQuality}
                fixes={onRefresh ? ['refresh'] : []}
                onFix={(fix) => {
                  if (fix.kind === 'refresh') onRefresh?.()
                }}
              />
            </section>
          )}
        </div>
      </header>

      <div
        className="briefing-stage"
        data-hero={heroSignal ? 'signal' : 'forecast'}
        data-layout={loads.length ? 'split' : 'single'}
      >
        {heroSignal ? (
          <HeroSignal
            signal={heroSignal}
            items={delayedItems}
            activeCount={agingWork.length}
            limitDays={p85}
            onAsk={requestAiDraft}
            onShowAll={showAging ? () => setAgingOpen(true) : undefined}
          />
        ) : (
          <ForecastPanel result={forecast} onAsk={requestAiDraft} hero />
        )}
        {loads.length ? (
          <WorkStagesPanel
            loads={loads}
            limitDays={p85}
            flow={
              balance
                ? {
                    started: balance.started,
                    finished: balance.finished,
                    days: balance.days,
                  }
                : undefined
            }
            finishedCount={metrics.workItemCount}
            style={stagger(1)}
          />
        ) : null}
      </div>
      {codeTrail && (
        <CodeReviewPanel
          title="Code"
          stage="the board"
          headline={codeTrail.headline}
          sub={`${codeTrail.total} active ${codeTrail.total === 1 ? 'item' : 'items'}, grouped by what the code says.`}
          legend={[
            { tone: 'alive', label: 'moving' },
            { tone: 'quiet', label: 'quiet a week+' },
            { tone: 'waiting', label: 'waiting for a first look' },
          ]}
          groups={codeTrail.groups}
          readyToMergedDays={review?.inside?.pullRequestDays}
          finishedLinked={review?.inside?.linked}
          onAsk={requestAiDraft}
          hint={codeHint}
        />
      )}

      {snapshot.historyWarnings?.map((warning) => (
        <StatusMessage variant="warning" key={warning}>
          {warning}
        </StatusMessage>
      ))}
      {!completedMetrics && (
        <StatusMessage variant="warning" title="No completed sample yet">
          Current work is available, but cycle-time and service-level estimates
          need items that have exited your measured stages. Try a broader period
          or refresh after work completes.
        </StatusMessage>
      )}
      {otherSignals.length > 0 && (
        <TodayPanel
          signals={otherSignals}
          heroSignal={heroSignal}
          onAsk={requestAiDraft}
          baseDelay={2 * 60}
        />
      )}
      {flagged && <FlaggedPanel replay={flagged} onAsk={requestAiDraft} />}
      {heroSignal && (
        <ForecastPanel
          result={forecast}
          onAsk={requestAiDraft}
          style={stagger(forecastStep)}
        />
      )}
      {serviceExpectation && serviceSummary && (
        <GlassPanel
          className="panel-body sl-rise"
          style={stagger(2)}
          aria-labelledby="service-expectation-title"
        >
          <h2 id="service-expectation-title" className="section-title">
            Team service expectation
          </h2>
          <p className="body-copy mt-2">
            Target: {serviceExpectation.targetPercent}% of completed work within{' '}
            {serviceExpectation.days} calendar days in measured stages.
          </p>
          <p className="body-copy mt-2">
            {serviceSummary.attainmentPercent === null
              ? 'Attainment unavailable: no completed observations in this scope.'
              : `${formatNumber(serviceSummary.attainmentPercent)}% within threshold (${serviceSummary.within} of ${serviceSummary.sampleCount}). ${serviceSummary.meetsTarget ? 'Meeting' : 'Below'} target.`}
          </p>
          <p className="metadata-copy mt-2">
            {serviceSummary.beyond.length} active items already exceed{' '}
            {serviceExpectation.days} days. Active items are excluded from
            completed attainment; this is not a forecast of remaining time.
            {serviceSummary.sampleCount > 0 && serviceSummary.sampleCount < 10
              ? ' Small completed sample: interpret attainment cautiously.'
              : ''}
          </p>
          <button
            type="button"
            className="briefing-link"
            onClick={() =>
              requestAiDraft(
                `Review the team service expectation: ${serviceExpectation.targetPercent}% within ${serviceExpectation.days} calendar days of accumulated measured-stage time. Completed attainment: ${serviceSummary.within} of ${serviceSummary.sampleCount}. Active items beyond threshold: ${serviceSummary.beyond.length}. Cite report evidence, distinguish this target from historical P85, and suggest a concrete team decision.`,
                'Review active items beyond the agreed threshold and discuss whether workflow policies or the expectation need attention.',
              )
            }
          >
            <AskAiTag /> · Investigate service expectation{' '}
            <span aria-hidden="true">→</span>
          </button>
        </GlassPanel>
      )}
      {evidence}

      {!aiChat && (
        <GlassModal
          open={aiInvite}
          onClose={() => setAiInvite(false)}
          title="Ask Steerloom AI about your own board"
          description="The assistant reads your board's evidence and answers in plain words, read-only. It needs a free account, your board and an AI key of your own: Claude, OpenAI or your company’s."
        >
          <div className="feedback-form__actions">
            <GlassButton onClick={() => setAiInvite(false)}>
              Keep exploring
            </GlassButton>
            <a
              className="glass-button"
              data-variant="primary"
              href="/?hosted=1&page=signup"
            >
              Create a free account
            </a>
          </div>
        </GlassModal>
      )}
      {aiChat && (
        <AiChatPanel
          context={aiReportContext}
          jiraScope={aiJiraScope}
          draftRequest={aiDraftRequest}
          itemLinks={itemLinks}
          itemTitles={itemTitles}
          keyForm={aiKeyForm}
          configurationKey={aiConfigurationKey}
          teamNotes={teamNotes}
          onTeamNotesChange={onTeamNotesChange}
        />
      )}

      <GlassModal
        className="metric-evidence-modal"
        open={activeMetric !== null}
        onClose={() => setActiveMetric(null)}
        title={activeMetric ? metricTitle(activeMetric) : 'Metric evidence'}
        description="What the number means, what counted, and the items behind it."
      >
        {activeMetric && (
          <MetricEvidenceView
            metric={activeMetric}
            evidence={metricEvidence}
            metrics={metrics}
            period={currentPeriod}
            throughput={fullWindowThroughput}
          />
        )}
      </GlassModal>

      {details}
      {agingPanel}
    </section>
  )
}
