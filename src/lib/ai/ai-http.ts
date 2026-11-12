import type { AnswerCard } from './answer-card'
import { workspaceRequestPath } from '../workspace/request-path'
import {
  PROGRESS_CONTENT_TYPE,
  readProgressResponse,
  type ProgressListener,
  type TextListener,
} from '../progress'
import type { AiReportContext } from './report-context'
import type {
  AiAgentApproval,
  AiAgentConfirmation,
  AiAgentSkillTrace,
} from './agent'
import type {
  AiJiraLookupMode,
  AiJiraLookupSource,
  AiJiraScope,
} from './jira-evidence'
import {
  AI_CONVERSATION_MESSAGE_LIMIT,
  buildAiConversationSummary,
} from './conversation'

export interface AiConfigurationInfo {
  configured: boolean
  /** A workspace key's provider, or the local environment settings. */
  source: 'anthropic' | 'openai' | 'custom' | 'environment' | null
  missing: string[]
  invalid: string[]
}

export interface AiConversationMessage {
  role: 'user' | 'assistant'
  content: string
  checkedJiraKeys?: string[]
  unavailableJiraKeys?: string[]
  jiraLookupMode?: AiJiraLookupMode
  jiraLookupSource?: AiJiraLookupSource
  omittedJiraKeys?: number
  skill?: AiAgentSkillTrace
  /** Titles of the items the assistant read, by key, for hover text. */
  itemTitles?: Record<string, string>
  /** A why or what-to-do answer, checked by Steerloom; content is its text. */
  card?: AnswerCard
}

interface AiChatResponse {
  message?: string
  card?: AnswerCard
  confirmation?: AiAgentConfirmation
  skill?: AiAgentSkillTrace
  jira?: {
    requestedKeys: string[]
    checkedKeys: string[]
    unavailableKeys: string[]
    mode: AiJiraLookupMode
    source: AiJiraLookupSource
    omittedCount: number
    titles?: Record<string, string>
  }
}

export interface AiChatResult {
  message: string
  card?: AnswerCard
  confirmation?: AiAgentConfirmation
  skill?: AiAgentSkillTrace
  checkedJiraKeys: string[]
  unavailableJiraKeys: string[]
  jiraLookupMode?: AiJiraLookupMode
  jiraLookupSource?: AiJiraLookupSource
  omittedJiraKeys: number
  itemTitles?: Record<string, string>
}

export async function getAiConfiguration(
  signal?: AbortSignal,
): Promise<AiConfigurationInfo> {
  return requestJson<AiConfigurationInfo>('/api/ai/config', { signal })
}

export async function sendAiChat(
  context: AiReportContext,
  messages: AiConversationMessage[],
  jiraScope?: AiJiraScope,
  agentApproval?: AiAgentApproval,
  allowJiraForConversation = false,
  signal?: AbortSignal,
  onProgress?: ProgressListener,
  /** The person said no to reading the board for this question. */
  declineBoard = false,
  /** The answer as the AI writes it, piece by piece. */
  onText?: TextListener,
): Promise<AiChatResult> {
  const response = await requestJson<AiChatResponse>(
    '/api/ai/chat',
    {
      method: 'POST',
      body: JSON.stringify({
        context,
        messages: messages
          .slice(-AI_CONVERSATION_MESSAGE_LIMIT)
          .map(({ role, content }) => ({
            role,
            content,
          })),
        conversationSummary: buildAiConversationSummary(messages),
        ...(jiraScope ? { jiraScope } : {}),
        ...(agentApproval ? { agentApproval } : {}),
        allowJiraForConversation,
        ...(declineBoard ? { declineBoard: true } : {}),
      }),
      signal,
    },
    onProgress,
    onText,
  )
  return {
    message: response.message ?? '',
    ...(response.card ? { card: response.card } : {}),
    confirmation: response.confirmation,
    skill: response.skill,
    checkedJiraKeys: response.jira?.checkedKeys ?? [],
    unavailableJiraKeys: response.jira?.unavailableKeys ?? [],
    jiraLookupMode: response.jira?.mode,
    jiraLookupSource: response.jira?.source,
    omittedJiraKeys: response.jira?.omittedCount ?? 0,
    itemTitles: response.jira?.titles ?? {},
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  onProgress?: ProgressListener,
  onText?: TextListener,
): Promise<T> {
  const response = await fetch(workspaceRequestPath(path), {
    ...init,
    headers: {
      // Ask for live progress when someone is listening; plain JSON otherwise.
      Accept: onProgress
        ? `${PROGRESS_CONTENT_TYPE}, application/json`
        : 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const read = await readProgressResponse<unknown>(
    response,
    onProgress,
    onText,
  ).catch((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError')
      throw caught
    return {
      ok: false,
      status: response.status,
      value: { error: caught instanceof Error ? caught.message : undefined },
    }
  })
  const body = read.value
  if (!read.ok) {
    if (read.status === 401)
      window.dispatchEvent(new Event('flowlens-session-expired'))
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : 'The AI request could not be completed.'
    throw new Error(message)
  }
  return body as T
}
