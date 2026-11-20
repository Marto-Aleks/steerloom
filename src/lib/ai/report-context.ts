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
import type { FlaggedReplay } from '../statistics/flagged-replay'
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
  /**
   * Where finished work's time went: each measured stage's share of it, in
   * board order. What the briefing shows as "40% of time".
   */
  stageTime?: Array<{ stage: string; sharePercent: number }>
  /** What the briefing flagged a week ago, and what happened to it since. */
  flaggedLastWeek?: AiFlaggedLastWeek
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
  /** Scrum boards: the Sprint tab's facts. Keys and numbers only, no titles. */
  sprint?: AiSprintContext
}

export type AiSprintItemState =
  | 'done'
  | 'on track'
  | 'in progress'
  | 'at risk'
  | 'not started'

export interface AiSprintContext {
  /** "points" when the board estimates in story points, else "items". */
  unit: 'points' | 'items'
  running?: {
    name: string
    goal?: string
    /** Day of the sprint and how many it has, in calendar days. */
    day: number
    days: number
    /** Whole days until the planned end, as the Sprint tab says. */
    daysLeft: number
    /** Absent when too few items finished in the last 90 days to forecast. */
    forecast?: { likelyDone: number; atLeast85: number; sampleItems: number }
    finishedLast90Days: number
    points?: {
      likely: number
      total: number
      atRisk: number
      unestimated: number
    }
    items: Array<{
      key: string
      state: AiSprintItemState
      /** Column, then what matters: age, "3rd sprint" or when it was added. */
      status: string
      chancePercent?: number
      points?: number
      sprintsSoFar: number
      addedMidSprint: boolean
    }>
    scopeChange: { plannedItems: number; added: string[]; removed: string[] }
  }
  /** The next sprint's plan against what the last sprints finished. */
  planning?: {
    sprint: string
    /** The next sprint's items: keys and estimates, no titles. */
    items: Array<{ key: string; points?: number }>
    planned: number
    unestimatedItems: number
    lastSprints: number
    low: number
    high: number
    usual: number
  }
  /** Whether bigger estimates took longer on this board, last 90 days. */
  pointsPredictTime?: {
    verdict: 'yes' | 'partly' | 'no'
    estimatedItems: number
    smallUpToPoints: number
    smallMedianDays: number
    largeMedianDays: number
  }
  lastSprints: Array<{
    name: string
    goal?: string
    planned: number
    finishedPlanned: number
    added: number
    /** Older clients only: planned items no longer in the sprint at its end. */
    removed?: number
    /** Planned items taken out and not put into any later sprint. */
    backToBacklog?: number
    /** Unfinished here and continued in a later sprint, planned or added. */
    carriedOver?: number
    /** Story points in the plan on its first day, and finished by the end. */
    plannedPoints?: number
    finishedPoints?: number
  }>
}

/** "Flagged last week" on the briefing, as keys and numbers. */
export interface AiFlaggedLastWeek {
  daysAgo: number
  /** Items that changed column within quickDays of being flagged. */
  movedQuickly: number
  quickDays: number
  /** The usual limit (P85) then and now, in days, when each was known. */
  limitThenDays?: number
  limitNowDays?: number
  items: Array<{
    key: string
    reason: 'late' | 'came back'
    /** finished, moved on and still in progress, waiting in the same column, or returned to before the measured stages. */
    outcome: FlaggedReplay['items'][number]['outcome']
    movedAfterDays?: number
  }>
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
  /** Each measured stage with its share (0–1) of finished work's time. */
  stageLoads?: Array<{ name: string; timeShare?: number }>
  flagged?: FlaggedReplay | null
  /** Days after a flag that still count as moving quickly. */
  quickMoveDays?: number
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
  stageLoads,
  flagged,
  quickMoveDays = 2,
  teamNotes,
  pullRequests,
  codeLookup,
}: BuildAiReportContextInput): AiReportContext {
  const stageTime = (stageLoads ?? []).flatMap((load) =>
    load.timeShare === undefined
      ? []
      : [
          {
            stage: load.name.slice(0, 160),
            sharePercent: Math.round(load.timeShare * 100),
          },
        ],
  )
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
    ...(stageTime.length ? { stageTime: stageTime.slice(0, STAGE_LIMIT) } : {}),
    ...(flagged?.items.length
      ? {
          flaggedLastWeek: {
            daysAgo: flagged.daysAgo,
            movedQuickly: flagged.movedQuickly,
            quickDays: quickMoveDays,
            ...(flagged.limitThen !== null
              ? { limitThenDays: roundDays(flagged.limitThen) }
              : {}),
            ...(flagged.limitNow !== null
              ? { limitNowDays: roundDays(flagged.limitNow) }
              : {}),
            items: flagged.items.slice(0, TICKET_LIMIT).map((item) => ({
              key: item.item,
              reason:
                item.reason === 'late'
                  ? ('late' as const)
                  : ('came back' as const),
              outcome: item.outcome,
              ...(item.movedAfterDays !== null
                ? { movedAfterDays: roundDays(item.movedAfterDays) }
                : {}),
            })),
          },
        }
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
