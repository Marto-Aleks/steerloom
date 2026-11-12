import type {
  AiItemPullRequests,
  AiPullRequestEvidence,
} from './pull-request-evidence'
import type { DataQualityReport } from '../statistics/data-quality'
import type {
  AnalysisFilters,
  CycleTimePoint,
  CycleTimeTrendPoint,
  DistributionPoint,
  FlowMetrics,
  ThroughputPoint,
  WorkInProgressAgePoint,
} from '../../types'
import type { FocusSignal } from '../statistics/focus-now'
import type { FlowPeriodComparison } from '../statistics/flow-evidence'
import type {
  ThroughputForecast,
  ThroughputForecastResult,
} from '../statistics/forecast'
import type { AiJiraEvidenceBundle } from './jira-evidence'

export interface AiStageWork {
  stage: string
  count: number
  items: Array<{ key: string; ageDays: number; daysInStage: number }>
}

export interface AiReportContext {
  generatedAt: string
  sourceLabel: string
  boardName: string
  scope: {
    selectedColumns: string[]
    ticketTypes: string[]
    windowDays: number | null
    serviceExpectation?: AnalysisFilters['serviceExpectation']
  }
  headline: {
    completedObservations: number
    medianCycleTimeDays: number | null
    percentile85CycleTimeDays: number | null
    exitThroughputPerWeek: number | null
  }
  focusSignals: Array<{
    severity: FocusSignal['severity']
    title: string
    evidence: string
    suggestedTeamPrompt: string
  }>
  ticketGroupTotals: {
    completedOutliers: number
    delayedWorkInProgress: number
    reenteredWorkInProgress: number
  }
  weeklyThroughput: ThroughputPoint[]
  cycleTimeDistribution: Array<{
    range: string
    items: number
    sharePercent: number
  }>
  weeklyCycleTimeTrend: Array<{
    week: string
    completedItems: number
    sampleItems: number
    medianDays: number | null
    percentile85Days: number | null
  }>
  periodComparison?: {
    current: AiPeriodSummary
    previous: AiPeriodSummary
  }
  delayedWorkInProgress: Array<{
    key: string
    status: string
    ageDays: number
  }>
  completedOutliers: Array<{
    key: string
    cycleTimeDays: number
  }>
  reenteredWorkInProgress: Array<{
    key: string
    status: string
  }>
  /** Where active work sits now: each stage with its items, longest in the stage first */
  workInProgressByStage?: AiStageWork[]
  forecast?: AiForecast
  /** Steerloom's own data checks: how far the numbers can be trusted, and why. */
  dataChecks?: AiDataChecks
  jiraEvidence?: AiJiraEvidenceBundle
  /** What the team wrote about how it works; facts for every answer. */
  teamNotes?: string
  /** GitHub pull requests next to the board, when the dashboard has them. */
  pullRequests?: AiPullRequestEvidence
  /**
   * Every board item's code trail, for the get_code tool to look up. Never
   * written into the prompt: only what the assistant asks for is read.
   */
  codeLookup?: AiItemPullRequests[]
}

export interface AiDataChecks {
  verdict: 'strong' | 'directional' | 'weak'
  summary: string
  /** Each finding as "Title: detail" */
  findings: string[]
}

/**
 * Monte Carlo forecast computed by Steerloom from sampled daily throughput.
 * Dates are yyyy-mm-dd; a null finish date means beyond a year.
 */
export type AiForecast = ThroughputForecast | { unavailable: string }

interface AiPeriodSummary {
  start: string
  endExclusive: string
  completedObservations: number
  medianCycleTimeDays: number | null
  percentile85CycleTimeDays: number | null
  exitThroughputPerWeek: number
  delayedWorkInProgress: number | null
  reenteredWorkInProgress: number
  historyCoverage: 'complete' | 'partial'
}

interface BuildAiReportContextInput {
  generatedAt: string
  sourceLabel: string
  boardName: string
  filters: AnalysisFilters
  selectedColumnNames: string[]
  metrics: FlowMetrics
  exitThroughputPerWeek: number | null
  focusSignals: FocusSignal[]
  weeklyCycleTimeTrend: CycleTimeTrendPoint[]
  delayedWorkInProgress: WorkInProgressAgePoint[]
  completedOutliers: CycleTimePoint[]
  reenteredWorkInProgress: Array<{
    item: string
    currentStatus: string
  }>
  periodComparison?: FlowPeriodComparison | null
  forecast?: ThroughputForecastResult | null
  /** Every active item with its current stage (the aging work list) */
  currentWork?: Array<{
    item: string
    column: string
    ageInSelectedColumns: number
    currentStageAgeDays: number
  }>
  dataQuality?: Pick<DataQualityReport, 'verdict' | 'findings'>
  teamNotes?: string
  pullRequests?: AiPullRequestEvidence
  codeLookup?: AiItemPullRequests[]
}

/** Every signal a briefing can show at once. */
export const AI_SIGNAL_LIMIT = 8
const SERIES_LIMIT = 26
const TICKET_LIMIT = 25

export function buildAiReportContext({
  generatedAt,
  sourceLabel,
  boardName,
  filters,
  selectedColumnNames,
  metrics,
  exitThroughputPerWeek,
  focusSignals,
  weeklyCycleTimeTrend,
  delayedWorkInProgress,
  completedOutliers,
  reenteredWorkInProgress,
  periodComparison,
  forecast,
  currentWork,
  dataQuality,
  teamNotes,
  pullRequests,
  codeLookup,
}: BuildAiReportContextInput): AiReportContext {
  return {
    generatedAt,
    sourceLabel,
    boardName,
    scope: {
      selectedColumns: selectedColumnNames,
      ticketTypes: filters.ticketTypes,
      windowDays: filters.windowDays,
      ...(filters.serviceExpectation
        ? { serviceExpectation: filters.serviceExpectation }
        : {}),
    },
    headline: {
      completedObservations: metrics.workItemCount,
      medianCycleTimeDays: metrics.medianCycleTime,
      percentile85CycleTimeDays: metrics.percentile85CycleTime,
      exitThroughputPerWeek,
    },
    focusSignals: focusSignals.slice(0, AI_SIGNAL_LIMIT).map((signal) => ({
      severity: signal.severity,
      title: signal.title,
      evidence: signal.evidence,
      suggestedTeamPrompt: signal.action,
    })),
    ticketGroupTotals: {
      completedOutliers: completedOutliers.length,
      delayedWorkInProgress: delayedWorkInProgress.length,
      reenteredWorkInProgress: reenteredWorkInProgress.length,
    },
    weeklyThroughput: takeLatest(metrics.weeklyThroughput, SERIES_LIMIT),
    cycleTimeDistribution: metrics.distribution.map(toDistributionItem),
    weeklyCycleTimeTrend: takeLatest(weeklyCycleTimeTrend, SERIES_LIMIT).map(
      (point) => ({
        week: point.week,
        completedItems: point.completedItemCount,
        sampleItems: point.rollingItemCount,
        medianDays: point.rollingMedianCycleTime,
        percentile85Days: point.rollingPercentile85CycleTime,
      }),
    ),
    ...(periodComparison
      ? {
          periodComparison: {
            current: toAiPeriodSummary(periodComparison.current),
            previous: toAiPeriodSummary(periodComparison.previous),
          },
        }
      : {}),
    delayedWorkInProgress: delayedWorkInProgress
      .slice(0, TICKET_LIMIT)
      .map((item) => ({
        key: item.item,
        status: item.currentStatus,
        ageDays: item.ageInSelectedColumns,
      })),
    completedOutliers: completedOutliers.slice(0, TICKET_LIMIT).map((item) => ({
      key: item.item,
      cycleTimeDays: item.cycleTime,
    })),
    reenteredWorkInProgress: reenteredWorkInProgress
      .slice(0, TICKET_LIMIT)
      .map((item) => ({
        key: item.item,
        status: item.currentStatus,
      })),
    ...(currentWork?.length
      ? { workInProgressByStage: stageWork(currentWork, selectedColumnNames) }
      : {}),
    ...(forecast ? { forecast: toAiForecast(forecast) } : {}),
    ...(dataQuality
      ? {
          dataChecks: {
            verdict: dataQuality.verdict.level,
            summary: dataQuality.verdict.sentence,
            findings: dataQuality.findings
              .slice(0, 8)
              .map((finding) => `${finding.title}: ${finding.detail}`),
          },
        }
      : {}),
    ...(teamNotes?.trim() ? { teamNotes: teamNotes.trim() } : {}),
    ...(pullRequests?.items.length ? { pullRequests } : {}),
    ...(codeLookup?.length ? { codeLookup } : {}),
  }
}

function toAiForecast(result: ThroughputForecastResult): AiForecast {
  if ('unavailable' in result) return { unavailable: result.unavailable }
  const { basis, finishCurrentWork, nextTwoWeeks } = result.forecast
  return {
    basis: { ...basis },
    finishCurrentWork: finishCurrentWork ? { ...finishCurrentWork } : null,
    nextTwoWeeks: { ...nextTwoWeeks },
  }
}

function toAiPeriodSummary(
  summary: FlowPeriodComparison['current'],
): AiPeriodSummary {
  return {
    start: summary.period.start,
    endExclusive: summary.period.end,
    completedObservations: summary.completedObservations,
    medianCycleTimeDays: summary.medianCycleTimeDays,
    percentile85CycleTimeDays: summary.percentile85CycleTimeDays,
    exitThroughputPerWeek: summary.exitThroughputPerWeek,
    delayedWorkInProgress: summary.delayedWorkInProgress,
    reenteredWorkInProgress: summary.reenteredWorkInProgress,
    historyCoverage: summary.historyCoverage,
  }
}

function takeLatest<T>(values: T[], limit: number): T[] {
  return values.slice(Math.max(0, values.length - limit))
}

function toDistributionItem(point: DistributionPoint) {
  return {
    range: point.range,
    items: point.items,
    sharePercent: point.share,
  }
}

export const STAGE_LIMIT = 20
export const STAGE_ITEM_LIMIT = 15

/** Active work grouped by its current stage, in board order, longest waiting first. */
function stageWork(
  items: NonNullable<BuildAiReportContextInput['currentWork']>,
  selectedColumnNames: string[],
): AiStageWork[] {
  const order = [
    ...selectedColumnNames,
    ...items
      .map((item) => item.column)
      .filter((name) => !selectedColumnNames.includes(name)),
  ]
  return [...new Set(order)]
    .map((stage) => {
      const inStage = items
        .filter((item) => item.column === stage)
        .sort((a, b) => b.currentStageAgeDays - a.currentStageAgeDays)
      return {
        stage,
        count: inStage.length,
        items: inStage.slice(0, STAGE_ITEM_LIMIT).map((item) => ({
          key: item.item,
          ageDays: roundDays(item.ageInSelectedColumns),
          daysInStage: roundDays(item.currentStageAgeDays),
        })),
      }
    })
    .filter((stage) => stage.count > 0)
    .slice(0, STAGE_LIMIT)
}

function roundDays(days: number): number {
  return Math.round(days * 10) / 10
}
