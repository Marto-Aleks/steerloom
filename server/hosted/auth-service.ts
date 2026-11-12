import type { SessionPersistence } from './session-store'
import type { createHostedWorkspaceServices } from './workspace-service'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import {
  createVerifier,
  type SupabaseAuthConfig,
  type SupabaseAuthProvider,
  type SupabaseTokens,
} from './auth-provider'
import { sendReturnPage } from './return-page'
import {
  EXPIRED_POWERSHELL_SCRIPT,
  installLinks,
  installPowerShellScript,
  installScript,
  unixInstallCommand,
} from './install-command'
import { appendCookie, readSecretCookie } from '../http/cookies'
import { attemptLimiter } from '../http/rate-limit'
import { publicMessage } from '../http/public-error'
import { RELEASE } from '../http/release'
import { clientAddress, type ClientAddress } from '../http/client-address'
import { parseFeedback, type FeedbackSender } from './feedback'
import {
  accountIdFromToken,
  CLIENT_STEPS,
  usageSource,
  type UsageCounter,
  type UsageStep,
} from './usage'

const SESSION = 'steerloom_hosted_session'
const FLOW = 'steerloom_hosted_flow'
const lifetime = 8 * 60 * 60 * 1000
interface Session {
  tokens: SupabaseTokens
  expires: number
  refreshing?: Promise<void>
}
interface Flow {
  verifier: string
  expires: number
  sessionCookie?: string
  /** A password reset: the return lands on "Choose a new password". */
  purpose?: 'recovery'
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  seconds: number,
  secure: boolean,
) {
  // The OAuth flow cookie must survive the cross-site return; sessions stay Strict.
  appendCookie(response, name, value, {
    path: '/api/hosted',
    sameSite: name === FLOW ? 'Lax' : 'Strict',
    maxAge: seconds,
    secure,
  })
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}
/** The same limit as the local server: a dashboard with long lists passes 8 KB. */
const BODY_LIMIT = 32 * 1024

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []
  let size = 0
  for await (const part of request as AsyncIterable<Buffer | string>) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part)
    if ((size += bytes.length) > BODY_LIMIT)
      throw new Error('Request is too large.')
    parts.push(bytes)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch {
    throw new Error('Send a valid request.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Send a valid request.')
  return value as Record<string, unknown>
}
function returnToApp(
  response: ServerResponse,
  failed: boolean,
  recovery = false,
) {
  const nonce = randomBytes(16).toString('base64')
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
  )
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  // A same-origin document makes Strict cookies available after OAuth navigation.
  response.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Steerloom sign-in</title><script nonce="${nonce}">location.replace('/?hosted=1${failed ? '&page=signin&auth=error' : recovery ? '&reset=1' : ''}')</script><p>Returning to Steerloom… <a href="/?hosted=1">Continue</a></p></html>`,
  )
}
export function createHostedAuthServices(
  config: SupabaseAuthConfig | null,
  provider: SupabaseAuthProvider | null,
  workspaceServices?: ReturnType<typeof createHostedWorkspaceServices>,
  persistence?: SessionPersistence,
  addressOf: ClientAddress = clientAddress(),
  feedback?: FeedbackSender,
  extras: {
    usage?: UsageCounter
    /** Emails that may read the usage counts. */
    admins?: string[]
  } = {},
) {
  const { usage, admins = [] } = extras
  const eventAttempts = attemptLimiter({
    windowMs: 60 * 60_000,
    capacity: 5000,
  })
  const sessions = new Map<string, Session>(persistence?.load())
  const persist = () => persistence?.save(sessions)
  const secure = () => config?.origin.startsWith('https:') === true
  // Write the session file only when something was actually removed: an
  // unknown cookie must not cost a disk write per request.
  const revoke = (key: string) => {
    if (sessions.delete(key)) persist()
  }
  /** At most this many live sessions per account; the oldest goes first. */
  const SESSIONS_PER_ACCOUNT = 10
  const evictOldest = (keys: Iterable<string>) => {
    let oldest: { key: string; expires: number } | undefined
    for (const key of keys) {
      const value = sessions.get(key)
      if (value && (!oldest || value.expires < oldest.expires))
        oldest = { key, expires: value.expires }
    }
    if (oldest) sessions.delete(oldest.key)
  }
  const flows = new Map<string, Flow>()
  /**
   * Sign-ins waiting for their return (Google, an emailed link). Well above
   * what one address may start in 30 minutes, so one visitor cannot push
   * everyone else's pending sign-in out.
   */
  const PENDING_SIGN_INS = 2000
  const attempts = attemptLimiter({ capacity: 5000 })
  const feedbackAttempts = attemptLimiter({
    windowMs: 60 * 60_000,
    capacity: 5000,
  })
  const WORKSPACES_PER_ACCOUNT = 10
  const NEW_WORKSPACES_AN_HOUR = 5
  const workspaceAttempts = attemptLimiter({ windowMs: 60 * 60_000 })
  const installs = installLinks()
  // Installed copies asking for an update command: a few per address an hour.
  const updateAttempts = attemptLimiter({
    windowMs: 60 * 60_000,
    capacity: 5000,
  })
  // The local version needs no account: install commands and package
  // downloads are limited per address instead.
  const localAttempts = attemptLimiter({
    windowMs: 60 * 60_000,
    capacity: 5000,
  })
  const sendArchive = async (response: ServerResponse) => {
    const archive = await readFile(
      resolve('dist', 'downloads', 'steerloom-local.tar.gz'),
    ).catch(() => null)
    if (!archive) {
      json(response, 503, { error: 'Local package is unavailable.' })
      return
    }
    response.setHeader('Content-Type', 'application/gzip')
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="steerloom-local.tar.gz"',
    )
    response.setHeader('Cache-Control', 'no-store')
    response.end(archive)
  }
  const prune = () => {
    let removed = false
    for (const [key, value] of sessions)
      if (value.expires <= Date.now()) removed = sessions.delete(key) || removed
    if (removed) persist()
    for (const [key, value] of flows)
      if (value.expires <= Date.now()) flows.delete(key)
  }
  function startFlow(
    request: IncomingMessage,
    response: ServerResponse,
    purpose?: Flow['purpose'],
  ): Flow {
    prune()
    // Email links are often opened a while later, or after a company mail
    // filter has already followed them once.
    const minutes = 30
    const old = readSecretCookie(request, FLOW)
    if (old) flows.delete(hash(old))
    // Full: the oldest pending sign-in gives way rather than refusing everyone.
    if (flows.size >= PENDING_SIGN_INS) {
      let oldest: { key: string; expires: number } | undefined
      for (const [key, value] of flows)
        if (!oldest || value.expires < oldest.expires)
          oldest = { key, expires: value.expires }
      if (oldest) flows.delete(oldest.key)
    }
    const key = randomBytes(32).toString('hex')
    const flow: Flow = {
      verifier: createVerifier(),
      expires: Date.now() + minutes * 60 * 1000,
      sessionCookie: readSecretCookie(request, SESSION),
      ...(purpose ? { purpose } : {}),
    }
    flows.set(hash(key), flow)
    setCookie(response, FLOW, key, minutes * 60, secure())
    return flow
  }
  async function issue(
    request: IncomingMessage,
    response: ServerResponse,
    tokens: SupabaseTokens,
  ) {
    await provider!.database.identity(tokens.accessToken)
    usage?.count('signed_in', accountIdFromToken(tokens.accessToken))
    prune()
    const old = readSecretCookie(request, SESSION)
    if (old) sessions.delete(hash(old))
    // One account signing in many times must not lock everyone else out:
    // its oldest session goes, then the oldest overall if still full.
    const account = accountIdFromToken(tokens.accessToken)
    const own = [...sessions]
      .filter(
        ([, value]) => accountIdFromToken(value.tokens.accessToken) === account,
      )
      .map(([key]) => key)
    if (account && own.length >= SESSIONS_PER_ACCOUNT) evictOldest(own)
    if (sessions.size >= 1000) evictOldest(sessions.keys())
    const key = randomBytes(32).toString('hex')
    sessions.set(hash(key), { tokens, expires: Date.now() + lifetime })
    persist()
    setCookie(response, SESSION, key, lifetime / 1000, secure())
  }
  async function active(
    request: IncomingMessage,
    callbackKey?: string,
  ): Promise<Session | undefined> {
    const raw = readSecretCookie(request, SESSION)
    const key = raw ? hash(raw) : callbackKey
    const session = key ? sessions.get(key) : undefined
    if (!session || session.expires <= Date.now()) {
      if (key) revoke(key)
      return undefined
    }
    if (session.tokens.expiresAt <= Date.now() + 60000) {
      session.refreshing ??= (async () => {
        const tokens = await provider!.refresh(session.tokens.refreshToken)
        if (sessions.get(key!) === session) {
          session.tokens = tokens
          persist()
        }
      })().finally(() => {
        session.refreshing = undefined
      })
      try {
        await session.refreshing
      } catch {
        revoke(key!)
        return undefined
      }
    }
    // A concurrent logout must not resurrect a session after refresh.
    return sessions.get(key!) === session ? session : undefined
  }
  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!(request.url ?? '').startsWith('/api/hosted/')) {
      next()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const origin = config?.origin ?? 'http://127.0.0.1:5173'
    if (
      !request.url?.startsWith('/') ||
      request.url.startsWith('//') ||
      request.url.includes('\\') ||
      /[\r\n]/.test(request.url)
    ) {
      json(response, 400, { error: 'Invalid request path.' })
      return
    }
    const url = new URL(request.url, origin)
    const callback =
      url.pathname === '/api/hosted/auth/callback' && request.method === 'GET'
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin) ||
      (request.method !== 'GET' && request.headers.origin !== origin) ||
      (!callback &&
        url.pathname !== '/api/hosted/atlassian/callback' &&
        url.pathname !== '/api/hosted/trello/callback' &&
        request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      json(response, 403, {
        error: `Open ${origin} to use this account.`,
      })
      return
    }
    if (url.pathname === '/api/hosted/config' && request.method === 'GET') {
      json(response, 200, {
        configured: !!config && !!provider,
        callbackUrl: `${origin}/api/hosted/auth/callback`,
      })
      return
    }
    if (!config || !provider) {
      json(response, 503, {
        error:
          'Add the Supabase project URL and publishable key to .env.local, then restart the app.',
      })
      return
    }
    if (
      request.method !== 'GET' &&
      (!['POST', 'PUT', 'DELETE'].includes(request.method ?? '') ||
        request.headers['content-type']?.split(';')[0] !== 'application/json')
    ) {
      json(response, 405, { error: 'Use a JSON POST request.' })
      return
    }
    try {
      if (callback) {
        prune()
        const raw = readSecretCookie(request, FLOW)
        const flow = raw ? flows.get(hash(raw)) : undefined
        if (raw) flows.delete(hash(raw))
        setCookie(response, FLOW, '', 0, secure())
        try {
          const code = url.searchParams.get('code')
          if (
            !flow ||
            flow.expires <= Date.now() ||
            flow.sessionCookie !== readSecretCookie(request, SESSION) ||
            url.searchParams.has('error') ||
            !code ||
            code.length > 2048
          )
            throw new Error('Invalid sign-in return.')
          await issue(
            request,
            response,
            await provider.exchange(code, flow.verifier),
          )
          returnToApp(response, false, flow.purpose === 'recovery')
        } catch {
          returnToApp(response, true)
        }
        return
      }
      if (
        url.pathname === '/api/hosted/auth/logout' &&
        request.method === 'POST'
      ) {
        const key = readSecretCookie(request, SESSION)
        const session = key ? sessions.get(hash(key)) : undefined
        if (key) revoke(hash(key))
        const flow = readSecretCookie(request, FLOW)
        if (flow) flows.delete(hash(flow))
        setCookie(response, SESSION, '', 0, secure())
        setCookie(response, FLOW, '', 0, secure())
        if (session)
          try {
            await provider.logout(session.tokens.accessToken)
          } catch {
            /* Local session is already revoked. */
          }
        json(response, 200, { ok: true })
        return
      }
      if (
        [
          '/api/hosted/auth/google',
          '/api/hosted/auth/login',
          '/api/hosted/auth/register',
          '/api/hosted/auth/resend',
          '/api/hosted/auth/recover',
        ].includes(url.pathname) &&
        request.method === 'POST'
      ) {
        prune()
        const address = addressOf(request)
        // An address read from the edge header is one person's network. The
        // socket address may be the hosting proxy, shared by everyone, so it
        // keeps a limit that all visitors together stay under.
        const shared = secure() && address === request.socket.remoteAddress
        if (!attempts.hit(address, shared ? 200 : 30)) {
          json(response, 429, {
            error: 'Too many attempts. Try again in 15 minutes.',
          })
          return
        }
        if (url.pathname.endsWith('/google')) {
          const flow = startFlow(request, response)
          json(response, 200, { url: provider.authorize(flow.verifier) })
          return
        }
        const input = await body(request)
        const email =
          typeof input.email === 'string'
            ? input.email.trim().toLowerCase()
            : ''
        if (url.pathname.endsWith('/recover')) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
            throw new Error('Enter your email address.')
          // Same answer whether or not an account exists, so the form cannot
          // be used to discover who has signed up.
          if (attempts.hit(`recover:${hash(email)}`, 3)) {
            const flow = startFlow(request, response, 'recovery')
            await provider.recover(email, flow.verifier).catch(() => undefined)
          }
          json(response, 200, {
            notice:
              'If an account uses this email, a reset link is on its way. Open it in this browser within 30 minutes. Check spam or quarantine if it does not arrive.',
          })
          return
        }
        if (url.pathname.endsWith('/resend')) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
            throw new Error('Enter your email address.')
          // Same answer whether or not an unconfirmed account exists, so the
          // form cannot be used to discover who has signed up.
          if (attempts.hit(`resend:${hash(email)}`, 3)) {
            const flow = startFlow(request, response)
            await provider
              .resendConfirmation(email, flow.verifier)
              .catch(() => undefined)
          }
          json(response, 200, {
            notice:
              'If this email has an unconfirmed account, a new confirmation link is on its way. Open it in this browser within 30 minutes, then sign in. Check spam or quarantine if it does not arrive.',
          })
          return
        }
        const password =
          typeof input.password === 'string' ? input.password : ''
        const register = url.pathname.endsWith('/register')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
          throw new Error('Enter your email address.')
        if (password.length < (register ? 12 : 1) || password.length > 128)
          throw new Error(
            register
              ? 'Use a password of 12–128 characters.'
              : 'Enter your password.',
          )
        const emailKey = `email:${hash(email)}`
        if (!attempts.hit(emailKey, 20)) {
          json(response, 429, {
            error: 'Too many attempts. Try again in 15 minutes.',
          })
          return
        }
        if (register) {
          const flow = startFlow(request, response)
          await provider.register(email, password, flow.verifier)
          json(response, 200, {
            notice:
              'Check your inbox to confirm your email. Open the link in this browser within 30 minutes, then sign in if needed.',
          })
        } else {
          await issue(request, response, await provider.login(email, password))
          attempts.reset(emailKey)
          json(response, 200, { ok: true })
        }
        return
      }
      // One-command install: a short-lived signed link stands in for the
      // session cookie, which a terminal does not have.
      if (
        (url.pathname === '/api/hosted/install.sh' ||
          url.pathname === '/api/hosted/install.ps1' ||
          (url.pathname === '/api/hosted/download/local' &&
            url.searchParams.has('t'))) &&
        request.method === 'GET'
      ) {
        const linkToken = url.searchParams.get('t')
        // One install = one script fetch (the package download follows it);
        // the command from an installed copy counts as an update.
        if (
          installs.valid(linkToken) &&
          !url.pathname.endsWith('/download/local')
        )
          usage?.count(
            url.searchParams.get('u') === '1'
              ? 'update_started'
              : 'install_started',
          )
        if (url.pathname.endsWith('/install.sh')) {
          response.setHeader(
            'Content-Type',
            'text/x-shellscript; charset=utf-8',
          )
          response.setHeader('Cache-Control', 'no-store')
          response.end(
            installs.valid(linkToken) && config
              ? installScript(
                  `${config.origin}/api/hosted/download/local?t=${linkToken}`,
                )
              : "#!/bin/sh\necho 'This Steerloom install command has expired. Copy a fresh one from the Steerloom page.' >&2\nexit 1\n",
          )
          return
        }
        if (url.pathname.endsWith('/install.ps1')) {
          response.setHeader('Content-Type', 'text/plain; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(
            installs.valid(linkToken) && config
              ? installPowerShellScript(
                  `${config.origin}/api/hosted/download/local?t=${linkToken}`,
                )
              : EXPIRED_POWERSHELL_SCRIPT,
          )
          return
        }
        if (!installs.valid(linkToken)) {
          json(response, 403, {
            error: 'This download link has expired. Copy a fresh command.',
          })
          return
        }
        await sendArchive(response)
        return
      }
      // The current release, for installed copies deciding whether to offer
      // an update. Public and anonymous: the request carries nothing.
      if (url.pathname === '/api/hosted/version' && request.method === 'GET') {
        response.setHeader('Cache-Control', 'public, max-age=300')
        json(response, 200, RELEASE)
        return
      }
      // The command that updates an installed copy, shown in the app's
      // update sheet. No account needed: the person already has Steerloom.
      if (
        url.pathname === '/api/hosted/update-command' &&
        request.method === 'GET'
      ) {
        if (!config || !updateAttempts.hit(addressOf(request), 30)) {
          json(response, 429, { error: 'Try again in a little while.' })
          return
        }
        const link = installs.issue()
        response.setHeader('Cache-Control', 'no-store')
        json(response, 200, {
          command: unixInstallCommand(config.origin, link.token, true),
          windowsCommand: `irm "${config.origin}/api/hosted/install.ps1?t=${link.token}&u=1" | iex`,
          expiresAt: new Date(link.expiresAt).toISOString(),
        })
        return
      }
      // Steps the browser reports (landing, demo, film, briefing, and the
      // one-click answer to "Was this useful?"). Counts only.
      if (url.pathname === '/api/hosted/event' && request.method === 'POST') {
        const event = await body(request)
        const step = event.step
        if (
          usage &&
          typeof step === 'string' &&
          CLIENT_STEPS.has(step) &&
          eventAttempts.hit(addressOf(request), 120)
        ) {
          const signedIn = await active(request)
          usage.count(
            step as UsageStep,
            signedIn
              ? accountIdFromToken(signedIn.tokens.accessToken)
              : undefined,
            usageSource(event.source),
          )
        }
        response.statusCode = 204
        response.end()
        return
      }
      // Feedback works signed in or not (demo visitors), limited per address.
      if (
        url.pathname === '/api/hosted/feedback' &&
        request.method === 'POST'
      ) {
        if (!feedback) {
          json(response, 503, {
            error: 'Feedback is not set up on this server.',
          })
          return
        }
        if (!feedbackAttempts.hit(addressOf(request), 12)) {
          json(response, 429, {
            error:
              'That is a lot of feedback. Thank you! Try again in an hour.',
          })
          return
        }
        const signedIn = await active(request)
        const account = signedIn
          ? (await provider.database.identity(signedIn.tokens.accessToken))
              .email
          : undefined
        const parsed = parseFeedback(await body(request), account ?? undefined)
        usage?.count(
          'feedback_sent',
          signedIn
            ? accountIdFromToken(signedIn.tokens.accessToken)
            : undefined,
        )
        const agent = request.headers['user-agent']?.slice(0, 200)
        await feedback.send({ ...parsed, ...(agent ? { agent } : {}) })
        json(response, 200, { ok: true })
        return
      }
      // The local version, without an account: the install command (a
      // 30-minute link) and the package for step-by-step installs.
      if (
        (url.pathname === '/api/hosted/download/install-command' ||
          url.pathname === '/api/hosted/download/local') &&
        request.method === 'GET'
      ) {
        if (!config || !localAttempts.hit(addressOf(request), 30)) {
          json(response, 429, {
            error: 'Too many downloads from here. Try again in an hour.',
          })
          return
        }
        if (url.pathname.endsWith('/local')) {
          await sendArchive(response)
          return
        }
        const link = installs.issue()
        response.setHeader('Cache-Control', 'no-store')
        json(response, 200, {
          command: unixInstallCommand(config.origin, link.token),
          windowsCommand: `irm "${config.origin}/api/hosted/install.ps1?t=${link.token}" | iex`,
          expiresAt: new Date(link.expiresAt).toISOString(),
        })
        return
      }
      const callbackKey = workspaceServices?.callbackSessionId(request, url)
      const session = await active(request, callbackKey)
      if (!session) {
        // Lost or expired attempts (restart, deploy, other browser) return to
        // the app with a fixed reason instead of a bare JSON error page.
        if (url.pathname === '/api/hosted/trello/callback') {
          sendReturnPage(
            response,
            `/?hosted=1&trello=error&trelloReason=${url.searchParams.has('error') ? 'denied' : 'session'}`,
          )
          return
        }
        if (url.pathname === '/api/hosted/atlassian/callback') {
          sendReturnPage(response, '/?hosted=1&jira=error')
          return
        }
        json(
          response,
          url.pathname === '/api/hosted/session' ? 200 : 401,
          url.pathname === '/api/hosted/session'
            ? { session: null }
            : { error: 'Sign in to continue.' },
        )
        return
      }
      const token = session.tokens.accessToken
      if (
        url.pathname.startsWith('/api/hosted/workspaces/') ||
        url.pathname === '/api/hosted/atlassian/callback' ||
        url.pathname === '/api/hosted/trello/callback'
      ) {
        if (!workspaceServices) {
          json(response, 503, {
            error:
              'Configure the server Supabase secret key to open workspaces.',
          })
          return
        }
        const raw = readSecretCookie(request, SESSION)
        const sessionKey = raw ? hash(raw) : callbackKey!
        const handled = await workspaceServices.handle(
          {
            token,
            sessionId: sessionKey,
            valid: () =>
              sessions.get(sessionKey) === session &&
              session.expires > Date.now(),
          },
          request,
          response,
          url,
          () => body(request),
        )
        if (handled) return
      }
      if (
        url.pathname === '/api/hosted/workspaces' &&
        request.method === 'POST'
      ) {
        const input = await body(request)
        if (typeof input.name !== 'string')
          throw new Error('Enter a workspace name.')
        // Anyone can sign up: one account cannot fill the database.
        if (
          !workspaceAttempts.hit(
            accountIdFromToken(token) ?? hash(token),
            NEW_WORKSPACES_AN_HOUR,
          )
        ) {
          json(response, 429, {
            error:
              'Too many new workspaces in an hour. Try again in a little while.',
          })
          return
        }
        if (
          (await provider.database.workspaces(token)).length >=
          WORKSPACES_PER_ACCOUNT
        )
          throw new Error(
            `This account is already in ${WORKSPACES_PER_ACCOUNT} workspaces, the most allowed. Open one of them instead.`,
          )
        const id = await provider.database.createWorkspace(token, input.name)
        usage?.count('workspace_created', accountIdFromToken(token))
        json(response, 200, { id })
        return
      }
      if (
        url.pathname === '/api/hosted/invitations/accept' &&
        request.method === 'POST'
      ) {
        const input = await body(request)
        if (typeof input.id !== 'string')
          throw new Error('Choose an invitation.')
        const id = await provider.database.acceptInvitation(token, input.id)
        json(response, 200, { id })
        return
      }
      if (
        url.pathname === '/api/hosted/auth/password' &&
        request.method === 'POST'
      ) {
        const input = await body(request)
        const password =
          typeof input.password === 'string' ? input.password : ''
        if (password.length < 12 || password.length > 128)
          throw new Error('Use a password of 12–128 characters.')
        await provider.updatePassword(token, password)
        json(response, 200, { ok: true })
        return
      }
      if (url.pathname === '/api/hosted/usage' && request.method === 'GET') {
        const { email } = await provider.database.identity(token)
        if (!usage || !admins.includes(email.trim().toLowerCase())) {
          json(response, 403, {
            error: 'Only the people who run this site can see usage.',
          })
          return
        }
        json(response, 200, usage.report())
        return
      }
      if (url.pathname === '/api/hosted/session' && request.method === 'GET') {
        const identity = await provider.database.identity(token)
        const workspaces = await provider.database.workspaces(token)
        const invitations = await provider.database.invitations(token)
        // Never include access/refresh/provider tokens or the local workspace.
        json(response, 200, {
          session: { user: identity, workspaces, invitations },
        })
        return
      }
      json(response, 404, { error: 'Account route not found.' })
    } catch (caught) {
      const reason = (caught as { reason?: unknown } | null)?.reason
      json(response, 400, {
        error: publicMessage(
          caught,
          'Could not complete the account request. Try again.',
        ),
        // A machine-readable reason the form can act on (e.g. ask for a model).
        ...(typeof reason === 'string' && /^[a-z-]{3,40}$/.test(reason)
          ? { reason }
          : {}),
      })
    }
  }
  const plugin: Plugin = {
    name: 'steerloom-supabase-account-test',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next).catch(() =>
          json(res, 500, { error: 'Account request failed.' }),
        )
      })
    },
  }
  return { handle, plugin }
}
