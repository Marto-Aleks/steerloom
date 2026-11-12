import { isServiceExpectation } from '../../src/lib/statistics/service-expectation'
import {
  AI_SIGNAL_LIMIT,
  type AiDataChecks,
  type AiReportContext,
} from '../../src/lib/ai/report-context'
import { TEAM_NOTES_LIMIT } from '../../src/lib/workspace/model'
import {
  CODE_LOOKUP_LIMIT,
  PULL_REQUEST_ITEM_LIMIT,
  PULL_REQUESTS_PER_ITEM,
  type AiItemPullRequests,
  type AiPullRequest,
  type AiPullRequestEvidence,
} from '../../src/lib/ai/pull-request-evidence'
import {
  isAiJiraSelector,
  isAiSkillId,
  type AiAgentApproval,
} from '../../src/lib/ai/agent'
import type { AiJiraScope } from '../../src/lib/ai/jira-evidence'
import type { AiChatMessage } from './client'
import {
  AI_ASSISTANT_MESSAGE_CHAR_LIMIT,
  AI_CONVERSATION_HISTORY_LIMIT,
  AI_CONVERSATION_SUMMARY_CHAR_LIMIT,
  AI_USER_MESSAGE_CHAR_LIMIT,
} from '../../src/lib/ai/conversation'

export interface ParsedAiChatRequest {
  context: AiReportContext
  messages: AiChatMessage[]
  jiraScope?: AiJiraScope
  agentApproval?: AiAgentApproval
  allowJiraForConversation: boolean
  /** The person said no to board reading for this question. */
  declineBoard?: boolean
  conversationSummary?: string
}

export function parseAiChatRequest(value: unknown): ParsedAiChatRequest | null {
  if (!isRecord(value)) return null
  const context = parseContext(value.context)
  const messages = parseArray(
    value.messages,
    AI_CONVERSATION_HISTORY_LIMIT,
    parseMessage,
  )
  const jiraScope = parseJiraScope(value.jiraScope)
  const agentApproval = parseAgentApproval(value.agentApproval)
  const allowJiraForConversation = optionalBoolean(
    value.allowJiraForConversation,
  )
  const declineBoard = optionalBoolean(value.declineBoard)
  const conversationSummary = optionalText(
    value.conversationSummary,
    AI_CONVERSATION_SUMMARY_CHAR_LIMIT,
  )
  if (!context || !messages?.length) return null
  if (
    jiraScope === null ||
    agentApproval === null ||
    allowJiraForConversation === null ||
    declineBoard === null ||
    conversationSummary === null
  ) {
    return null
  }
  if (messages.at(-1)?.role !== 'user') return null
  return {
    context,
    messages,
    ...(jiraScope ? { jiraScope } : {}),
    ...(agentApproval ? { agentApproval } : {}),
    allowJiraForConversation: allowJiraForConversation ?? false,
    ...(declineBoard ? { declineBoard: true } : {}),
    ...(conversationSummary ? { conversationSummary } : {}),
  }
}

function optionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined
  return text(value, maxLength)
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'boolean' ? value : null
}

function parseAgentApproval(
  value: unknown,
): AiAgentApproval | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !isRecord(value.plan)) return null
  const { plan } = value
  if (
    typeof value.allowJira !== 'boolean' ||
    !isAiSkillId(plan.skillId) ||
    !isAiJiraSelector(plan.jiraSelector) ||
    (plan.jiraMode !== 'overview' && plan.jiraMode !== 'detail')
  ) {
    return null
  }
  return {
    allowJira: value.allowJira,
    plan: {
      skillId: plan.skillId,
      jiraSelector: plan.jiraSelector,
      jiraMode: plan.jiraMode,
      ...(typeof plan.stage === 'string' && plan.stage.trim()
        ? { stage: plan.stage.trim().slice(0, 160) }
        : {}),
    },
  }
}

function parseJiraScope(value: unknown): AiJiraScope | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  const connectionId = text(value.connectionId, 80)
  const projectKey = text(value.projectKey, 30)?.toUpperCase() ?? null
  if (
    !connectionId ||
    !/^[A-Za-z0-9_-]+$/.test(connectionId) ||
    !projectKey ||
    !/^[A-Z][A-Z0-9_]{1,29}$/.test(projectKey)
  ) {
    return null
  }
  if (value.provider === 'azure-devops') {
    // A team board: its id is the team's GUID; items are the project's.
    if (
      projectKey !== 'ADO' ||
      typeof value.boardId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.boardId)
    )
      return null
    return {
      connectionId,
      projectKey,
      provider: 'azure-devops',
      boardId: value.boardId,
    }
  }
  if (value.provider !== undefined) {
    if (
      value.provider !== 'trello' ||
      projectKey !== 'CARD' ||
      typeof value.boardId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(value.boardId)
    )
      return null
    return {
      connectionId,
      projectKey,
      provider: 'trello',
      boardId: value.boardId,
    }
  }
  if (value.boardId !== undefined) return null
  return { connectionId, projectKey }
}

function parseContext(value: unknown): AiReportContext | null {
  if (!isRecord(value)) return null
  const scope = isRecord(value.scope) ? value.scope : null
  const headline = isRecord(value.headline) ? value.headline : null
  const ticketGroupTotals = isRecord(value.ticketGroupTotals)
    ? value.ticketGroupTotals
    : null
  if (!scope || !headline || !ticketGroupTotals) return null

  const generatedAt = text(value.generatedAt, 80)
  const sourceLabel = text(value.sourceLabel, 200)
  const boardName = text(value.boardName, 200)
  const selectedColumns = stringArray(scope.selectedColumns, 30, 120)
  const ticketTypes = stringArray(scope.ticketTypes, 30, 120)
  const windowDays = nullableNumber(scope.windowDays)
  if (
    scope.serviceExpectation !== undefined &&
    !isServiceExpectation(scope.serviceExpectation)
  )
    return null
  const serviceExpectation = isServiceExpectation(scope.serviceExpectation)
    ? {
        days: scope.serviceExpectation.days,
        targetPercent: scope.serviceExpectation.targetPercent,
      }
    : undefined
  const completedObservations = number(headline.completedObservations)
  const medianCycleTimeDays = nullableNumber(headline.medianCycleTimeDays)
  const percentile85CycleTimeDays = nullableNumber(
    headline.percentile85CycleTimeDays,
  )
  const exitThroughputPerWeek = nullableNumber(headline.exitThroughputPerWeek)
  const completedOutlierTotal = number(ticketGroupTotals.completedOutliers)
  const delayedWorkInProgressTotal = number(
    ticketGroupTotals.delayedWorkInProgress,
  )
  const reenteredWorkInProgressTotal = number(
    ticketGroupTotals.reenteredWorkInProgress,
  )
  const focusSignals = parseArray(
    value.focusSignals,
    AI_SIGNAL_LIMIT,
    parseFocusSignal,
  )
  // Blank notes are no notes; anything else must be short text.
  const teamNotes =
    value.teamNotes === undefined ||
    (typeof value.teamNotes === 'string' && !value.teamNotes.trim())
      ? undefined
      : text(value.teamNotes, TEAM_NOTES_LIMIT)
  const weeklyThroughput = parseArray(
    value.weeklyThroughput,
    26,
    parseThroughput,
  )
  const cycleTimeDistribution = parseArray(
    value.cycleTimeDistribution,
    12,
    parseDistribution,
  )
  const weeklyCycleTimeTrend = parseArray(
    value.weeklyCycleTimeTrend,
    26,
    parseTrend,
  )
  const delayedWorkInProgress = parseArray(
    value.delayedWorkInProgress,
    25,
    parseDelayed,
  )
  const completedOutliers = parseArray(
    value.completedOutliers,
    25,
    parseOutlier,
  )
  const reenteredWorkInProgress = parseArray(
    value.reenteredWorkInProgress,
    25,
    parseReentered,
  )
  const periodComparison = parsePeriodComparison(value.periodComparison)
  const forecast = parseForecast(value.forecast)
  const workInProgressByStage =
    value.workInProgressByStage === undefined
      ? undefined
      : parseArray(value.workInProgressByStage, 20, parseStageWork)
  const dataChecks =
    value.dataChecks === undefined
      ? undefined
      : parseDataChecks(value.dataChecks)
  const pullRequests =
    value.pullRequests === undefined
      ? undefined
      : parsePullRequestEvidence(value.pullRequests)
  const codeLookup =
    value.codeLookup === undefined
      ? undefined
      : parseArray(value.codeLookup, CODE_LOOKUP_LIMIT, parseItemPullRequests)

  if (
    generatedAt === null ||
    sourceLabel === null ||
    boardName === null ||
    selectedColumns === null ||
    ticketTypes === null ||
    windowDays === undefined ||
    completedObservations === null ||
    medianCycleTimeDays === undefined ||
    percentile85CycleTimeDays === undefined ||
    exitThroughputPerWeek === undefined ||
    completedOutlierTotal === null ||
    delayedWorkInProgressTotal === null ||
    reenteredWorkInProgressTotal === null ||
    focusSignals === null ||
    weeklyThroughput === null ||
    cycleTimeDistribution === null ||
    weeklyCycleTimeTrend === null ||
    delayedWorkInProgress === null ||
    completedOutliers === null ||
    reenteredWorkInProgress === null ||
    periodComparison === null ||
    forecast === null ||
    workInProgressByStage === null ||
    dataChecks === null ||
    pullRequests === null ||
    codeLookup === null ||
    teamNotes === null
  ) {
    return null
  }

  return {
    generatedAt,
    sourceLabel,
    boardName,
    scope: {
      selectedColumns,
      ticketTypes,
      windowDays,
      ...(serviceExpectation ? { serviceExpectation } : {}),
    },
    headline: {
      completedObservations,
      medianCycleTimeDays,
      percentile85CycleTimeDays,
      exitThroughputPerWeek,
    },
    ticketGroupTotals: {
      completedOutliers: completedOutlierTotal,
      delayedWorkInProgress: delayedWorkInProgressTotal,
      reenteredWorkInProgress: reenteredWorkInProgressTotal,
    },
    focusSignals,
    weeklyThroughput,
    cycleTimeDistribution,
    weeklyCycleTimeTrend,
    delayedWorkInProgress,
    completedOutliers,
    reenteredWorkInProgress,
    ...(periodComparison ? { periodComparison } : {}),
    ...(forecast ? { forecast } : {}),
    ...(workInProgressByStage ? { workInProgressByStage } : {}),
    ...(dataChecks ? { dataChecks } : {}),
    ...(teamNotes ? { teamNotes } : {}),
    ...(pullRequests ? { pullRequests } : {}),
    ...(codeLookup?.length ? { codeLookup } : {}),
  }
}

const PULL_REQUEST_STATES = new Set<AiPullRequest['state']>([
  'draft',
  'open',
  'approved',
  'merged',
  'closed',
])

function parsePullRequestEvidence(
  value: unknown,
): AiPullRequestEvidence | null {
  if (!isRecord(value) || !isRecord(value.coverage)) return null
  const repositories = number(value.repositories)
  const linked = number(value.coverage.linked)
  const finished = number(value.coverage.finished)
  const omittedItems = number(value.omittedItems)
  const items = parseArray(
    value.items,
    PULL_REQUEST_ITEM_LIMIT,
    parseItemPullRequests,
  )
  const typical = value.typicalInsideReview
  let typicalInsideReview: AiPullRequestEvidence['typicalInsideReview']
  if (typical !== undefined) {
    if (!isRecord(typical)) return null
    const waitingForFirstReviewDays = number(typical.waitingForFirstReviewDays)
    const reviewRoundsDays = number(typical.reviewRoundsDays)
    const waitingToMergeDays = number(typical.waitingToMergeDays)
    if (
      waitingForFirstReviewDays === null ||
      reviewRoundsDays === null ||
      waitingToMergeDays === null
    )
      return null
    typicalInsideReview = {
      waitingForFirstReviewDays,
      reviewRoundsDays,
      waitingToMergeDays,
    }
  }
  let sizeAndSpeed: AiPullRequestEvidence['sizeAndSpeed']
  if (value.sizeAndSpeed !== undefined) {
    const size = value.sizeAndSpeed
    if (!isRecord(size) || !isRecord(size.large) || !isRecord(size.small))
      return null
    const largeOverLines = number(size.largeOverLines)
    const largeItems = number(size.large.items)
    const largeDays = number(size.large.readyToMergedDays)
    const smallItems = number(size.small.items)
    const smallDays = number(size.small.readyToMergedDays)
    if (
      largeOverLines === null ||
      largeItems === null ||
      largeDays === null ||
      smallItems === null ||
      smallDays === null
    )
      return null
    sizeAndSpeed = {
      largeOverLines,
      large: { items: largeItems, readyToMergedDays: largeDays },
      small: { items: smallItems, readyToMergedDays: smallDays },
    }
  }
  if (
    repositories === null ||
    linked === null ||
    finished === null ||
    omittedItems === null ||
    items === null
  )
    return null
  return {
    repositories,
    coverage: { linked, finished },
    ...(typicalInsideReview ? { typicalInsideReview } : {}),
    ...(sizeAndSpeed ? { sizeAndSpeed } : {}),
    items,
    omittedItems,
  }
}

function parseItemPullRequests(value: unknown): AiItemPullRequests | null {
  if (!isRecord(value)) return null
  const key = text(value.key, 80)
  const stage = text(value.stage, 120)
  const pullRequests = parseArray(
    value.pullRequests,
    PULL_REQUESTS_PER_ITEM,
    parsePullRequest,
  )
  const optional = optionalNumbers(value, [
    'daysInStage',
    'ageDays',
    'cycleTimeDays',
    'finishedDaysAgo',
    'morePullRequests',
    'branchLastCommitDaysAgo',
    'codeQuietDays',
  ])
  if (key === null || stage === null || pullRequests === null || !optional)
    return null
  if (
    value.code !== undefined &&
    !CODE_STATES.has(value.code as NonNullable<AiItemPullRequests['code']>)
  )
    return null
  if (value.boardDisagrees !== undefined && value.boardDisagrees !== true)
    return null
  return {
    key,
    stage,
    ...optional,
    ...(value.code !== undefined
      ? { code: value.code as NonNullable<AiItemPullRequests['code']> }
      : {}),
    ...(value.boardDisagrees ? { boardDisagrees: true } : {}),
    pullRequests,
  }
}

const CODE_STATES = new Set<NonNullable<AiItemPullRequests['code']>>([
  'nocode',
  'coding',
  'review',
  'approved',
  'merged',
])

function parsePullRequest(value: unknown): AiPullRequest | null {
  if (!isRecord(value)) return null
  const ref = text(value.ref, 220)
  const changesRequested = number(value.changesRequested)
  const optional = optionalNumbers(value, [
    'readyDaysAgo',
    'firstReviewAfterDays',
    'approvedDaysAgo',
    'mergedDaysAgo',
    'lastActivityDaysAgo',
    'comments',
    'linesChanged',
    'filesChanged',
  ])
  if (
    ref === null ||
    changesRequested === null ||
    !PULL_REQUEST_STATES.has(value.state as AiPullRequest['state']) ||
    !optional ||
    (value.checks !== undefined &&
      !CHECK_RESULTS.has(value.checks as NonNullable<AiPullRequest['checks']>))
  )
    return null
  return {
    ref,
    state: value.state as AiPullRequest['state'],
    changesRequested,
    ...optional,
    ...(value.checks !== undefined
      ? { checks: value.checks as NonNullable<AiPullRequest['checks']> }
      : {}),
  }
}

const CHECK_RESULTS = new Set<NonNullable<AiPullRequest['checks']>>([
  'passing',
  'failing',
  'running',
])

/** Each named field absent, or a non-negative number. */
function optionalNumbers(
  value: Record<string, unknown>,
  fields: string[],
): Record<string, number> | null {
  const result: Record<string, number> = {}
  for (const field of fields) {
    if (value[field] === undefined) continue
    const parsed = number(value[field])
    if (parsed === null) return null
    result[field] = parsed
  }
  return result
}

function parseDataChecks(value: unknown): AiDataChecks | null {
  if (!isRecord(value)) return null
  const verdict: AiDataChecks['verdict'] | null =
    value.verdict === 'strong' ||
    value.verdict === 'directional' ||
    value.verdict === 'weak'
      ? value.verdict
      : null
  const summary = text(value.summary, 400)
  const findings = parseArray(value.findings, 8, (item: unknown) =>
    text(item, 600),
  )
  return verdict && summary !== null && findings !== null
    ? { verdict, summary, findings }
    : null
}

type ParsedForecast = NonNullable<AiReportContext['forecast']>
type AvailableForecast = Exclude<ParsedForecast, { unavailable: string }>

const FORECAST_MAX_ITEMS = 100_000
const FORECAST_MAX_SAMPLE_DAYS = 3_660

function parseForecast(value: unknown): ParsedForecast | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  if (value.unavailable !== undefined) {
    const unavailable = text(value.unavailable, 240)
    return unavailable ? { unavailable } : null
  }
  if (
    !isRecord(value.basis) ||
    !isRecord(value.nextTwoWeeks) ||
    (value.finishCurrentWork !== null && !isRecord(value.finishCurrentWork))
  )
    return null
  const { basis, nextTwoWeeks } = value
  const sampleStart = isoDay(basis.sampleStart)
  const sampleEndExclusive = isoDay(basis.sampleEndExclusive)
  const sampledDays = boundedInteger(
    basis.sampledDays,
    FORECAST_MAX_SAMPLE_DAYS,
  )
  const completedItems = boundedInteger(
    basis.completedItems,
    FORECAST_MAX_ITEMS,
  )
  const atLeastItemsP85 = boundedInteger(
    nextTwoWeeks.atLeastItemsP85,
    FORECAST_MAX_ITEMS,
  )
  const itemsP50 = boundedInteger(nextTwoWeeks.itemsP50, FORECAST_MAX_ITEMS)
  const finishCurrentWork = parseFinishForecast(value.finishCurrentWork)
  if (
    !sampleStart ||
    !sampleEndExclusive ||
    sampleStart >= sampleEndExclusive ||
    sampledDays === null ||
    completedItems === null ||
    atLeastItemsP85 === null ||
    itemsP50 === null ||
    atLeastItemsP85 > itemsP50 ||
    finishCurrentWork === undefined
  ) {
    return null
  }
  return {
    basis: { sampleStart, sampleEndExclusive, sampledDays, completedItems },
    finishCurrentWork,
    nextTwoWeeks: { atLeastItemsP85, itemsP50 },
  }
}

function parseFinishForecast(
  value: unknown,
): AvailableForecast['finishCurrentWork'] | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const items = boundedInteger(value.items, FORECAST_MAX_ITEMS)
  const withinTwoWeeksPercent = boundedInteger(value.withinTwoWeeksPercent, 100)
  const dates = [value.p50, value.p70, value.p85, value.p95].map((date) =>
    date === null ? null : isoDay(date),
  )
  if (
    items === null ||
    items < 1 ||
    withinTwoWeeksPercent === null ||
    typeof value.beyondYear !== 'boolean' ||
    dates.some((date) => date === undefined)
  )
    return undefined
  const [p50, p70, p85, p95] = dates as Array<string | null>
  // Higher confidence never finishes earlier; "beyond a year" (null) only
  // appears at the high-confidence end and must match the flag.
  const ordered = (dates as Array<string | null>).every(
    (date, index, all) =>
      index === 0 ||
      date === null ||
      (all[index - 1] !== null && all[index - 1]! <= date),
  )
  if (!ordered || value.beyondYear !== (p95 === null)) return undefined
  return {
    items,
    p50: p50 ?? null,
    p70: p70 ?? null,
    p85: p85 ?? null,
    p95: p95 ?? null,
    beyondYear: value.beyondYear,
    withinTwoWeeksPercent,
  }
}

function isoDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return undefined
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? value
    : undefined
}

function boundedInteger(value: unknown, max: number): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null
}

type ParsedPeriodComparison = NonNullable<AiReportContext['periodComparison']>
type ParsedPeriodSummary = ParsedPeriodComparison['current']

function parsePeriodComparison(
  value: unknown,
): ParsedPeriodComparison | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  const current = parsePeriodSummary(value.current)
  const previous = parsePeriodSummary(value.previous)
  return current && previous ? { current, previous } : null
}

function parsePeriodSummary(value: unknown): ParsedPeriodSummary | null {
  if (!isRecord(value)) return null
  const start = text(value.start, 80)
  const endExclusive = text(value.endExclusive, 80)
  const completedObservations = number(value.completedObservations)
  const medianCycleTimeDays = nullableNumber(value.medianCycleTimeDays)
  const percentile85CycleTimeDays = nullableNumber(
    value.percentile85CycleTimeDays,
  )
  const exitThroughputPerWeek = number(value.exitThroughputPerWeek)
  const delayedWorkInProgress = nullableNumber(value.delayedWorkInProgress)
  const reenteredWorkInProgress = number(value.reenteredWorkInProgress)
  const historyCoverage = value.historyCoverage
  const startTime = Date.parse(start ?? '')
  const endTime = Date.parse(endExclusive ?? '')
  if (
    !start ||
    !endExclusive ||
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime >= endTime ||
    completedObservations === null ||
    medianCycleTimeDays === undefined ||
    percentile85CycleTimeDays === undefined ||
    exitThroughputPerWeek === null ||
    delayedWorkInProgress === undefined ||
    reenteredWorkInProgress === null ||
    (historyCoverage !== 'complete' && historyCoverage !== 'partial')
  ) {
    return null
  }
  return {
    start,
    endExclusive,
    completedObservations,
    medianCycleTimeDays,
    percentile85CycleTimeDays,
    exitThroughputPerWeek,
    delayedWorkInProgress,
    reenteredWorkInProgress,
    historyCoverage,
  }
}

function parseMessage(value: unknown): AiChatMessage | null {
  if (!isRecord(value)) return null
  const role = value.role
  if (role !== 'user' && role !== 'assistant') return null
  const content = text(
    value.content,
    role === 'user'
      ? AI_USER_MESSAGE_CHAR_LIMIT
      : AI_ASSISTANT_MESSAGE_CHAR_LIMIT,
  )
  if (!content) return null
  return { role, content }
}

function parseFocusSignal(value: unknown) {
  if (!isRecord(value)) return null
  const severity = value.severity
  const title = text(value.title, 240)
  const evidence = text(value.evidence, 600)
  const suggestedTeamPrompt = text(value.suggestedTeamPrompt, 600)
  if (
    !['critical', 'warning', 'info', 'healthy'].includes(String(severity)) ||
    !title ||
    !evidence ||
    !suggestedTeamPrompt
  ) {
    return null
  }
  return {
    severity: severity as 'critical' | 'warning' | 'info' | 'healthy',
    title,
    evidence,
    suggestedTeamPrompt,
  }
}

function parseThroughput(value: unknown) {
  if (!isRecord(value)) return null
  const week = text(value.week, 40)
  const items = number(value.items)
  return week !== null && items !== null ? { week, items } : null
}

function parseDistribution(value: unknown) {
  if (!isRecord(value)) return null
  const range = text(value.range, 40)
  const items = number(value.items)
  const sharePercent = number(value.sharePercent)
  return range !== null && items !== null && sharePercent !== null
    ? { range, items, sharePercent }
    : null
}

function parseTrend(value: unknown) {
  if (!isRecord(value)) return null
  const week = text(value.week, 40)
  const completedItems = number(value.completedItems)
  const sampleItems = number(value.sampleItems)
  const medianDays = nullableNumber(value.medianDays)
  const percentile85Days = nullableNumber(value.percentile85Days)
  return week !== null &&
    completedItems !== null &&
    sampleItems !== null &&
    medianDays !== undefined &&
    percentile85Days !== undefined
    ? { week, completedItems, sampleItems, medianDays, percentile85Days }
    : null
}

function parseDelayed(value: unknown) {
  if (!isRecord(value)) return null
  const key = text(value.key, 80)
  const status = text(value.status, 160)
  const ageDays = number(value.ageDays)
  return key !== null && status !== null && ageDays !== null
    ? { key, status, ageDays }
    : null
}

function parseStageWork(value: unknown) {
  if (!isRecord(value)) return null
  const stage = text(value.stage, 160)
  const count = number(value.count)
  const items = parseArray(value.items, 15, (item: unknown) => {
    if (!isRecord(item)) return null
    const key = text(item.key, 80)
    const ageDays = number(item.ageDays)
    const daysInStage = number(item.daysInStage)
    return key !== null && ageDays !== null && daysInStage !== null
      ? { key, ageDays, daysInStage }
      : null
  })
  return stage !== null && count !== null && items !== null
    ? { stage, count, items }
    : null
}

function parseOutlier(value: unknown) {
  if (!isRecord(value)) return null
  const key = text(value.key, 80)
  const cycleTimeDays = number(value.cycleTimeDays)
  return key !== null && cycleTimeDays !== null ? { key, cycleTimeDays } : null
}

function parseReentered(value: unknown) {
  if (!isRecord(value)) return null
  const key = text(value.key, 80)
  const status = text(value.status, 160)
  return key !== null && status !== null ? { key, status } : null
}

function parseArray<T>(
  value: unknown,
  limit: number,
  parser: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null
  const parsed = value.map(parser)
  return parsed.some((item) => item === null) ? null : (parsed as T[])
}

function stringArray(
  value: unknown,
  limit: number,
  maxLength: number,
): string[] | null {
  return parseArray(value, limit, (item) => text(item, maxLength))
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : (number(value) ?? undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
