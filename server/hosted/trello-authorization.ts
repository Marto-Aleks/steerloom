import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HostedWorkspaceStore } from './workspace-store'
import type { WorkspaceContext } from './workspace-service'
import type { TrelloProvider } from '../trello/oauth'
import { TrelloClient } from '../trello/client'
import { sendReturnPage } from './return-page'
import { pendingAuthorizations } from '../http/pending-authorizations'

interface Pending {
  verifier: string
  workspaceId: string
  sessionId: string
  board?: string
}
export type TrelloFailure =
  | 'session'
  | 'denied'
  | 'permission'
  | 'exchange'
  | 'boards'
  | 'save'
export function trelloAuthorization(
  store: HostedWorkspaceStore,
  provider: TrelloProvider | null,
  proxy?: string,
) {
  const pending = pendingAuthorizations<Pending>({
    cookie: 'steerloom_workspace_trello',
    path: '/api/hosted',
  })
  const state = (url: URL) => url.searchParams.get('state') ?? ''
  const secure = (url: URL) => url.protocol === 'https:'
  return {
    callbackSessionId(request: IncomingMessage, url: URL) {
      return url.pathname === '/api/hosted/trello/callback'
        ? pending.peek(request, state(url))?.sessionId
        : undefined
    },
    async start(
      context: WorkspaceContext,
      workspaceId: string,
      input: Record<string, unknown>,
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ) {
      if (!provider)
        throw new Error(
          'Trello connection is not available yet. Please try again later.',
        )
      let board: string | undefined
      if (typeof input.link === 'string' && input.link.trim()) {
        let link: URL
        try {
          link = new URL(input.link)
        } catch {
          throw new Error('Paste a valid Trello board link.')
        }
        const match = /^\/b\/([a-zA-Z0-9]{8})(?:\/|$)/.exec(link.pathname)
        if (
          link.origin !== 'https://trello.com' ||
          link.username ||
          link.password ||
          !match
        )
          throw new Error('Paste a valid Trello board link.')
        board = match[1]
      }
      const verifier = randomBytes(32).toString('base64url')
      const started = pending.begin(
        request,
        response,
        { verifier, workspaceId, sessionId: context.sessionId, board },
        {
          secure: secure(url),
          supersedes: (tx) => tx.sessionId === context.sessionId,
        },
      )
      return { url: provider.authorize(started, verifier) }
    },
    async callback(
      context: WorkspaceContext,
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ) {
      const tx = pending.consume(request, response, state(url), secure(url))
      let destination = '/?hosted=1&trello=error'
      let failure: TrelloFailure = 'session'
      try {
        const code = url.searchParams.get('code')
        if (
          !provider ||
          !tx ||
          tx.sessionId !== context.sessionId ||
          !context.valid()
        )
          throw new Error('Invalid authorization.')
        failure = 'denied'
        if (!code || code.length > 2048 || url.searchParams.has('error'))
          throw new Error('Authorization was not granted.')
        failure = 'permission'
        if (
          (await store.session(context.token, tx.workspaceId)).workspaceRole ===
          'member'
        )
          throw new Error('Connection management is not permitted.')
        failure = 'exchange'
        const tokens = await provider.exchange(code, tx.verifier)
        // Verify usable read access before persisting the grant. No board data is saved.
        failure = 'boards'
        await new TrelloClient(
          '',
          '',
          proxy,
          async () => tokens.accessToken,
        ).boards()
        if (!context.valid()) throw new Error('Sign in again.')
        failure = 'save'
        const id = await store.saveConnection(context.token, tx.workspaceId, {
          provider: 'trello',
          name: 'Trello',
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        })
        destination = `/?hosted=1&workspace=${tx.workspaceId}&trello=connected&connection=${id}${tx.board ? `&board=${tx.board}` : ''}`
      } catch {
        // Only a fixed stage is returned; never include OAuth codes or provider errors.
        if (tx && failure !== 'session')
          destination = `/?hosted=1&workspace=${tx.workspaceId}&trello=error`
        destination += `&trelloReason=${failure}`
      }
      sendReturnPage(response, destination)
    },
  }
}
