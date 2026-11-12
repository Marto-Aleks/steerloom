import { checkReach } from '../connections/reach'
import { clientReason } from '../http/progress'
import { attemptLimiter, inFlightLimiter } from '../http/rate-limit'
import { hostedRequestUrl } from './request-policy'
import { publicJiraDispatcher } from './public-network'
import { trelloAuthorization } from './trello-authorization'
import { sendReturnPage } from './return-page'
import { pendingAuthorizations } from '../http/pending-authorizations'
import { progressStream, wantsProgress } from '../http/progress'
import {
  boardReader,
  readBoards,
  requiredField,
  verifyNewConnection,
  type ConnectionRuntime,
  forgetBoards,
} from '../connections'
import type { TrelloProvider } from '../trello/oauth'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectionSecret } from '../workspace/store'
import type { AtlassianProvider } from '../workspace/atlassian'
import { parseJiraConnectionUrl } from '../../src/lib/workspace/jira-url'
import { createAiHandler } from '../ai/vite-plugin'
import { accountIdFromToken, type UsageCounter } from './usage'
import { AiClient } from '../ai/client'
import {
  aiConfigFromKey,
  connectAiKey,
  readAiKeyInput,
} from '../ai/workspace-key'
import { HostedWorkspaceStore, uuid } from './workspace-store'
import { publicMessage } from '../http/public-error'

/** Per account. The browser loads up to 10 chosen boards together. */
export const LIMITS = {
  aiQuestionsAnHour: 60,
  aiQuestionsAtOnce: 3,
  boardReadsAnHour: 120,
  boardLoadsAtOnce: 10,
  setupChecksAnHour: 30,
  modelListsAnHour: 60,
} as const
const TOO_MANY_CHECKS =
  'Too many connection and key checks in an hour. Try again in a little while.'

export interface WorkspaceContext {
  token: string
  sessionId: string
  valid: () => boolean
}
interface Pending {
  sessionId: string
  workspaceId: string
  site: string
  projectKey: string
  boardId?: string
}
export function createHostedWorkspaceServices(
  store: HostedWorkspaceStore,
  atlassian: AtlassianProvider | null,
  proxyUrl?: string,
  trelloProxy?: string,
  trelloProvider: TrelloProvider | null = null,
  publicOrigin?: string,
  usage?: UsageCounter,
) {
  // Count connected boards wherever a connection is saved (token form,
  // Atlassian return, Trello return).
  if (usage) {
    const save = store.saveConnection.bind(store)
    store.saveConnection = async (token, ...rest) => {
      const id = await save(token, ...rest)
      usage.count('board_connected', accountIdFromToken(token))
      return id
    }
  }
  const publicDispatcher = publicOrigin ? publicJiraDispatcher() : undefined
  const trello = trelloAuthorization(store, trelloProvider, trelloProxy)
  const pending = pendingAuthorizations<Pending>({
    cookie: 'steerloom_workspace_atlassian',
    path: '/api/hosted',
  })
  const refreshing = new Map<string, Promise<string>>()
  // Address checks reach out to the internet on a workspace's behalf.
  const reachAttempts = attemptLimiter({
    windowMs: 60 * 60_000,
    capacity: 5000,
  })
  /*
   * What one account may ask of the shared server in an hour, and at once.
   * Anyone can sign up, every question spends the workspace's AI key, and a
   * board load is minutes of requests held in memory: without these one
   * account could slow the site for everyone or run up a workspace's bill.
   * They sit well above what a person does by hand.
   */
  const hourly = () => attemptLimiter({ windowMs: 60 * 60_000 })
  const aiQuestions = hourly()
  const boardReads = hourly()
  const setupChecks = hourly()
  const modelLists = hourly()
  const running = inFlightLimiter()
  const accountOf = (context: WorkspaceContext) =>
    accountIdFromToken(context.token) ?? context.sessionId
  const contexts = new WeakMap<
    IncomingMessage,
    { context: WorkspaceContext; workspaceId: string }
  >()
  const cloudToken = async (
    context: WorkspaceContext,
    workspaceId: string,
    id: string,
  ): Promise<string> => {
    if (!context.valid()) throw new Error('Sign in to continue.')
    const stored = await store.connection(context.token, workspaceId, id)
    const secret = stored.secret
    const oauth = secret.provider === 'trello' ? trelloProvider : atlassian
    if (
      (secret.provider !== 'trello' && secret.jiraEdition !== 'cloud') ||
      !secret.token ||
      !secret.refreshToken ||
      !oauth
    )
      throw new Error('Reconnect this board provider.')
    if ((secret.expiresAt ?? 0) > Date.now() + 60000) return secret.token
    const key = `${workspaceId}:${id}`
    const existing = refreshing.get(key)
    if (existing) {
      await existing
      return cloudToken(context, workspaceId, id)
    }
    const promise = (async () => {
      const tokens = await oauth.refresh(secret.refreshToken!)
      // The provider rotated the refresh token: save it before anything
      // else, or the connection is dead until someone reconnects.
      const changed = await store.refreshConnection(
        context.token,
        workspaceId,
        id,
        {
          ...secret,
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
        stored.encrypted,
      )
      if (!context.valid()) throw new Error('Sign in to continue.')
      if (!changed) {
        // Another request refreshed first: use what it saved.
        const latest = await store.connection(context.token, workspaceId, id)
        if (
          latest.secret.token &&
          (latest.secret.expiresAt ?? 0) > Date.now() + 60000
        )
          return latest.secret.token
        throw new Error('Connection changed during refresh. Try again.')
      }
      return tokens.accessToken
    })()
    refreshing.set(key, promise)
    try {
      return await promise
    } finally {
      refreshing.delete(key)
    }
  }
  const runtime = (
    context: WorkspaceContext,
    workspaceId: string,
  ): ConnectionRuntime => ({
    proxyUrl: proxyUrl ?? '',
    trelloProxy,
    dispatcher: publicDispatcher,
    requirePublicJira: !!publicOrigin,
    accessToken: (id) => cloudToken(context, workspaceId, id),
  })
  // Hosted workspaces always bring their own key; there is no shared fallback.
  const aiNetwork = () =>
    publicDispatcher
      ? { dispatcher: publicDispatcher }
      : { proxyUrl: proxyUrl ?? '' }
  const ai = createAiHandler(
    () => [],
    async (request, scope) => {
      const entry = contexts.get(request)
      if (!entry || !entry.context.valid())
        throw new Error('Sign in to investigate board items.')
      const { context, workspaceId } = entry
      const { secret } = await store.connection(
        context.token,
        workspaceId,
        scope.connectionId,
      )
      return boardReader(
        scope.connectionId,
        secret,
        scope,
        runtime(context, workspaceId),
      )
    },
    publicOrigin
      ? (request) => {
          try {
            hostedRequestUrl(request, publicOrigin)
            return contexts.get(request)?.context.valid() === true
          } catch {
            return false
          }
        }
      : undefined,
    async (request) => {
      const entry = contexts.get(request)
      if (!entry || !entry.context.valid()) return null
      const key = await store.aiKey(entry.context.token, entry.workspaceId)
      return key ? aiConfigFromKey(key, aiNetwork()) : null
    },
  )
  const result = (response: ServerResponse, value: unknown, status = 200) => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(value))
  }
  const tooMany = (response: ServerResponse, error: string) => {
    result(response, { error }, 429)
    return true
  }
  async function handle(
    context: WorkspaceContext,
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    readBody: () => Promise<Record<string, unknown>>,
  ): Promise<boolean> {
    if (
      url.pathname === '/api/hosted/trello/callback' &&
      request.method === 'GET'
    ) {
      await trello.callback(context, request, response, url)
      return true
    }
    if (
      url.pathname === '/api/hosted/atlassian/callback' &&
      request.method === 'GET'
    ) {
      const tx = pending.consume(
        request,
        response,
        url.searchParams.get('state') ?? '',
        url.protocol === 'https:',
      )
      let destination = '/?hosted=1&jira=error'
      try {
        if (
          !atlassian ||
          !tx ||
          tx.sessionId !== context.sessionId ||
          url.searchParams.has('error')
        )
          throw new Error('Invalid authorization.')
        const code = url.searchParams.get('code')
        if (!code || code.length > 2048)
          throw new Error('Invalid authorization.')
        const role = (await store.session(context.token, tx.workspaceId))
          .workspaceRole
        if (role === 'member')
          throw new Error('Connection management is not permitted.')
        const tokens = await atlassian.exchange(code)
        const sites = await atlassian.resources(tokens.accessToken)
        const site = sites.find(
          (item) =>
            item.url.replace(/\/$/, '') === tx.site &&
            item.scopes.includes('read:jira-work') &&
            item.scopes.includes('read:board-scope:jira-software'),
        )
        if (!site || !context.valid())
          throw new Error('Authorized site does not match.')
        const secret: ConnectionSecret = {
          provider: 'jira',
          name: new URL(tx.site).hostname,
          baseUrl: tx.site,
          jiraEdition: 'cloud',
          cloudId: site.id,
          projectKey: tx.projectKey,
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        }
        const session = await store.session(context.token, tx.workspaceId)
        const existing = session.connections.find(
          (item) =>
            item.jiraEdition === 'cloud' &&
            item.projectKey === tx.projectKey &&
            item.name === secret.name,
        )
        const id = await store.saveConnection(
          context.token,
          tx.workspaceId,
          secret,
          existing?.id,
        )
        destination = `/?hosted=1&workspace=${tx.workspaceId}&jira=connected&connection=${id}${tx.boardId ? `&board=${tx.boardId}` : ''}`
      } catch {
        if (tx)
          destination = `/?hosted=1&workspace=${tx.workspaceId}&jira=error`
      }
      sendReturnPage(response, destination)
      return true
    }
    const match = /^\/api\/hosted\/workspaces\/([a-f0-9-]+)(\/.*)$/.exec(
      url.pathname,
    )
    const workspaceId = match?.[1],
      path = match?.[2]
    if (!workspaceId || path === undefined || !uuid(workspaceId)) return false
    const session = await store.session(context.token, workspaceId)
    if (!context.valid()) throw new Error('Sign in to continue.')
    const editing = session.workspaceRole !== 'member'
    if (request.method !== 'GET' && !editing && !path.startsWith('/ai/')) {
      result(
        response,
        { error: 'Only owners and admins can change workspace settings.' },
        403,
      )
      return true
    }
    if (path === '/session' && request.method === 'GET') {
      result(response, { session })
      return true
    }
    if (path === '/providers' && request.method === 'GET') {
      result(response, {
        google: false,
        atlassian: !!atlassian,
        trello: !!trelloProvider,
      })
      return true
    }
    const account = accountOf(context)
    if (path === '/ai-settings' && request.method === 'PUT') {
      if (!setupChecks.hit(account, LIMITS.setupChecksAnHour))
        return tooMany(response, TOO_MANY_CHECKS)
      const controller = new AbortController()
      response.on('close', () => {
        if (!response.writableEnded) controller.abort()
      })
      const secret = await connectAiKey(
        readAiKeyInput(
          await readBody(),
          await store.aiKey(context.token, workspaceId),
          { requirePublic: !!publicOrigin, requireModel: false },
        ),
        aiNetwork(),
        controller.signal,
      )
      await store.saveAiKey(context.token, workspaceId, secret)
      result(response, {
        session: await store.session(context.token, workspaceId),
      })
      return true
    }
    if (path === '/ai-models' && request.method === 'POST') {
      if (!modelLists.hit(account, LIMITS.modelListsAnHour))
        return tooMany(response, TOO_MANY_CHECKS)
      const secret = readAiKeyInput(
        await readBody(),
        await store.aiKey(context.token, workspaceId),
        { requirePublic: !!publicOrigin, requireModel: false },
      )
      const controller = new AbortController()
      response.on('close', () => {
        if (!response.writableEnded) controller.abort()
      })
      result(response, {
        models: await new AiClient(
          aiConfigFromKey(secret, aiNetwork()),
        ).listModels(controller.signal),
      })
      return true
    }
    if (path === '/ai-settings' && request.method === 'DELETE') {
      await store.removeAiKey(context.token, workspaceId)
      result(response, {
        session: await store.session(context.token, workspaceId),
      })
      return true
    }
    if (path.startsWith('/ai/')) {
      const question = path === '/ai/chat' && request.method === 'POST'
      let finished: (() => void) | null = null
      if (question) {
        if (!aiQuestions.hit(account, LIMITS.aiQuestionsAnHour))
          return tooMany(
            response,
            `That is ${LIMITS.aiQuestionsAnHour} questions in an hour, the most one account can ask. Ask again in a little while.`,
          )
        finished = running.enter(`ai:${account}`, LIMITS.aiQuestionsAtOnce)
        if (!finished)
          return tooMany(
            response,
            'Steerloom AI is still answering your earlier questions. Wait for one to finish, then ask again.',
          )
        usage?.count('ai_question', accountIdFromToken(context.token))
      }
      const original = request.url
      request.url = `/api${path}`
      contexts.set(request, { context, workspaceId })
      try {
        await ai(request, response, () =>
          result(response, { error: 'AI route not found.' }, 404),
        )
      } finally {
        finished?.()
        request.url = original
        contexts.delete(request)
      }
      return true
    }
    if (path === '/trello/start' && request.method === 'POST') {
      result(
        response,
        await trello.start(
          context,
          workspaceId,
          await readBody(),
          request,
          response,
          url,
        ),
      )
      return true
    }
    if (path === '/atlassian/start' && request.method === 'POST') {
      if (!atlassian)
        throw new Error('Jira Cloud needs the installation’s Atlassian setup.')
      const input = await readBody()
      const parsed = parseJiraConnectionUrl(requiredField(input.link, 300))
      const projectKey =
        parsed.projectKey ?? requiredField(input.projectKey, 30).toUpperCase()
      if (
        parsed.edition !== 'cloud' ||
        !/^[A-Z][A-Z0-9_]{1,29}$/.test(projectKey)
      )
        throw new Error('Paste a Jira Cloud project link.')
      const state = pending.begin(
        request,
        response,
        {
          sessionId: context.sessionId,
          workspaceId,
          site: parsed.baseUrl,
          projectKey,
          boardId: parsed.boardId,
        },
        {
          secure: url.protocol === 'https:',
          supersedes: (tx) => tx.sessionId === context.sessionId,
        },
      )
      result(response, { url: atlassian.authorize(state).href })
      return true
    }
    const controller = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) controller.abort()
    })
    if (path === '/reach' && request.method === 'POST') {
      if (!reachAttempts.hit(workspaceId, 60))
        throw new Error('Too many address checks. Try again in an hour.')
      const body = await readBody()
      if (typeof body.link !== 'string' || body.link.length > 500)
        throw new Error('Paste a full link, starting with https://')
      const product = body.product === 'azure-devops' ? 'azure-devops' : 'jira'
      result(response, { reach: await checkReach(body.link, product) })
      return true
    }
    if (path === '/connections' && request.method === 'POST') {
      if (!setupChecks.hit(account, LIMITS.setupChecksAnHour))
        return tooMany(response, TOO_MANY_CHECKS)
      const secret = await verifyNewConnection(
        await readBody(),
        runtime(context, workspaceId),
        controller.signal,
      )
      if (!context.valid()) throw new Error('Sign in to continue.')
      await store.saveConnection(context.token, workspaceId, secret)
      result(response, {
        session: await store.session(context.token, workspaceId),
      })
      return true
    }
    const connection =
      /^\/connections\/([a-f0-9-]+)(?:\/boards(?:\/([\w-]+)\/snapshot)?)?$/.exec(
        path,
      )
    const id = connection?.[1]
    if (id) {
      if (
        request.method === 'DELETE' &&
        connection &&
        !path.includes('/boards')
      ) {
        await store.removeConnection(context.token, workspaceId, id)
        forgetBoards(id)
        result(response, {
          session: await store.session(context.token, workspaceId),
        })
        return true
      }
      if (request.method !== 'GET') throw new Error('Use GET to read boards.')
      if (!boardReads.hit(account, LIMITS.boardReadsAnHour))
        return tooMany(
          response,
          `This account has read boards ${LIMITS.boardReadsAnHour} times in the last hour, the most allowed. Try again in a little while.`,
        )
      // Listing boards is one short request; loading one is the heavy part.
      const loaded = connection?.[2]
        ? running.enter(`boards:${account}`, LIMITS.boardLoadsAtOnce)
        : () => {}
      if (!loaded)
        return tooMany(
          response,
          `${LIMITS.boardLoadsAtOnce} boards are already loading for this account. Wait for one to finish, then try again.`,
        )
      try {
        const { secret } = await store.connection(
          context.token,
          workspaceId,
          id,
        )
        if (connection?.[2] && wantsProgress(request)) {
          // Board snapshots can take minutes: stream what is being loaded.
          const stream = progressStream(response, request)
          try {
            stream.result(
              await readBoards(
                id,
                secret,
                runtime(context, workspaceId),
                connection[2],
                controller.signal,
                stream.report,
                url.searchParams.get('fresh') === '1',
              ),
            )
          } catch (caught) {
            stream.fail(
              publicMessage(caught, 'Could not load the board. Try again.'),
              400,
              clientReason(caught),
            )
          }
          return true
        }
        result(
          response,
          await readBoards(
            id,
            secret,
            runtime(context, workspaceId),
            connection?.[2],
            controller.signal,
          ),
        )
        return true
      } finally {
        loaded()
      }
    }
    if (path === '/dashboards' && request.method === 'PUT') {
      await store.saveDashboard(context.token, workspaceId, await readBody())
      result(response, {
        session: await store.session(context.token, workspaceId),
      })
      return true
    }
    const dashboardId = /^\/dashboards\/([\w:-]+)$/.exec(path)?.[1]
    if (dashboardId && request.method === 'DELETE') {
      await store.removeDashboard(context.token, workspaceId, dashboardId)
      result(response, {
        session: await store.session(context.token, workspaceId),
      })
      return true
    }
    result(response, { error: 'Workspace route not found.' }, 404)
    return true
  }
  function callbackSessionId(
    request: IncomingMessage,
    url: URL,
  ): string | undefined {
    if (url.pathname === '/api/hosted/trello/callback')
      return trello.callbackSessionId(request, url)
    if (url.pathname !== '/api/hosted/atlassian/callback') return undefined
    return pending.peek(request, url.searchParams.get('state') ?? '')?.sessionId
  }
  return { handle, callbackSessionId }
}
