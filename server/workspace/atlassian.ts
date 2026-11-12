import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { localEnvironment } from '../http/local-env'
import { fetch, ProxyAgent } from 'undici'
import { parseJiraConnectionUrl } from '../../src/lib/workspace/jira-url'
import type { WorkspaceStore } from './store'
import { readSecretCookie } from '../http/cookies'
import { pendingAuthorizations } from '../http/pending-authorizations'

export const ATLASSIAN_SCOPES = [
  'offline_access',
  'read:jira-work',
  'read:board-scope:jira-software',
  'read:board-scope.admin:jira-software',
  'read:project:jira',
  'read:issue-details:jira',
] as const
export interface AtlassianTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
export interface AtlassianResource {
  id: string
  url: string
  scopes: string[]
}
export interface AtlassianProvider {
  redirectUri: URL
  authorize(state: string): URL
  exchange(code: string): Promise<AtlassianTokens>
  resources(token: string): Promise<AtlassianResource[]>
  refresh(token: string): Promise<AtlassianTokens>
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function tokens(value: unknown): AtlassianTokens {
  if (
    !record(value) ||
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    value.access_token.length > 16384 ||
    /[\r\n]/.test(value.access_token) ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token ||
    value.refresh_token.length > 16384 ||
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > 86400
  )
    throw new Error(
      'Atlassian authorization could not be completed. Connect again.',
    )
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: Date.now() + value.expires_in * 1000,
  }
}
export function loadAtlassianProvider(
  env: Record<string, string> = localEnvironment(),
): AtlassianProvider | null {
  const clientId = env.STEERLOOM_ATLASSIAN_CLIENT_ID,
    secret = env.STEERLOOM_ATLASSIAN_CLIENT_SECRET
  if (!clientId || !secret) return null
  let redirectUri: URL
  try {
    redirectUri = new URL(
      env.STEERLOOM_ATLASSIAN_REDIRECT_URI ||
        'http://127.0.0.1:5173/api/auth/atlassian/callback',
    )
  } catch {
    return null
  }
  if (
    !(
      redirectUri.protocol === 'https:' ||
      (redirectUri.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(redirectUri.hostname))
    ) ||
    ![
      '/api/auth/atlassian/callback',
      '/api/hosted/atlassian/callback',
    ].includes(redirectUri.pathname) ||
    redirectUri.search ||
    redirectUri.hash ||
    redirectUri.username ||
    redirectUri.password
  )
    return null
  let dispatcher: ProxyAgent | undefined
  const proxy =
    env.STEERLOOM_ATLASSIAN_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY
  if (proxy) {
    try {
      const parsed = new URL(proxy)
      if (!['https:', 'http:'].includes(parsed.protocol)) return null
      dispatcher = new ProxyAgent(parsed.href)
    } catch {
      return null
    }
  }
  async function tokenRequest(body: Record<string, string>) {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      redirect: 'error',
      dispatcher,
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...body,
        client_id: clientId,
        client_secret: secret,
      }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(
        'Atlassian authorization expired or was revoked. Connect again.',
      )
    }
    return tokens(await response.json())
  }
  return {
    redirectUri,
    authorize(state) {
      const url = new URL('https://auth.atlassian.com/authorize')
      url.search = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: clientId,
        scope: ATLASSIAN_SCOPES.join(' '),
        redirect_uri: redirectUri.href,
        state,
        response_type: 'code',
        prompt: 'consent',
      }).toString()
      return url
    },
    exchange: (code) =>
      tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri.href,
      }),
    refresh: (refresh_token) =>
      tokenRequest({ grant_type: 'refresh_token', refresh_token }),
    async resources(token) {
      const response = await fetch(
        'https://api.atlassian.com/oauth/token/accessible-resources',
        {
          method: 'GET',
          redirect: 'error',
          dispatcher,
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      )
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('Could not verify the authorized Jira site.')
      }
      const value: unknown = await response.json()
      if (!Array.isArray(value))
        throw new Error('Invalid Atlassian site response.')
      return value
        .filter(record)
        .flatMap((item) =>
          typeof item.id === 'string' &&
          /^[a-zA-Z0-9-]{1,100}$/.test(item.id) &&
          typeof item.url === 'string' &&
          Array.isArray(item.scopes) &&
          item.scopes.every((scope) => typeof scope === 'string')
            ? [{ id: item.id, url: item.url, scopes: item.scopes }]
            : [],
        )
    },
  }
}
interface Transaction {
  userId: string
  session: string
  site: string
  project: string
  boardId?: string
}
export function atlassianConnections(
  provider: AtlassianProvider | null,
  store: () => WorkspaceStore,
  liveSession: (token?: string) => string | undefined,
) {
  const pending = pendingAuthorizations<Transaction>({
    cookie: 'steerloom_atlassian',
    path: '/api/auth/atlassian',
    busyMessage: 'Too many pending connections. Try again later.',
  })
  const refreshing = new Map<string, Promise<string>>()
  return {
    configured: !!provider,
    start(
      request: IncomingMessage,
      response: ServerResponse,
      link: string,
      project: string,
    ) {
      if (
        !provider ||
        request.headers.origin !== provider.redirectUri.origin ||
        `http://${request.headers.host}` !== provider.redirectUri.origin
      )
        throw new Error(
          'Jira Cloud authorization needs administrator setup on this installation.',
        )
      const session = readSecretCookie(request, 'flowlens_session'),
        userId = liveSession(session)
      if (!session || !userId)
        throw new Error('Sign into Steerloom before connecting Jira.')
      const parsed = parseJiraConnectionUrl(link)
      if (
        parsed.edition !== 'cloud' ||
        !/^[A-Z][A-Z0-9_]{1,29}$/.test(parsed.projectKey ?? project)
      )
        throw new Error(
          'Paste a Jira Cloud project link or enter its project key.',
        )
      const state = pending.begin(
        request,
        response,
        {
          userId,
          session,
          site: parsed.baseUrl,
          boardId: parsed.boardId,
          project: parsed.projectKey ?? project,
        },
        { secure: false, supersedes: (tx) => tx.userId === userId },
      )
      return { url: provider.authorize(state).href }
    },
    async callback(
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ) {
      response.setHeader('Referrer-Policy', 'no-referrer')
      // Consumed before any provider call, so a state can never be replayed.
      const tx = pending.consume(
        request,
        response,
        url.searchParams.get('state') ?? '',
        false,
      )
      let result = 'error'
      let connectedId = ''
      try {
        if (!provider || url.origin !== provider.redirectUri.origin || !tx)
          throw new Error('Invalid connection attempt.')
        const code = url.searchParams.get('code')
        if (
          !code ||
          code.length > 4096 ||
          url.searchParams.has('error') ||
          liveSession(tx.session) !== tx.userId
        )
          throw new Error('Authorization was not completed.')
        const grant = await provider.exchange(code)
        const resources = await provider.resources(grant.accessToken)
        const resource = resources.find((item) => {
          try {
            return (
              new URL(item.url).origin === tx.site &&
              item.scopes.includes('read:jira-work') &&
              item.scopes.includes('read:board-scope:jira-software')
            )
          } catch {
            return false
          }
        })
        if (!resource || liveSession(tx.session) !== tx.userId)
          throw new Error('The selected site was not authorized.')
        const secret: import('./store').ConnectionSecret = {
          provider: 'jira',
          jiraEdition: 'cloud',
          name: new URL(tx.site).hostname,
          baseUrl: tx.site,
          cloudId: resource.id,
          projectKey: tx.project,
          token: grant.accessToken,
          refreshToken: grant.refreshToken,
          expiresAt: grant.expiresAt,
        }
        const existing = store()
          .session(tx.userId)
          .connections.find(
            (connection) =>
              connection.jiraEdition === 'cloud' &&
              connection.projectKey === tx.project &&
              store().connection(tx.userId, connection.id).baseUrl === tx.site,
          )
        if (existing) {
          store().updateConnectionSecret(tx.userId, existing.id, secret)
          connectedId = existing.id
        } else connectedId = store().addConnection(tx.userId, secret).id
        result = 'connected'
      } catch {
        // Fixed error destination; provider errors are never echoed.
      }
      const destination =
        result === 'connected'
          ? `/?jira=connected&connection=${encodeURIComponent(connectedId)}${tx?.boardId ? `&board=${tx.boardId}` : ''}`
          : '/?jira=error'
      const nonce = randomBytes(16).toString('base64')
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      )
      response.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Steerloom</title><p><a href="${destination.replaceAll('&', '&amp;')}">Return to Steerloom</a></p><script nonce="${nonce}">location.replace(${JSON.stringify(destination)})</script></html>`,
      )
    },
    accessToken(userId: string, connectionId: string): Promise<string> {
      const key = `${userId}:${connectionId}`
      const running = refreshing.get(key)
      if (running) return running
      const work = async () => {
        const secret = store().connection(userId, connectionId)
        if (secret.jiraEdition !== 'cloud' || !secret.refreshToken || !provider)
          throw new Error('Reconnect Jira Cloud from Workspace.')
        if (secret.token && (secret.expiresAt ?? 0) > Date.now() + 60000)
          return secret.token
        const grant = await provider.refresh(secret.refreshToken)
        // Disconnect/replacement while refreshing must not resurrect or overwrite credentials.
        const current = store().connection(userId, connectionId)
        if (current.refreshToken !== secret.refreshToken)
          throw new Error('Jira connection changed. Try again.')
        store().updateConnectionSecret(userId, connectionId, {
          ...current,
          token: grant.accessToken,
          refreshToken: grant.refreshToken,
          expiresAt: grant.expiresAt,
        })
        return grant.accessToken
      }
      const promise = work().finally(() => refreshing.delete(key))
      refreshing.set(key, promise)
      return promise
    },
  }
}
