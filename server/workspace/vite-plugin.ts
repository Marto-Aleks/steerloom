import { LocalSessions, SESSION_LIFETIME as sessionLifetime } from './sessions'
import {
  atlassianConnections,
  loadAtlassianProvider,
  type AtlassianProvider,
} from './atlassian'
import {
  googleAuthFlow,
  loadGoogleProvider,
  type GoogleProvider,
} from './google'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AiClient } from '../ai/client'
import { loadAiServerConfig, type AiServerConfig } from '../ai/config'
import type { AiConfigResolver } from '../ai/vite-plugin'
import {
  AiModelRequiredError,
  aiConfigFromKey,
  connectAiKey,
  readAiKeyInput,
} from '../ai/workspace-key'
import { GithubClient, GithubError } from '../github/client'
import { connectGithub, readGithubInput } from '../github/workspace-github'
import { FigmaClient, FigmaError } from '../figma/client'
import {
  connectFigma,
  readFigmaFiles,
  readFigmaInput,
} from '../figma/workspace-figma'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { readDashboard } from '../../src/lib/workspace/model'
import {
  loadInstallationProxy,
  type JiraServerConnection,
} from '../jira/config'
import { loadTrelloProxy } from '../trello/config'
import { WorkspaceStore } from './store'
import type { BoardReader } from '../ai/board-reader'
import type { AiJiraScope } from '../../src/lib/ai/jira-evidence'
import { appendCookie, readSecretCookie } from '../http/cookies'
import { attemptLimiter } from '../http/rate-limit'
import { JiraUpstreamError } from '../jira/jira-client'
import { forgetBoards } from '../connections'
import { AzureDevOpsError } from '../azure-devops/client'
import { connectMiddleware } from '../http/middleware'
import { progressStream, wantsProgress } from '../http/progress'
import {
  boardReader,
  jiraConnection,
  readBoards,
  verifyNewConnection,
  type ConnectionRuntime,
} from '../connections'

const localHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i
const sessionCookie = 'flowlens_session'
type Next = () => void
export interface WorkspaceServices {
  plugin: Plugin
  handle: (
    request: IncomingMessage,
    response: ServerResponse,
    next: Next,
  ) => Promise<void>
  jiraConnections: (request: IncomingMessage) => JiraServerConnection[]
  /** The assistant's read-only view of the board a report came from. */
  boardReader: (
    request: IncomingMessage,
    scope: AiJiraScope,
  ) => Promise<BoardReader>
  aiConfig: AiConfigResolver
}

export function createWorkspaceServices(
  directory = process.env.FLOWLENS_WORKSPACE_DIR ||
    resolve(process.cwd(), '.flowlens'),
  proxyUrl: string = loadInstallationProxy(),
  googleProvider: GoogleProvider | null = loadGoogleProvider(),
  atlassianProvider: AtlassianProvider | null = loadAtlassianProvider(),
  /** The packaged app's start link: its secret and who it creates on a first start. */
  start?: {
    secret: () => string | undefined
    /** Called after the link signed someone in, to replace the secret. */
    used?: () => void
    owner: { username: string; workspaceName: string }
  },
): WorkspaceServices {
  let storeInstance: WorkspaceStore | undefined
  const getStore = () => (storeInstance ??= new WorkspaceStore(directory))
  const trelloProxyUrl = loadTrelloProxy(proxyUrl)
  const sessions = new LocalSessions(directory)
  const liveSession = (token?: string) => {
    const session = token ? sessions.get(token) : undefined
    return session && session.expires > Date.now() ? session.userId : undefined
  }
  const issueSession = (
    id: string,
    response: ServerResponse,
    oldToken?: string,
  ) => {
    if (oldToken) sessions.delete(oldToken)
    const newToken = randomBytes(32).toString('hex')
    sessions.set(newToken, {
      userId: id,
      expires: Date.now() + sessionLifetime,
    })
    appendCookie(response, sessionCookie, newToken, {
      path: '/',
      sameSite: 'Strict',
      maxAge: sessionLifetime / 1000,
    })
  }
  const google = googleAuthFlow(
    googleProvider,
    getStore,
    liveSession,
    issueSession,
  )
  const atlassian = atlassianConnections(
    atlassianProvider,
    getStore,
    liveSession,
  )
  const requestUsers = new WeakMap<IncomingMessage, string>()
  const attempts = attemptLimiter()
  const runtime = (userId: string): ConnectionRuntime => ({
    proxyUrl,
    trelloProxy: trelloProxyUrl,
    // A local install always runs on the user's own machine, so Jira Cloud
    // email + API token is always allowed; the form prefers OAuth when usable.
    jiraCloudToken: true,
    accessToken: (connectionId) => atlassian.accessToken(userId, connectionId),
  })
  const connectionConfig = (userId: string, connectionId: string) =>
    jiraConnection(
      connectionId,
      getStore().connection(userId, connectionId),
      runtime(userId),
    )
  const jiraConnections = (
    request: IncomingMessage,
  ): JiraServerConnection[] => {
    const userId = requestUsers.get(request)
    if (!userId) return []
    return getStore()
      .session(userId)
      .connections.filter((item) => item.provider === 'jira')
      .map((item) => connectionConfig(userId, item.id))
  }
  const boardReaderFor = (
    request: IncomingMessage,
    scope: AiJiraScope,
  ): Promise<BoardReader> => {
    const userId = requestUsers.get(request)
    if (!userId)
      return Promise.reject(new Error('Sign in to investigate board items.'))
    return Promise.resolve(
      boardReader(
        scope.connectionId,
        getStore().connection(userId, scope.connectionId),
        scope,
        runtime(userId),
      ),
    )
  }
  // Local installs fall back to the FLOWLENS_AI_* environment settings.
  let environmentAi: AiServerConfig | undefined
  const aiEnvironment = () => (environmentAi ??= loadAiServerConfig())
  const aiNetwork = () => ({ proxyUrl: aiEnvironment().proxyUrl || proxyUrl })
  const aiConfig: AiConfigResolver = (request) => {
    const userId = requestUsers.get(request)
    const key = userId ? getStore().aiKey(userId) : undefined
    return key ? aiConfigFromKey(key, aiNetwork()) : aiEnvironment()
  }
  const json = (response: ServerResponse, status: number, value: unknown) => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(value))
  }
  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: Next,
  ) => {
    if (!(request.url ?? '').startsWith('/api/')) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const host = request.headers.host ?? ''
    if (
      !localHost.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`)
    ) {
      json(response, 403, { error: 'Local, same-origin requests only.' })
      return
    }
    const url = new URL(request.url!, `http://${host}`)
    const path = url.pathname
    const token = readSecretCookie(request, sessionCookie)
    const session = token ? sessions.get(token) : undefined
    const userId =
      session && session.expires > Date.now() ? session.userId : undefined
    if (token && !userId) sessions.delete(token)
    if (path === '/api/auth/session' && request.method === 'GET') {
      json(response, 200, {
        session: userId ? getStore().session(userId) : null,
      })
      return
    }
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method ?? '')) {
      response.setHeader('Allow', 'GET, POST, PUT, DELETE')
      json(response, 405, { error: 'Method not supported.' })
      return
    }
    if (
      request.method !== 'GET' &&
      request.headers['content-type']?.split(';')[0] !== 'application/json'
    ) {
      json(response, 415, { error: 'Send JSON for this request.' })
      return
    }
    try {
      if (path === '/api/auth/providers' && request.method === 'GET') {
        json(response, 200, {
          atlassian:
            atlassian.configured &&
            atlassianProvider?.redirectUri.origin === url.origin,
          jiraCloudToken: true,
          google:
            google.configured &&
            googleProvider?.redirectUri.origin === url.origin,
        })
        return
      }
      if (path === '/api/auth/atlassian/start' && request.method === 'POST') {
        const body = await readBody(request)
        json(
          response,
          200,
          atlassian.start(
            request,
            response,
            string(body.link, 300),
            typeof body.projectKey === 'string'
              ? body.projectKey.toUpperCase()
              : '',
          ),
        )
        return
      }
      if (path === '/api/auth/atlassian/callback' && request.method === 'GET') {
        await atlassian.callback(request, response, url)
        return
      }
      if (path === '/api/auth/google/start' && request.method === 'POST') {
        const body = await readBody(request)
        if (body.mode !== 'login' && body.mode !== 'link')
          throw new Error('Choose a sign-in action.')
        json(
          response,
          200,
          await google.start(request, response, body.mode === 'link'),
        )
        return
      }
      if (path === '/api/auth/google/callback' && request.method === 'GET') {
        await google.callback(request, response, url)
        return
      }
      // The app icon opens this with the secret only this computer user can
      // read, and lands signed in. Any other visit goes to the sign-in page.
      if (path === '/api/auth/start' && request.method === 'GET') {
        const given = Buffer.from(url.searchParams.get('token') ?? '')
        const expected = Buffer.from(start?.secret() ?? '')
        if (
          start &&
          expected.length >= 32 &&
          given.length === expected.length &&
          timingSafeEqual(given, expected)
        ) {
          const id = getStore().startUser(start.owner)
          if (id) issueSession(id, response, token)
          // One use: the link was visible to other programs on this computer
          // while the browser opened it.
          start.used?.()
        }
        response.statusCode = 302
        response.setHeader('Location', '/')
        response.end()
        return
      }
      if (
        (path === '/api/auth/login' || path === '/api/auth/register') &&
        request.method === 'POST'
      ) {
        const address = request.socket.remoteAddress ?? 'local'
        if (!attempts.hit(address, 20)) {
          json(response, 429, {
            error: 'Too many sign-in attempts. Try again in 15 minutes.',
          })
          return
        }
        const body = await readBody(request)
        const username = string(body.username, 40)
        const password = string(body.password, 128, false)
        const id = path.endsWith('register')
          ? await getStore().register(
              username,
              password,
              string(body.workspaceName, 100),
            )
          : await getStore().login(username, password)
        attempts.reset(address)
        issueSession(id, response, token)
        json(response, 200, { session: getStore().session(id) })
        return
      }
      if (!userId) {
        json(response, 401, { error: 'Sign in to your workspace.' })
        return
      }
      requestUsers.set(request, userId)
      if (path === '/api/auth/logout' && request.method === 'POST') {
        if (token) sessions.delete(token)
        appendCookie(response, sessionCookie, '', {
          path: '/',
          sameSite: 'Strict',
          maxAge: 0,
        })
        json(response, 200, { ok: true })
        return
      }
      if (path === '/api/workspace/name' && request.method === 'PUT') {
        getStore().nameWorkspace(
          userId,
          string((await readBody(request)).name, 100),
        )
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (path === '/api/workspace/ai-settings' && request.method === 'PUT') {
        const secret = await connectAiKey(
          readAiKeyInput(await readBody(request), getStore().aiKey(userId), {
            requireModel: false,
          }),
          aiNetwork(),
          abortOnClose(response),
        )
        getStore().saveAiKey(userId, secret)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (path === '/api/workspace/ai-models' && request.method === 'POST') {
        const secret = readAiKeyInput(
          await readBody(request),
          getStore().aiKey(userId),
          { requireModel: false },
        )
        json(response, 200, {
          models: await new AiClient(
            aiConfigFromKey(secret, aiNetwork()),
          ).listModels(abortOnClose(response)),
        })
        return
      }
      if (
        path === '/api/workspace/ai-settings' &&
        request.method === 'DELETE'
      ) {
        getStore().removeAiKey(userId)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (
        path === '/api/workspace/github-settings' &&
        request.method === 'PUT'
      ) {
        const secret = await connectGithub(
          readGithubInput(
            await readBody(request),
            getStore().githubKey(userId),
          ),
          { proxyUrl },
          abortOnClose(response),
        )
        getStore().saveGithubKey(userId, secret)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (
        path === '/api/workspace/github-settings' &&
        request.method === 'DELETE'
      ) {
        getStore().removeGithubKey(userId)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (
        path === '/api/workspace/github/pull-requests' &&
        request.method === 'POST'
      ) {
        const secret = getStore().githubKey(userId)
        if (!secret) throw new Error('Connect GitHub on the workspace page.')
        const body = await readBody(request)
        const since = new Date(string(body.since, 40))
        if (Number.isNaN(since.getTime()))
          throw new Error('Choose a reporting period.')
        const client = new GithubClient({ ...secret, proxyUrl })
        const signal = abortOnClose(response)
        // The connection's own repositories; a request cannot name others.
        const repositories = secret.repositories ?? []
        const started = Date.now()
        const tally = { read: 0 }
        const seconds = () => ((Date.now() - started) / 1000).toFixed(1)
        let pullRequests
        let branches
        try {
          // Pull requests first, then branches: the same number of
          // connections at once as before, which company proxies cope with.
          pullRequests = (
            await Promise.all(
              repositories.map((name) =>
                client.pullRequests(name, since, signal, tally),
              ),
            )
          ).flat()
          // Optional: a fine-grained token without Contents: read sees no
          // branches, and pull requests still load.
          branches = (
            await Promise.all(
              repositories.map((name) =>
                client.branches(name, since, signal).catch(() => []),
              ),
            )
          ).flat()
        } catch (caught) {
          // Counts and timing only: never names, titles or keys.
          console.log(
            `[github] pull requests failed after ${seconds()} s (${repositories.length} repositories)`,
          )
          throw caught
        }
        console.log(
          `[github] ${repositories.length} repositories: ${tally.read} pull requests read, ${pullRequests.length} with item keys, ${branches.length} branches with item keys, in ${seconds()} s`,
        )
        json(response, 200, { pullRequests, branches })
        return
      }
      if (
        path === '/api/workspace/figma-settings' &&
        request.method === 'PUT'
      ) {
        const secret = await connectFigma(
          readFigmaInput(await readBody(request), getStore().figmaKey(userId)),
          { proxyUrl },
          abortOnClose(response),
        )
        getStore().saveFigmaKey(userId, secret)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (
        path === '/api/workspace/figma-settings' &&
        request.method === 'DELETE'
      ) {
        getStore().removeFigmaKey(userId)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      // Names the dashboard's files, so a wrong link shows before saving.
      if (path === '/api/workspace/figma/files' && request.method === 'POST') {
        const secret = getStore().figmaKey(userId)
        if (!secret) throw new Error('Connect Figma on the workspace page.')
        const client = new FigmaClient({ ...secret, proxyUrl })
        const signal = abortOnClose(response)
        const keys = readFigmaFiles((await readBody(request)).files)
        const files = await Promise.all(
          keys.map(async (key) => ({
            key,
            name: await client.fileName(key, signal),
          })),
        )
        json(response, 200, { files })
        return
      }
      if (path === '/api/workspace/connections' && request.method === 'POST') {
        const secret = await verifyNewConnection(
          await readBody(request),
          runtime(userId),
          abortOnClose(response),
        )
        getStore().addConnection(userId, secret)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      const connectionMatch =
        /^\/api\/workspace\/connections\/([\w-]+)(?:\/(boards)(?:\/([\w-]+)\/(snapshot))?)?$/.exec(
          path,
        )
      if (connectionMatch) {
        const id = connectionMatch[1]!
        const secret = getStore().connection(userId, id)
        if (request.method === 'DELETE' && !connectionMatch[2]) {
          getStore().removeConnection(userId, id)
          forgetBoards(id)
          json(response, 200, { session: getStore().session(userId) })
          return
        }
        if (request.method !== 'GET' || !connectionMatch[2]) {
          json(response, 405, { error: 'Use GET to read boards.' })
          return
        }
        if (connectionMatch[3] && wantsProgress(request)) {
          // Board snapshots can take minutes: stream what is being loaded.
          const stream = progressStream(response, request)
          try {
            stream.result(
              await readBoards(
                id,
                secret,
                runtime(userId),
                connectionMatch[3],
                abortOnClose(response),
                stream.report,
                url.searchParams.get('fresh') === '1',
              ),
            )
          } catch (caught) {
            stream.fail(
              caught instanceof Error
                ? caught.message
                : 'The request could not be completed.',
              400,
              failureReason(caught).reason,
            )
          }
          return
        }
        json(
          response,
          200,
          await readBoards(
            id,
            secret,
            runtime(userId),
            connectionMatch[3],
            abortOnClose(response),
          ),
        )
        return
      }
      if (path === '/api/workspace/dashboards' && request.method === 'PUT') {
        getStore().saveDashboard(userId, readDashboard(await readBody(request)))
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      const dashboardMatch = /^\/api\/workspace\/dashboards\/([\w:-]+)$/.exec(
        path,
      )
      if (dashboardMatch && request.method === 'DELETE') {
        getStore().removeDashboard(userId, dashboardMatch[1]!)
        json(response, 200, { session: getStore().session(userId) })
        return
      }
      if (path.startsWith('/api/workspace/') || path.startsWith('/api/auth/')) {
        json(response, 404, { error: 'Endpoint not found.' })
        return
      }
      next()
    } catch (caught) {
      json(response, 400, {
        error:
          caught instanceof Error
            ? caught.message
            : 'The request could not be completed.',
        ...failureReason(caught),
      })
    }
  }
  return {
    handle,
    jiraConnections,
    boardReader: boardReaderFor,
    aiConfig,
    plugin: {
      name: 'flowlens-workspace',
      configureServer(server) {
        server.middlewares.use(connectMiddleware(handle))
      },
      configurePreviewServer(server) {
        server.middlewares.use(connectMiddleware(handle))
      },
    },
  }
}

/** A machine-readable reason the connect form can act on, when there is one. */
function failureReason(caught: unknown): { reason?: string } {
  const reason =
    caught instanceof JiraUpstreamError || caught instanceof AzureDevOpsError
      ? caught.reason
      : caught instanceof AiModelRequiredError ||
          caught instanceof GithubError ||
          caught instanceof FigmaError
        ? caught.reason
        : undefined
  return reason ? { reason } : {}
}

function abortOnClose(response: ServerResponse): AbortSignal {
  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })
  return controller.signal
}
function string(value: unknown, maximum: number, trim = true): string {
  if (typeof value !== 'string' || value.length > maximum || !value.trim())
    throw new Error('Complete the required fields.')
  return trim ? value.trim() : value
}
async function readBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 32_768) throw new Error('Request is too large.')
    chunks.push(bytes)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid request.')
  return value as Record<string, unknown>
}
