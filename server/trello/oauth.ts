import { createHash } from 'node:crypto'
import { fetch } from 'undici'
import type { AtlassianTokens } from '../workspace/atlassian'

export const TRELLO_SCOPES = [
  'read:board:trello',
  'read:member:trello',
  'offline_access',
] as const
export interface TrelloProvider {
  authorize(state: string, verifier: string): string
  exchange(code: string, verifier: string): Promise<AtlassianTokens>
  refresh(token: string): Promise<AtlassianTokens>
}
export function loadTrelloProvider(
  env: Record<string, string | undefined>,
  origin: string,
  transport: typeof fetch = fetch,
): TrelloProvider | null {
  const clientId = env.STEERLOOM_TRELLO_CLIENT_ID?.trim()
  const secret = env.STEERLOOM_TRELLO_CLIENT_SECRET?.trim()
  if (!clientId || !secret) return null
  const callback = `${origin}/api/hosted/trello/callback`
  async function tokens(
    body: Record<string, string>,
  ): Promise<AtlassianTokens> {
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await transport('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          client_id: clientId,
          client_secret: secret,
        }),
      })
    } catch {
      throw new Error('Could not reach Trello authorization. Try again.')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(
        'Trello authorization expired or was revoked. Connect again.',
      )
    }
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object')
      throw new Error('Invalid Trello authorization response.')
    const token = value as Record<string, unknown>
    for (const name of ['access_token', 'refresh_token']) {
      const field = token[name]
      if (
        typeof field !== 'string' ||
        !field ||
        field.length > 16384 ||
        /[\r\n]/.test(field)
      )
        throw new Error('Invalid Trello authorization response.')
    }
    if (
      typeof token.expires_in !== 'number' ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0 ||
      token.expires_in > 86400
    )
      throw new Error('Invalid Trello authorization response.')
    return {
      accessToken: token.access_token as string,
      refreshToken: token.refresh_token as string,
      expiresAt: Date.now() + token.expires_in * 1000,
    }
  }
  return {
    authorize(state, verifier) {
      const url = new URL('https://auth.atlassian.com/authorize')
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback,
        scope: TRELLO_SCOPES.join(' '),
        response_type: 'code',
        prompt: 'consent',
        state,
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString()
      return url.href
    },
    exchange: (code, verifier) =>
      tokens({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: callback,
      }),
    refresh: (token) =>
      tokens({ grant_type: 'refresh_token', refresh_token: token }),
  }
}
