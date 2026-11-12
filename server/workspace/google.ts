import { ProxyAgent, fetch as proxyFetch } from 'undici'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { localEnvironment } from '../http/local-env'
import * as oidc from 'openid-client'
import type { WorkspaceStore } from './store'
import { readSecretCookie } from '../http/cookies'
import { pendingAuthorizations } from '../http/pending-authorizations'
import { attemptLimiter } from '../http/rate-limit'

export interface GoogleIdentity {
  subject: string
  email: string
}
export interface GoogleTransaction {
  state: string
  nonce: string
  verifier: string
  userId?: string
  sessionToken?: string
}
export interface GoogleProvider {
  redirectUri: URL
  authorize(transaction: GoogleTransaction): Promise<URL>
  verify(url: URL, transaction: GoogleTransaction): Promise<GoogleIdentity>
}
export function googleIdentity(
  claims: Record<string, unknown>,
): GoogleIdentity {
  if (
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.sub.length > 255 ||
    typeof claims.email !== 'string' ||
    claims.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
    claims.email_verified !== true
  )
    throw new Error('Verified Google identity required.')
  return { subject: claims.sub, email: claims.email }
}
export function loadGoogleProvider(
  env: Record<string, string> = localEnvironment(),
  transport?: typeof fetch,
): GoogleProvider | null {
  const clientId = env.STEERLOOM_GOOGLE_CLIENT_ID
  const secret = env.STEERLOOM_GOOGLE_CLIENT_SECRET
  if (!clientId || !secret) return null
  let redirectUri: URL
  try {
    redirectUri = new URL(
      env.STEERLOOM_GOOGLE_REDIRECT_URI ||
        'http://127.0.0.1:5173/api/auth/google/callback',
    )
  } catch {
    return null
  }
  if (
    redirectUri.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(redirectUri.hostname) ||
    redirectUri.pathname !== '/api/auth/google/callback' ||
    redirectUri.search ||
    redirectUri.hash ||
    redirectUri.username ||
    redirectUri.password
  )
    return null
  const configuration = new oidc.Configuration(
    {
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    },
    clientId,
    secret,
    oidc.ClientSecretPost(secret),
  )
  // The code-flow library validates claims; also require cryptographic ID-token verification.
  oidc.enableNonRepudiationChecks(configuration)
  configuration.timeout = 15
  if (transport) configuration[oidc.customFetch] = transport
  else if (env.STEERLOOM_GOOGLE_PROXY?.trim()) {
    try {
      const proxy = new URL(env.STEERLOOM_GOOGLE_PROXY.trim())
      if (!['http:', 'https:'].includes(proxy.protocol)) return null
      const dispatcher = new ProxyAgent(proxy.href)
      configuration[oidc.customFetch] = async (input, init) => {
        const response = await proxyFetch(input, { ...init, dispatcher })
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
        })
      }
    } catch {
      return null
    }
  }
  return {
    redirectUri,
    async authorize(tx) {
      return oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: redirectUri.href,
        scope: 'openid email',
        response_type: 'code',
        state: tx.state,
        nonce: tx.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
        code_challenge_method: 'S256',
        ...(tx.userId ? { prompt: 'select_account' } : {}),
      })
    },
    async verify(url, tx) {
      const tokens = await oidc.authorizationCodeGrant(configuration, url, {
        pkceCodeVerifier: tx.verifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      if (!claims) throw new Error('Missing Google identity.')
      return googleIdentity(claims)
    },
  }
}

export function googleAuthFlow(
  provider: GoogleProvider | null,
  store: () => WorkspaceStore,
  liveSession: (token?: string) => string | undefined,
  issueSession: (
    id: string,
    response: ServerResponse,
    oldToken?: string,
  ) => void,
) {
  const pending = pendingAuthorizations<GoogleTransaction>({
    cookie: 'steerloom_google',
    path: '/api/auth/google',
    busyMessage: 'Too many Google sign-in attempts. Try again later.',
  })
  const attempts = attemptLimiter({ capacity: 1000 })
  return {
    configured: Boolean(provider),
    async start(
      request: IncomingMessage,
      response: ServerResponse,
      link: boolean,
    ) {
      if (
        !provider ||
        new URL(provider.redirectUri).origin !==
          `http://${request.headers.host}`
      )
        throw new Error('Google sign-in is not configured for this address.')
      // Starts must be a deliberate same-origin POST, including for anonymous login.
      if (request.headers.origin !== provider.redirectUri.origin)
        throw new Error('Open Google sign-in from this application.')
      const token = readSecretCookie(request, 'flowlens_session')
      const userId = liveSession(token)
      if (link && !userId) throw new Error('Sign in before linking Google.')
      if (!link && userId)
        throw new Error('Use Link Google from your workspace.')
      if (!attempts.hit(request.socket.remoteAddress ?? 'local', 20))
        throw new Error('Too many Google sign-in attempts. Try again later.')
      const tx: GoogleTransaction = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        verifier: oidc.randomPKCECodeVerifier(),
        ...(link ? { userId, sessionToken: token } : {}),
      }
      const url = await provider.authorize(tx)
      pending.begin(request, response, tx, { secure: false, state: tx.state })
      return { url: url.href }
    },
    async callback(
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ) {
      response.setHeader('Referrer-Policy', 'no-referrer')
      // Consumed before any asynchronous provider call; replay is impossible.
      const tx = pending.consume(
        request,
        response,
        url.searchParams.get('state') ?? '',
        false,
      )
      try {
        if (!provider || url.origin !== provider.redirectUri.origin || !tx)
          throw new Error('Invalid Google sign-in attempt.')
        if (tx.userId && liveSession(tx.sessionToken) !== tx.userId)
          throw new Error('Linking session expired.')
        const current = liveSession(
          readSecretCookie(request, 'flowlens_session'),
        )
        if (current && current !== tx.userId)
          throw new Error('Account changed during sign-in.')
        const identity = await provider.verify(url, tx)
        // Recheck after the network call in case the user signed out during verification.
        if (tx.userId && liveSession(tx.sessionToken) !== tx.userId)
          throw new Error('Linking session expired.')
        const id =
          tx.userId ?? store().signInGoogle(identity.subject, identity.email)
        if (tx.userId) store().linkGoogle(id, identity.subject, identity.email)
        issueSession(id, response, tx.sessionToken)
        // Commit a same-origin document before navigating: Strict session cookies do
        // not reliably accompany an immediate redirect chain from accounts.google.com.
        const nonce = randomBytes(16).toString('base64')
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.setHeader('Referrer-Policy', 'no-referrer')
        response.setHeader(
          'Content-Security-Policy',
          `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        )
        response.end(
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>Steerloom</title><p>Signed in. <a href="/">Continue to your workspace</a></p><script nonce="${nonce}">location.replace('/')</script></html>`,
        )
      } catch {
        response.statusCode = 303
        response.setHeader('Location', '/?google=error')
        response.end()
      }
    },
  }
}
