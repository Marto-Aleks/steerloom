import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { connectMiddleware } from '../http/middleware'
import type { AiAgentPlan } from '../../src/lib/ai/agent'
import type { AiReportContext } from '../../src/lib/ai/report-context'
import {
  AI_CHAT_REQUEST_BYTE_LIMIT,
  AI_CONVERSATION_MESSAGE_LIMIT,
} from '../../src/lib/ai/conversation'
import {
  resolveAiJiraLookup,
  type AiJiraEvidenceBundle,
  type AiJiraLookup,
  type AiJiraScope,
} from '../../src/lib/ai/jira-evidence'
import type { JiraServerConnection } from '../jira/config'
import { JiraUpstreamError, JiraClient } from '../jira/jira-client'
import type { BoardReader } from './board-reader'
import { finishAnswer } from './answer-card'
import { jiraReader } from './board-readers'
import { endpointKey, rejectsTools, runAgent, toollessEndpoints } from './agent'
import {
  chooseAiSkill,
  fallbackAiAgentPlan,
  parseAiAgentPlan,
  resolveAgentPlanLookup,
  shouldPlanJiraLookup,
} from './agent-plan'
import {
  AI_AGENT_JIRA_TOOL_LIMIT,
  jiraLookupFingerprint,
  mergeAiJiraEvidence,
} from './agent-loop'
import { AiClient, AiUpstreamError } from './client'
import { loadAiServerConfig, type AiServerConfig } from './config'
import { parseAiChatRequest } from './request'
import { publicMessage } from '../http/public-error'
import { getAiSkill } from './skills/registry'
import {
  progressStream,
  wantsProgress,
  type ProgressReporter,
} from '../http/progress'

const localHostPattern = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i

/** The assistant's read-only view of the board a report came from. */
export type BoardResolver = (
  request: IncomingMessage,
  scope: AiJiraScope,
) => Promise<BoardReader>

export function aiApiPlugin(
  resolveConnections: (request: IncomingMessage) => JiraServerConnection[],
  resolveBoard?: BoardResolver,
  resolveConfig?: AiConfigResolver,
): Plugin {
  const handle = createAiHandler(
    resolveConnections,
    resolveBoard,
    undefined,
    resolveConfig,
  )
  return {
    name: 'flowlens-on-prem-ai-api',
    configureServer(server) {
      server.middlewares.use(connectMiddleware(handle))
    },
    configurePreviewServer(server) {
      server.middlewares.use(connectMiddleware(handle))
    },
  }
}

/** Returns the AI settings for this request's workspace, or null when none. */
export type AiConfigResolver = (
  request: IncomingMessage,
) => AiServerConfig | null | Promise<AiServerConfig | null>

export function createAiHandler(
  resolveConnections: (request: IncomingMessage) => JiraServerConnection[],
  resolveBoard?: BoardResolver,
  authorizeRequest: (request: IncomingMessage) => boolean = isLocalRequest,
  resolveConfig?: AiConfigResolver,
) {
  const environment = resolveConfig ? null : loadAiServerConfig()
  const configFor = async (request: IncomingMessage) =>
    resolveConfig ? await resolveConfig(request) : environment

  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const requestUrl = request.url ?? ''
    if (!requestUrl.startsWith('/api/ai/')) {
      next()
      return
    }
    const jiraConnections = resolveConnections(request)

    setApiHeaders(response)
    if (!authorizeRequest(request)) {
      sendJson(response, 403, { error: 'Local requests only.' })
      return
    }

    const url = new URL(requestUrl, 'http://127.0.0.1')
    let config: AiServerConfig | null
    try {
      config = await configFor(request)
    } catch (caught) {
      sendJson(response, 400, {
        error: publicMessage(
          caught,
          'Could not read the workspace AI settings.',
        ),
      })
      return
    }
    const configured =
      !!config && config.missing.length === 0 && config.invalid.length === 0
    if (url.pathname === '/api/ai/config') {
      if (request.method !== 'GET') {
        methodNotAllowed(response, 'GET')
        return
      }
      sendJson(response, 200, {
        configured,
        source: config?.source ?? null,
        missing: config?.source === 'environment' ? config.missing : [],
        invalid: config?.source === 'environment' ? config.invalid : [],
      })
      return
    }

    if (url.pathname !== '/api/ai/chat') {
      sendJson(response, 404, { error: 'AI endpoint not found.' })
      return
    }
    if (request.method !== 'POST') {
      methodNotAllowed(response, 'POST')
      return
    }
    if (!config || !configured) {
      sendJson(response, 503, {
        error:
          'Steerloom AI is not set up for this workspace. A workspace owner can add an AI key on the workspace page.',
      })
      return
    }

    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch (caught) {
      sendJson(response, 400, {
        error:
          caught instanceof RequestTooLargeError
            ? 'The AI request is too large.'
            : 'Enter a valid AI chat request.',
      })
      return
    }
    const chatRequest = parseAiChatRequest(body)
    if (!chatRequest) {
      sendJson(response, 400, { error: 'Enter a valid AI chat request.' })
      return
    }

    const controller = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) controller.abort()
    })
    // Live progress when the client asks for it; plain JSON otherwise.
    const stream = wantsProgress(request)
      ? progressStream(response, request)
      : null
    const report: ProgressReporter = stream?.report ?? (() => undefined)
    // The answer as it is written, sent in small batches rather than per token.
    let pending = ''
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const flushText = () => {
      flushTimer = undefined
      if (pending) stream?.text(pending)
      pending = ''
    }
    const streamText = stream
      ? (text: string) => {
          pending += text
          flushTimer ??= setTimeout(flushText, 120)
        }
      : undefined
    const reply = (status: number, payload: Record<string, unknown>) => {
      if (flushTimer) clearTimeout(flushTimer)
      flushText()
      if (!stream) sendJson(response, status, payload)
      else if (status >= 400)
        stream.fail(
          typeof payload.error === 'string'
            ? payload.error
            : 'The AI request failed.',
          status,
        )
      else stream.result(payload)
    }
    const boardName =
      chatRequest.jiraScope?.provider === 'trello'
        ? 'Trello'
        : chatRequest.jiraScope?.provider === 'azure-devops'
          ? 'Azure DevOps'
          : 'Jira'

    try {
      report({ step: 'read', label: 'Reading the report' })
      const latestQuestion = chatRequest.messages.at(-1)?.content ?? ''
      const client = new AiClient(config)
      const scope = chatRequest.jiraScope
      // A board that cannot be opened (a removed connection) still lets the
      // report be discussed; the reason comes back only if a read is needed.
      let reader: BoardReader | null = null
      let boardProblem: unknown
      if (scope) {
        try {
          reader = resolveBoard
            ? await resolveBoard(request, scope)
            : environmentReader(scope, jiraConnections)
        } catch (caught) {
          if (controller.signal.aborted) throw caught
          boardProblem = caught
        }
      }
      const boardAllowed =
        chatRequest.allowJiraForConversation ||
        chatRequest.agentApproval?.allowJira === true

      // The agent: the model reads the board itself with read-only tools.
      // Gateways that do not take tools get the planner below instead.
      if (
        reader &&
        !chatRequest.agentApproval &&
        !toollessEndpoints.has(endpointKey(config))
      ) {
        try {
          const outcome = await runAgent({
            client,
            reader,
            context: chatRequest.context,
            messages: chatRequest.messages,
            conversationSummary: chatRequest.conversationSummary,
            boardAllowed,
            boardDeclined: chatRequest.declineBoard === true,
            report,
            ...(streamText ? { onText: streamText } : {}),
            signal: controller.signal,
          })
          reply(200, withCard(outcome, chatRequest.context))
          return
        } catch (caught) {
          if (controller.signal.aborted || !rejectsTools(caught)) throw caught
          if (toollessEndpoints.size >= 200) toollessEndpoints.clear()
          toollessEndpoints.add(endpointKey(config))
          report({ step: 'plan', label: 'Choosing how to answer' })
        }
      }
      const deterministicLookup =
        chatRequest.jiraScope && !chatRequest.declineBoard
          ? resolveAiJiraLookup(
              chatRequest.context,
              chatRequest.messages,
              chatRequest.jiraScope.projectKey,
            )
          : null
      let plan: AiAgentPlan = chatRequest.agentApproval?.plan ?? {
        skillId: chooseAiSkill(latestQuestion),
        jiraSelector: 'none',
        jiraMode: deterministicLookup?.mode ?? 'overview',
      }
      const jiraEvidenceBundles: AiJiraEvidenceBundle[] = []
      const attemptedLookups: AiJiraLookup[] = []
      const attemptedFingerprints = new Set<string>()
      const jiraAllowed =
        chatRequest.allowJiraForConversation ||
        chatRequest.agentApproval?.allowJira === true
      const jiraDenied = chatRequest.agentApproval?.allowJira === false
      let jiraLookup: AiJiraLookup | null = deterministicLookup

      if (chatRequest.agentApproval) {
        // An approved plan without a selector was a direct lookup (named
        // keys, a stage): run that one.
        jiraLookup =
          chatRequest.agentApproval.allowJira && chatRequest.jiraScope
            ? (resolveAgentPlanLookup(
                chatRequest.context,
                chatRequest.messages,
                chatRequest.jiraScope.projectKey,
                plan,
              ) ?? deterministicLookup)
            : null
      } else if (deterministicLookup && !jiraAllowed) {
        // Nothing is read from the board until the person allows it, whether
        // the model proposed the lookup or the question named the items.
        const skill = getAiSkill(plan.skillId)
        reply(200, {
          confirmation: {
            plan,
            skill: { id: skill.id, name: skill.name },
            lookup: deterministicLookup,
          },
        })
        return
      } else if (
        !deterministicLookup &&
        chatRequest.jiraScope &&
        !chatRequest.declineBoard &&
        shouldPlanJiraLookup(latestQuestion)
      ) {
        report({ step: 'plan', label: 'Choosing how to answer' })
        plan = await planOrFallback(
          () =>
            client.plan(
              chatRequest.context,
              chatRequest.messages,
              true,
              {
                attemptedLookups,
                conversationSummary: chatRequest.conversationSummary,
              },
              controller.signal,
            ),
          latestQuestion,
          controller.signal,
        )
        const proposedLookup = resolveAgentPlanLookup(
          chatRequest.context,
          chatRequest.messages,
          chatRequest.jiraScope.projectKey,
          plan,
        )
        if (proposedLookup && !jiraAllowed) {
          const skill = getAiSkill(plan.skillId)
          reply(200, {
            confirmation: {
              plan,
              skill: { id: skill.id, name: skill.name },
              lookup: proposedLookup,
            },
          })
          return
        }
        jiraLookup = proposedLookup
      }

      while (
        jiraLookup &&
        chatRequest.jiraScope &&
        attemptedLookups.length < AI_AGENT_JIRA_TOOL_LIMIT
      ) {
        const fingerprint = jiraLookupFingerprint(jiraLookup)
        if (attemptedFingerprints.has(fingerprint)) break
        attemptedFingerprints.add(fingerprint)
        attemptedLookups.push(jiraLookup)
        report({
          step: 'jira',
          label: `Checking ${jiraLookup.keys.length} ${jiraLookup.keys.length === 1 ? 'item' : 'items'} in ${boardName}`,
          detail:
            jiraLookup.mode === 'detail'
              ? 'Read-only: descriptions, comments, history and links'
              : 'Read-only: status, owner, priority and dates',
        })
        jiraEvidenceBundles.push(
          await evidenceFrom(
            reader ?? throwBoardProblem(boardProblem),
            jiraLookup,
            controller.signal,
          ),
        )

        if (
          !jiraAllowed ||
          jiraDenied ||
          attemptedLookups.length >= AI_AGENT_JIRA_TOOL_LIMIT
        ) {
          break
        }
        const accumulatedEvidence = mergeAiJiraEvidence(jiraEvidenceBundles)
        report({ step: 'plan', label: 'Choosing how to answer' })
        plan = await planOrFallback(
          () =>
            client.plan(
              accumulatedEvidence
                ? { ...chatRequest.context, jiraEvidence: accumulatedEvidence }
                : chatRequest.context,
              chatRequest.messages,
              true,
              {
                attemptedLookups,
                conversationSummary: chatRequest.conversationSummary,
              },
              controller.signal,
            ),
          latestQuestion,
          controller.signal,
        )
        jiraLookup = resolveAgentPlanLookup(
          chatRequest.context,
          chatRequest.messages,
          chatRequest.jiraScope.projectKey,
          plan,
        )
      }

      const jiraEvidence = mergeAiJiraEvidence(jiraEvidenceBundles)
      const skill = getAiSkill(plan.skillId)
      report({
        step: 'answer',
        label: 'Writing',
      })
      const message = await client.chat(
        jiraEvidence
          ? { ...chatRequest.context, jiraEvidence }
          : chatRequest.context,
        chatRequest.messages.slice(-AI_CONVERSATION_MESSAGE_LIMIT),
        skill,
        chatRequest.conversationSummary,
        controller.signal,
      )
      reply(
        200,
        withCard(
          {
            message,
            skill: { id: skill.id, name: skill.name },
            ...(jiraEvidence
              ? {
                  jira: {
                    requestedKeys: jiraEvidence.requestedKeys,
                    checkedKeys: jiraEvidence.issues.map((issue) => issue.key),
                    unavailableKeys: jiraEvidence.unavailableKeys,
                    mode: jiraEvidence.mode,
                    source: jiraEvidence.source,
                    omittedCount: jiraEvidence.omittedCount,
                  },
                }
              : {}),
          },
          chatRequest.context,
        ),
      )
    } catch (caught) {
      if (controller.signal.aborted) return
      if (caught instanceof JiraUpstreamError) {
        const status =
          caught.status >= 400 && caught.status < 600 ? caught.status : 502
        reply(status, { error: caught.message })
        return
      }
      if (caught instanceof AiUpstreamError) {
        const status =
          caught.status >= 400 && caught.status < 600 ? caught.status : 502
        reply(status, { error: caught.message })
        return
      }
      reply(500, {
        error: 'Steerloom could not complete the AI request.',
      })
    }
  }
}

function throwBoardProblem(problem: unknown): never {
  throw problem instanceof Error
    ? problem
    : new JiraUpstreamError(404, 'The board connection could not be opened.')
}

/** Development without workspaces: Jira connections from the environment. */
function environmentReader(
  scope: AiJiraScope,
  connections: JiraServerConnection[],
): BoardReader {
  const connection = connections.find(
    (candidate) => candidate.id === scope.connectionId,
  )
  if (!connection || scope.provider) {
    throw new JiraUpstreamError(404, 'Jira connection not found.')
  }
  if (connection.missing.length) {
    throw new JiraUpstreamError(
      503,
      `Jira connection is incomplete: ${connection.missing.join(', ')}`,
    )
  }
  if (!connection.projectKeys.includes(scope.projectKey)) {
    throw new JiraUpstreamError(
      403,
      'Project is outside this connection’s scope.',
    )
  }
  return jiraReader(new JiraClient(connection), scope.projectKey)
}

/** The planner's lookups, answered by the same reader the agent uses. */
async function evidenceFrom(
  reader: BoardReader,
  lookup: AiJiraLookup,
  signal: AbortSignal,
): Promise<AiJiraEvidenceBundle> {
  const keys = lookup.keys.flatMap((key) => {
    const normal = reader.normaliseKey(key)
    return normal ? [normal] : []
  })
  const { items, unavailable } = await reader.items(
    keys,
    lookup.mode === 'detail',
    signal,
  )
  return {
    mode: lookup.mode,
    source: lookup.source,
    requestedKeys: keys,
    issues: items,
    unavailableKeys: unavailable,
    omittedCount: lookup.omittedCount,
  }
}

class RequestTooLargeError extends Error {}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > AI_CHAT_REQUEST_BYTE_LIMIT) throw new RequestTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isLocalRequest(request: IncomingMessage): boolean {
  const host = request.headers.host ?? ''
  if (!localHostPattern.test(host)) return false
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return localHostPattern.test(new URL(origin).host)
  } catch {
    return false
  }
}

function setApiHeaders(response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function methodNotAllowed(response: ServerResponse, method: string) {
  response.setHeader('Allow', method)
  sendJson(response, 405, { error: `Use ${method} for this endpoint.` })
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  if (response.writableEnded) return
  response.statusCode = status
  response.end(JSON.stringify(payload))
}

/**
 * The planner is a helper, not the answer: when it fails (a model that
 * spends its budget thinking, a provider hiccup) the question is answered
 * from the report with the rule-based plan instead of failing outright.
 */
async function planOrFallback(
  plan: () => Promise<string>,
  question: string,
  signal: AbortSignal,
): Promise<AiAgentPlan> {
  try {
    return parseAiAgentPlan(await plan(), question)
  } catch (caught) {
    if (signal.aborted) throw caught
    return fallbackAiAgentPlan(question)
  }
}

/** The answer as a checked card when the AI wrote one; otherwise unchanged. */
function withCard(
  outcome: Record<string, unknown>,
  context: AiReportContext,
): Record<string, unknown> {
  if (typeof outcome.message !== 'string') return outcome
  const jira = outcome.jira as { checkedKeys?: string[] } | undefined
  return {
    ...outcome,
    ...finishAnswer(outcome.message, context, {
      checked: new Set(jira?.checkedKeys ?? []),
    }),
  }
}
