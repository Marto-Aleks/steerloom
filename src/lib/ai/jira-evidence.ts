/**
 * The board the assistant may read: a Jira project (the default), a Trello
 * board (projectKey "CARD") or an Azure DevOps team board (projectKey "ADO").
 */
export interface AiJiraScope {
  connectionId: string
  projectKey: string
  provider?: 'trello' | 'azure-devops'
  boardId?: string
}

export type AiJiraLookupMode = 'overview' | 'detail'

export type AiJiraLookupSource =
  | 'named tickets'
  | 'completed outliers above P85'
  | 'delayed work in progress'
  | 're-entered tickets'
  | 'current work in a stage'
  | 'agent-selected report tickets'

export interface AiJiraLookup {
  mode: AiJiraLookupMode
  source: AiJiraLookupSource
  keys: string[]
  availableCount: number
  omittedCount: number
}

export interface AiJiraLookupMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiJiraLookupContext {
  ticketGroupTotals: {
    completedOutliers: number
    delayedWorkInProgress: number
    reenteredWorkInProgress: number
  }
  completedOutliers: Array<{ key: string }>
  delayedWorkInProgress: Array<{ key: string }>
  reenteredWorkInProgress: Array<{ key: string }>
  workInProgressByStage?: Array<{
    stage: string
    count: number
    items: Array<{ key: string }>
  }>
}

export interface AiJiraHistoryEvent {
  changedAt: string
  changedBy: string
  field: string
  fromValue: string | null
  toValue: string | null
}

export interface AiJiraIssueLink {
  direction: 'inward' | 'outward'
  relationship: string
  key: string
  summary: string
  issueType: string
  status: string
}

export interface AiJiraRelatedIssue {
  key: string
  summary: string
  status: string
  issueType: string
}

export interface AiJiraComment {
  author: string
  createdAt: string
  updatedAt?: string
  body: string
}

export interface AiJiraIssueEvidence {
  key: string
  summary: string
  description?: string
  issueType: string
  status: string
  statusCategory: string
  priority: string
  assignee: string | null
  components: string[]
  labels?: string[]
  fixVersions?: string[]
  createdAt?: string
  updatedAt?: string
  dueDate?: string
  parent?: AiJiraRelatedIssue
  subtasks?: AiJiraRelatedIssue[]
  links?: AiJiraIssueLink[]
  comments?: AiJiraComment[]
  history?: AiJiraHistoryEvent[]
}

export interface AiJiraEvidenceBundle {
  mode: AiJiraLookupMode
  source: AiJiraLookupSource
  requestedKeys: string[]
  issues: AiJiraIssueEvidence[]
  unavailableKeys: string[]
  omittedCount: number
}

export const AI_JIRA_TICKET_LIMIT = 5
export const AI_JIRA_GROUP_LIMIT = 25

const completedOutlierPattern =
  /\b(?:completed\s+)?(?:ticket\s+)?outliers?\b|\boutliers?\s+(?:above|beyond|over)\s+(?:the\s+)?p\s*85\b/i
const delayedWorkPattern =
  /\bdelayed\s+(?:work\s+in\s+progress|wip|tickets?|work)\b|\b(?:tickets?|work)\s+beyond\s+(?:the\s+)?p\s*85\b/i
const reenteredPattern = /\bre[\s-]?(?:entered|entry)\b/i
const conversationalReferencePattern =
  /\b(?:these|those|them|they|their|same tickets?|the tickets?|that group|this group)\b/i
const detailedEvidencePattern =
  /\b(?:why|stuck|comments?|history|changelog|dependencies|dependency|dependent|blocked|blockers?|links?|parents?|subtasks?|description|latest update)\b|\bwhat\b.{0,30}\babout\b/i

export function resolveAiJiraLookup(
  context: AiJiraLookupContext,
  messages: AiJiraLookupMessage[],
  projectKey: string,
): AiJiraLookup | null {
  const latest = messages.at(-1)
  if (!latest || latest.role !== 'user') return null

  const selection = selectionFromText(context, latest.content, projectKey)
  const referencedSelection =
    selection ??
    (conversationalReferencePattern.test(latest.content)
      ? findPreviousUserSelection(context, messages.slice(0, -1), projectKey)
      : null)
  if (!referencedSelection?.keys.length) return null

  const mode: AiJiraLookupMode = detailedEvidencePattern.test(latest.content)
    ? 'detail'
    : 'overview'
  const limit = mode === 'detail' ? AI_JIRA_TICKET_LIMIT : AI_JIRA_GROUP_LIMIT
  const keys = referencedSelection.keys.slice(0, limit)
  return {
    mode,
    source: referencedSelection.source,
    keys,
    availableCount: referencedSelection.availableCount,
    omittedCount: Math.max(0, referencedSelection.availableCount - keys.length),
  }
}

function findPreviousUserSelection(
  context: AiJiraLookupContext,
  messages: AiJiraLookupMessage[],
  projectKey: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const selection = selectionFromText(context, message.content, projectKey)
    if (selection) return selection
  }
  return null
}

function selectionFromText(
  context: AiJiraLookupContext,
  text: string,
  projectKey: string,
): {
  source: AiJiraLookupSource
  keys: string[]
  availableCount: number
} | null {
  const explicitKeys = extractProjectTicketKeys(
    text,
    projectKey,
    AI_JIRA_GROUP_LIMIT,
  )
  if (explicitKeys.length) {
    return {
      source: 'named tickets',
      keys: explicitKeys,
      availableCount: explicitKeys.length,
    }
  }
  if (completedOutlierPattern.test(text)) {
    const keys = reportGroupKeys(context.completedOutliers, projectKey)
    return {
      source: 'completed outliers above P85',
      keys,
      availableCount: Math.max(
        keys.length,
        context.ticketGroupTotals.completedOutliers,
      ),
    }
  }
  if (delayedWorkPattern.test(text)) {
    const keys = reportGroupKeys(context.delayedWorkInProgress, projectKey)
    return {
      source: 'delayed work in progress',
      keys,
      availableCount: Math.max(
        keys.length,
        context.ticketGroupTotals.delayedWorkInProgress,
      ),
    }
  }
  const stage = mentionedStage(context, text)
  if (stage) {
    const keys = reportGroupKeys(stage.items, projectKey)
    return {
      source: 'current work in a stage',
      keys,
      availableCount: Math.max(keys.length, stage.count),
    }
  }
  if (reenteredPattern.test(text)) {
    const keys = reportGroupKeys(context.reenteredWorkInProgress, projectKey)
    return {
      source: 're-entered tickets',
      keys,
      availableCount: Math.max(
        keys.length,
        context.ticketGroupTotals.reenteredWorkInProgress,
      ),
    }
  }
  return null
}

function reportGroupKeys(items: Array<{ key: string }>, projectKey: string) {
  return extractProjectTicketKeys(
    items.map(({ key }) => key).join(' '),
    projectKey,
    AI_JIRA_GROUP_LIMIT,
  )
}

export function extractProjectTicketKeys(
  text: string,
  projectKey: string,
  limit = AI_JIRA_TICKET_LIMIT,
): string[] {
  const normalizedProject = projectKey.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(normalizedProject) || limit <= 0) {
    return []
  }
  return extractTicketKeys(text, 50)
    .filter((key) => key.startsWith(`${normalizedProject}-`))
    .slice(0, limit)
}

export function extractTicketKeys(
  text: string,
  limit = AI_JIRA_TICKET_LIMIT,
): string[] {
  if (limit <= 0) return []
  return [
    ...new Set(
      [...text.matchAll(/\b[A-Z][A-Z0-9_]{1,29}-\d+\b/gi)].map(
        (match) => match[0]?.toUpperCase() ?? '',
      ),
    ),
  ]
    .filter(Boolean)
    .slice(0, limit)
}

/**
 * A stage named as a place where work sits: "waiting in Review", "stuck in
 * Testing", "the Review queue", "items in Code Review". Longer stage names
 * win, so "Code Review" is preferred over "Review" when both exist.
 */
function mentionedStage(context: AiJiraLookupContext, text: string) {
  const stages = [...(context.workInProgressByStage ?? [])].sort(
    (a, b) => b.stage.length - a.stage.length,
  )
  for (const stage of stages) {
    const name = stage.stage.trim()
    if (name.length < 2) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `\\b(?:in|into|at|inside|waiting\\s+(?:in|for)|stuck\\s+in|sitting\\s+in|piling\\s+up\\s+in|piles?\\s+up\\s+in)\\s+(?:the\\s+)?${escaped}\\b|\\b${escaped}\\s+(?:queue|column|stage|backlog|pile)\\b`,
      'i',
    )
    if (pattern.test(text)) return stage
  }
  return null
}
