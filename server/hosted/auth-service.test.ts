// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { proxyRequest } from './test-request'
import type { StoredSession, SessionPersistence } from './session-store'
import { createHostedAuthServices } from './auth-service'
import type { SupabaseAuthConfig, SupabaseAuthProvider } from './auth-provider'
import { HostedSupabase } from './supabase'

let server: Server
let origin: string
let provider: SupabaseAuthProvider
let service: ReturnType<typeof createHostedAuthServices>
const id = '10000000-0000-4000-8000-000000000001'
const workspace = '20000000-0000-4000-8000-000000000001'
const tokens = () => ({
  accessToken: 'fictional-access-token',
  refreshToken: 'fictional-refresh-token',
  expiresAt: Date.now() + 3600000,
})
beforeEach(async () => {
  const config: SupabaseAuthConfig = {
    origin: '',
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  }
  const database = new HostedSupabase(config)
  vi.spyOn(database, 'identity').mockResolvedValue({
    id,
    email: 'person@example.invalid',
  })
  vi.spyOn(database, 'workspaces').mockResolvedValue([])
  vi.spyOn(database, 'invitations').mockResolvedValue([])
  vi.spyOn(database, 'createWorkspace').mockResolvedValue(workspace)
  vi.spyOn(database, 'acceptInvitation').mockResolvedValue(workspace)
  provider = {
    database,
    authorize: vi.fn(
      (verifier) =>
        `https://fictional.supabase.co/auth/v1/authorize?verifier=${verifier}`,
    ),
    exchange: vi.fn().mockImplementation(async () => tokens()),
    login: vi.fn().mockImplementation(async () => tokens()),
    register: vi.fn().mockResolvedValue(undefined),
    resendConfirmation: vi.fn().mockResolvedValue(undefined),
    recover: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockImplementation(async () => tokens()),
    logout: vi.fn().mockResolvedValue(undefined),
  }
  service = createHostedAuthServices(config, provider)
  server = createServer((req, res) => {
    void service.handle(req, res, () => {
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server')
  origin = `http://127.0.0.1:${address.port}`
  config.origin = origin
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  vi.restoreAllMocks()
})
function post(path: string, body: unknown = {}, cookie = '') {
  return fetch(`${origin}/api/hosted/${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0]!)
    .join('; ')
}
async function login() {
  return cookies(
    await post('auth/login', {
      email: 'person@example.invalid',
      password: 'fictional-password',
    }),
  )
}

it('tells anyone, without signing in, which version is current', async () => {
  const response = await fetch(`${origin}/api/hosted/version`)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('public, max-age=300')
  const release = (await response.json()) as { version: string }
  expect(release.version).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}/)
})

it('gives installed copies an update command without signing in, within a limit', async () => {
  const response = await fetch(`${origin}/api/hosted/update-command`)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const value = (await response.json()) as {
    command: string
    windowsCommand: string
  }
  expect(value.command).toMatch(
    /^curl -fsSL .*\/api\/hosted\/install\.sh\?t=\d{13}\.[\w-]{43}&u=1" \| sh$/,
  )
  expect(value.windowsCommand).toContain('/api/hosted/install.ps1?t=')
  // The link it carries really downloads the installer.
  const token = /t=(\d{13}\.[\w-]{43})/.exec(value.command)![1]!
  const script = await fetch(`${origin}/api/hosted/install.sh?t=${token}&u=1`)
  expect(script.status).toBe(200)
  expect(await script.text()).toContain('replace_app')
  for (let index = 0; index < 29; index++)
    await fetch(`${origin}/api/hosted/update-command`)
  expect((await fetch(`${origin}/api/hosted/update-command`)).status).toBe(429)
})

it('lets anyone fetch the local install command, a limited number of times an hour', async () => {
  // No account: the local version keeps board data on the person's machine.
  const first = await fetch(`${origin}/api/hosted/download/install-command`)
  expect(first.status).toBe(200)
  expect(first.headers.get('Cache-Control')).toBe('no-store')
  for (let index = 0; index < 29; index++)
    await fetch(`${origin}/api/hosted/download/install-command`)
  const limited = await fetch(`${origin}/api/hosted/download/local`)
  expect(limited.status).toBe(429)
})

it('returns lost provider callbacks to the app with a fixed reason', async () => {
  const trello = await fetch(
    `${origin}/api/hosted/trello/callback?state=unknown&code=fictional`,
  )
  expect(trello.headers.get('Content-Type')).toMatch(/text\/html/)
  expect(await trello.text()).toContain('trello=error&trelloReason=session')
  const denied = await fetch(
    `${origin}/api/hosted/trello/callback?state=unknown&error=access_denied`,
  )
  const deniedHtml = await denied.text()
  expect(deniedHtml).toContain('trelloReason=denied')
  expect(deniedHtml).not.toContain('access_denied')
  const jira = await fetch(
    `${origin}/api/hosted/atlassian/callback?state=unknown&code=fictional`,
  )
  expect(await jira.text()).toContain('jira=error')
})

it('keeps provider tokens out of cookies and session JSON', async () => {
  const response = await post('auth/login', {
    email: ' Person@Example.Invalid ',
    password: 'fictional-password',
  })
  expect(response.status).toBe(200)
  expect(provider.login).toHaveBeenCalledWith(
    'person@example.invalid',
    'fictional-password',
  )
  expect(response.headers.get('Set-Cookie')).toMatch(
    /HttpOnly; SameSite=Strict/,
  )
  expect(response.headers.get('Set-Cookie')).not.toContain(
    'fictional-access-token',
  )
  const session = await fetch(`${origin}/api/hosted/session`, {
    headers: { Cookie: cookies(response) },
  })
  const value = await session.json()
  expect(value).toMatchObject({ session: { user: { id } } })
  expect(JSON.stringify(value)).not.toMatch(
    /accessToken|refreshToken|fictional-access-token|password/,
  )
})
it('creates workspaces only using the server session token and ignores supplied identities', async () => {
  const cookie = await login()
  const response = await post(
    'workspaces',
    { name: 'Team', userId: 'forged', role: 'owner', accessToken: 'forged' },
    cookie,
  )
  expect(response.status).toBe(200)
  expect(provider.database.createWorkspace).toHaveBeenCalledWith(
    'fictional-access-token',
    'Team',
  )
  expect((await post('workspaces', { name: 'Team' })).status).toBe(401)
})
it('binds OAuth exchange to the starting browser and consumes transactions once', async () => {
  const start = await post('auth/google')
  const flowCookie = cookies(start)
  const missing = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
  )
  // A failed return opens the sign-in card, where the message shows: a
  // company mail filter may have used the link, and the account is ready.
  expect(await missing.text()).toContain('page=signin&auth=error')
  expect(provider.exchange).not.toHaveBeenCalled()
  const callback = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: flowCookie } },
  )
  expect(await callback.text()).not.toContain('auth=error')
  expect(provider.exchange).toHaveBeenCalledOnce()
  expect(provider.exchange).toHaveBeenCalledWith(
    'fictional',
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  )
  const replay = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: flowCookie } },
  )
  expect(await replay.text()).toContain('auth=error')
  expect(provider.exchange).toHaveBeenCalledOnce()
})
it('rejects OAuth transactions after sign-out', async () => {
  const start = await post('auth/google')
  const flowCookie = cookies(start)
  await post('auth/logout', {}, flowCookie)
  const callback = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: flowCookie } },
  )
  expect(await callback.text()).toContain('auth=error')
  expect(provider.exchange).not.toHaveBeenCalled()
})
it('rejects superseded OAuth transactions and changed initiating sessions', async () => {
  const first = await post('auth/google')
  await post('auth/google', {}, cookies(first))
  const callback = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: cookies(first) } },
  )
  expect(await callback.text()).toContain('auth=error')
  const pending = await post('auth/google')
  const loggedIn = await login()
  const changed = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: `${cookies(pending)}; ${loggedIn}` } },
  )
  expect(await changed.text()).toContain('auth=error')
  expect(provider.exchange).not.toHaveBeenCalled()
})
it('registers without logging in or returning the password or provider response', async () => {
  const response = await post('auth/register', {
    email: 'person@example.invalid',
    password: 'fictional-password',
  })
  expect(response.status).toBe(200)
  expect(provider.register).toHaveBeenCalledWith(
    'person@example.invalid',
    'fictional-password',
    expect.any(String),
  )
  expect(await response.text()).toContain('Check your inbox')
  const session = await fetch(`${origin}/api/hosted/session`, {
    headers: { Cookie: cookies(response) },
  })
  expect(await session.json()).toEqual({ session: null })
  expect(
    (
      await post('auth/register', {
        email: 'person@example.invalid',
        password: 'short',
      })
    ).status,
  ).toBe(400)
})
it('gives the account to whoever opens the sign-up link: their password replaces any set before', async () => {
  // Someone else registered this address first and is waiting. The real
  // owner now signs up in their own browser with their own password.
  const signUp = await post('auth/register', {
    email: 'person@example.invalid',
    password: 'the-owners-own-password',
  })
  const confirmed = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: cookies(signUp) } },
  )
  expect(await confirmed.text()).not.toContain('auth=error')
  // The password typed in this browser is set on the confirmed account.
  expect(provider.updatePassword).toHaveBeenCalledOnce()
  expect(provider.updatePassword).toHaveBeenCalledWith(
    expect.any(String),
    'the-owners-own-password',
  )
  // A Google sign-in has no password to set.
  vi.mocked(provider.updatePassword).mockClear()
  const google = await post('auth/google')
  await fetch(`${origin}/api/hosted/auth/callback?code=fictional`, {
    headers: { Cookie: cookies(google) },
  })
  expect(provider.updatePassword).not.toHaveBeenCalled()
})

it('still signs in when the account service refuses the repeat password', async () => {
  // The usual case: the password is already the one typed, and the service
  // says so with an error.
  vi.mocked(provider.updatePassword).mockRejectedValueOnce(
    new Error('same password'),
  )
  const signUp = await post('auth/register', {
    email: 'person@example.invalid',
    password: 'the-owners-own-password',
  })
  const confirmed = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional`,
    { headers: { Cookie: cookies(signUp) } },
  )
  expect(await confirmed.text()).not.toContain('auth=error')
})

it('resends confirmation links with one answer for every email and a per-email limit', async () => {
  vi.mocked(provider.resendConfirmation).mockRejectedValueOnce(
    new Error('provider detail'),
  )
  const notices = await Promise.all(
    ['first@example.invalid', 'second@example.invalid'].map(async (email) =>
      (await post('auth/resend', { email })).json(),
    ),
  )
  expect(notices[0]).toEqual(notices[1])
  expect(JSON.stringify(notices[0])).not.toContain('provider detail')
  for (let attempt = 0; attempt < 4; attempt += 1)
    await post('auth/resend', { email: 'third@example.invalid' })
  expect(
    vi
      .mocked(provider.resendConfirmation)
      .mock.calls.filter(([email]) => email === 'third@example.invalid'),
  ).toHaveLength(3)
  expect((await post('auth/resend', { email: 'not-an-email' })).status).toBe(
    400,
  )
})
it('gives a one-command install link without an account and refuses forged links', async () => {
  const issued = await fetch(`${origin}/api/hosted/download/install-command`)
  const { command, windowsCommand } = (await issued.json()) as {
    command: string
    windowsCommand: string
  }
  const token = /install\.sh\?t=([^"]+)"/.exec(command)?.[1]
  // Reads the Mac's proxy setting first; Terminal does not follow it.
  expect(command).toMatch(
    /^curl -fsSL \$\(scutil --proxy .+\) ".+\/api\/hosted\/install\.sh\?t=.+" \| sh$/,
  )
  const script = await (
    await fetch(`${origin}/api/hosted/install.sh?t=${token}`)
  ).text()
  expect(script).toContain(`/api/hosted/download/local?t=${token}`)
  const forged = await (
    await fetch(`${origin}/api/hosted/install.sh?t=1999999999999.forged`)
  ).text()
  expect(forged).toContain('expired')
  // PowerShell follows the Windows proxy settings by itself.
  expect(windowsCommand).toBe(
    `irm "${origin}/api/hosted/install.ps1?t=${token}" | iex`,
  )
  const windowsScript = await (
    await fetch(`${origin}/api/hosted/install.ps1?t=${token}`)
  ).text()
  expect(windowsScript).toContain(
    `$SteerloomArchiveUrl = '${origin}/api/hosted/download/local?t=${token}'`,
  )
  const forgedWindows = await (
    await fetch(`${origin}/api/hosted/install.ps1?t=1999999999999.forged`)
  ).text()
  expect(forgedWindows).toContain('expired')
  expect(forgedWindows).not.toContain('Install-Steerloom')
  expect(
    (await fetch(`${origin}/api/hosted/download/local?t=forged`)).status,
  ).toBe(403)
})
it('revokes opaque sessions on logout', async () => {
  const cookie = await login()
  await post('auth/logout', {}, cookie)
  const response = await fetch(`${origin}/api/hosted/session`, {
    headers: { Cookie: cookie },
  })
  expect(await response.json()).toEqual({ session: null })
  expect(provider.logout).toHaveBeenCalledWith('fictional-access-token')
})
it('does not restore a logged-out session when refresh finishes', async () => {
  vi.mocked(provider.login).mockResolvedValue({
    ...tokens(),
    expiresAt: Date.now() - 1,
  })
  const cookie = await login()
  let finish!: (value: ReturnType<typeof tokens>) => void
  vi.mocked(provider.refresh).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = fetch(`${origin}/api/hosted/session`, {
    headers: { Cookie: cookie },
  })
  await vi.waitFor(() => expect(provider.refresh).toHaveBeenCalledOnce())
  await post('auth/logout', {}, cookie)
  finish(tokens())
  expect(await (await pending).json()).toEqual({ session: null })
})
it('rejects cross-origin mutation requests before contacting the provider', async () => {
  const response = await fetch(`${origin}/api/hosted/auth/google`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example.invalid',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  expect(response.status).toBe(403)
  expect(provider.authorize).not.toHaveBeenCalled()
})
it('does not accept local-workspace cookies as hosted authentication', async () => {
  const response = await fetch(`${origin}/api/hosted/session`, {
    headers: { Cookie: `flowlens_session=${'ab'.repeat(32)}` },
  })
  expect(await response.json()).toEqual({ session: null })
})

it('restores persisted sessions across service restart and persists logout', async () => {
  let saved: Array<[string, StoredSession]> = []
  const persistence: SessionPersistence = {
    load: () => structuredClone(saved),
    save: (sessions) => {
      saved = structuredClone(
        Array.from(sessions, ([key, value]) => [
          key,
          { tokens: value.tokens, expires: value.expires },
        ]),
      )
    },
  }
  const config = {
    origin,
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  }
  service = createHostedAuthServices(config, provider, undefined, persistence)
  const cookie = await login()
  expect(saved).toHaveLength(1)
  service = createHostedAuthServices(config, provider, undefined, persistence)
  expect(
    await (
      await fetch(`${origin}/api/hosted/session`, {
        headers: { Cookie: cookie },
      })
    ).json(),
  ).toMatchObject({ session: { user: { id } } })
  await post('auth/logout', {}, cookie)
  service = createHostedAuthServices(config, provider, undefined, persistence)
  expect(
    await (
      await fetch(`${origin}/api/hosted/session`, {
        headers: { Cookie: cookie },
      })
    ).json(),
  ).toEqual({ session: null })
})
it('sets Secure cookies when configured for the production HTTPS origin', async () => {
  const hosted = 'https://app.example.invalid'
  service = createHostedAuthServices(
    {
      origin: hosted,
      supabaseUrl: 'https://fictional.supabase.co',
      publishableKey: 'sb_publishable_fictional',
    },
    provider,
  )
  const response = await proxyRequest(`${origin}/api/hosted/auth/login`, {
    method: 'POST',
    headers: {
      Host: 'app.example.invalid',
      Origin: hosted,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'person@example.invalid',
      password: 'fictional-password',
    }),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('set-cookie')).toContain('; Secure')
})

it('takes feedback from visitors and attaches the account email when signed in', async () => {
  const sent: unknown[] = []
  const sender = {
    emails: true,
    send: vi.fn(async (f: unknown) => void sent.push(f)),
  }
  const config = {
    origin,
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  }
  service = createHostedAuthServices(
    config,
    provider,
    undefined,
    undefined,
    undefined,
    sender,
  )
  const anonymous = await post('feedback', {
    kind: 'idea',
    message: 'Add a sprint view',
    page: '/?hosted=1',
    email: 'visitor@example.invalid',
  })
  expect(anonymous.status).toBe(200)
  expect(sent[0]).toMatchObject({
    kind: 'idea',
    replyTo: 'visitor@example.invalid',
    page: '/?hosted=1',
  })
  const cookie = await login()
  const signed = await post(
    'feedback',
    {
      kind: 'problem',
      message: 'The chart is empty',
      email: 'other@example.invalid',
    },
    cookie,
  )
  expect(signed.status).toBe(200)
  expect(sent[1]).toMatchObject({
    kind: 'problem',
    replyTo: 'person@example.invalid',
  })
  const bad = await post('feedback', { kind: 'idea', message: '' })
  expect(bad.status).toBe(400)
  expect(((await bad.json()) as { error: string }).error).toMatch(/few words/)
})

it('limits feedback per address and refuses it when not set up', async () => {
  const response = await post('feedback', {
    kind: 'idea',
    message: 'hello there',
  })
  expect(response.status).toBe(503)
  const sender = { emails: false, send: vi.fn(async () => {}) }
  const config = {
    origin,
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  }
  service = createHostedAuthServices(
    config,
    provider,
    undefined,
    undefined,
    undefined,
    sender,
  )
  const statuses: number[] = []
  for (let i = 0; i < 13; i++)
    statuses.push(
      (await post('feedback', { kind: 'idea', message: `note ${i}` })).status,
    )
  expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true)
  expect(statuses[12]).toBe(429)
})

it('sends a reset link without revealing whether an account exists', async () => {
  const known = await post('auth/recover', { email: 'person@example.invalid' })
  const unknown = await post('auth/recover', {
    email: 'nobody@example.invalid',
  })
  vi.mocked(provider.recover).mockRejectedValueOnce(new Error('no such user'))
  const failing = await post('auth/recover', { email: 'other@example.invalid' })
  const answers = await Promise.all(
    [known, unknown, failing].map(async (response) => ({
      status: response.status,
      body: (await response.json()) as { notice?: string },
    })),
  )
  expect(new Set(answers.map((answer) => answer.body.notice)).size).toBe(1)
  expect(answers.every((answer) => answer.status === 200)).toBe(true)
  expect(answers[0]!.body.notice).toContain('reset link')
  expect(known.headers.getSetCookie().join(';')).toContain('Max-Age=1800')
  expect(provider.recover).toHaveBeenCalledWith(
    'person@example.invalid',
    expect.any(String),
  )
})

it('returns a reset link to the new-password form, then saves the password', async () => {
  const started = await post('auth/recover', {
    email: 'person@example.invalid',
  })
  const flowCookie = cookies(started)
  const back = await fetch(
    `${origin}/api/hosted/auth/callback?code=fictional-code`,
    {
      headers: { Cookie: flowCookie },
    },
  )
  expect(await back.text()).toContain('/?hosted=1&reset=1')
  const session = cookies(back)
  expect(
    (await post('auth/password', { password: 'short' }, session)).status,
  ).toBe(400)
  const saved = await post(
    'auth/password',
    { password: 'a-new-fictional-password' },
    session,
  )
  expect(saved.status).toBe(200)
  expect(provider.updatePassword).toHaveBeenCalledWith(
    'fictional-access-token',
    'a-new-fictional-password',
  )
  // Without a session there is nothing to change.
  expect(
    (await post('auth/password', { password: 'a-new-fictional-password' }))
      .status,
  ).toBe(401)
})

it('counts reported steps and shows usage only to the people who run the site', async () => {
  const { usageCounter } = await import('./usage')
  const usage = usageCounter()
  const config = {
    origin,
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  }
  service = createHostedAuthServices(
    config,
    provider,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      usage,
      admins: ['owner@example.invalid'],
    },
  )
  expect((await post('event', { step: 'landing_view' })).status).toBe(204)
  expect((await post('event', { step: 'not-a-step' })).status).toBe(204)
  expect((await post('event', { step: 'signed_in' })).status).toBe(204) // server-only
  // The one-click answer to "Was this briefing useful?" is a count too.
  expect((await post('event', { step: 'briefing_useful' })).status).toBe(204)
  expect((await post('event', { step: 'demo_not_useful' })).status).toBe(204)
  const steps = Object.fromEntries(
    usage.report().steps.map((item) => [item.step, item.total]),
  )
  expect(steps.landing_view).toBe(1)
  expect(steps.briefing_useful).toBe(1)
  expect(steps.briefing_not_useful).toBe(0)
  expect(steps.demo_not_useful).toBe(1)
  expect(steps.signed_in).toBe(0)
  const cookie = await login()
  expect(
    usage.report().steps.find((item) => item.step === 'signed_in')?.people,
  ).toBe(0)
  // Not an admin: refused.
  const refused = await fetch(`${origin}/api/hosted/usage`, {
    headers: { Cookie: cookie },
  })
  expect(refused.status).toBe(403)
  vi.mocked(provider.database.identity).mockResolvedValue({
    id,
    email: 'Owner@example.invalid',
  })
  const shown = await fetch(`${origin}/api/hosted/usage`, {
    headers: { Cookie: cookie },
  })
  expect(shown.status).toBe(200)
  const report = (await shown.json()) as {
    steps: Array<{ step: string; total: number }>
  }
  expect(report.steps.find((item) => item.step === 'signed_in')?.total).toBe(1)
})

it('does not touch the session file for an unknown cookie', async () => {
  let saves = 0
  const persistence: SessionPersistence = {
    load: () => [],
    save: () => {
      saves++
    },
  }
  service = createHostedAuthServices(
    {
      origin,
      supabaseUrl: 'https://fictional.supabase.co',
      publishableKey: 'sb_publishable_fictional',
    },
    provider,
    undefined,
    persistence,
  )
  const bogus = `steerloom_hosted_session=${'ab'.repeat(32)}`
  for (let i = 0; i < 5; i++)
    await fetch(`${origin}/api/hosted/session`, { headers: { Cookie: bogus } })
  expect(saves).toBe(0)
})

it('keeps sign-in open when one account opens many sessions', async () => {
  // A token whose subject identifies the account, as Supabase's would.
  const jwt = (sub: string) =>
    `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`
  vi.mocked(provider.login).mockImplementation(async () => ({
    ...tokens(),
    accessToken: jwt(id),
  }))
  const first = await login()
  for (let i = 0; i < 10; i++) await login()
  // The first session was the oldest of eleven: it has gone.
  const session = await fetch(`${origin}/api/hosted/session`, {
    headers: { Cookie: first },
  })
  expect(await session.json()).toEqual({ session: null })
  // Signing in still works.
  expect(
    (
      await post('auth/login', {
        email: 'person@example.invalid',
        password: 'fictional-password',
      })
    ).status,
  ).toBe(200)
})

it('limits sign-in attempts per person, and more loosely on an address everyone shares', async () => {
  const hosted = 'https://app.example.invalid'
  const config = {
    origin: hosted,
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  }
  const start = () =>
    proxyRequest(`${origin}/api/hosted/auth/google`, {
      method: 'POST',
      headers: {
        Host: 'app.example.invalid',
        Origin: hosted,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }).then((response) => response.status)
  const attempt = async (times: number) => {
    const statuses: number[] = []
    for (let i = 0; i < times; i++) statuses.push(await start())
    return statuses
  }
  // The edge names the visitor's own address: 30 attempts in 15 minutes.
  service = createHostedAuthServices(
    config,
    provider,
    undefined,
    undefined,
    () => '198.51.100.7',
  )
  const own = await attempt(31)
  expect(own.slice(0, 30).every((status) => status === 200)).toBe(true)
  expect(own[30]).toBe(429)
  // Only the socket address is known, which may be the hosting proxy that
  // every visitor arrives through: one person's limit would lock all out.
  service = createHostedAuthServices(config, provider)
  expect((await attempt(31)).every((status) => status === 200)).toBe(true)
})

it('caps how many workspaces one account can create', async () => {
  const cookie = await login()
  const create = () => post('workspaces', { name: 'Team' }, cookie)
  // Already in ten: no more, and nothing is created.
  vi.mocked(provider.database.workspaces).mockResolvedValue(
    Array.from({ length: 10 }, (_, index) => ({
      id: `20000000-0000-4000-8000-0000000000${10 + index}`,
      name: `Team ${index}`,
    })),
  )
  const full = await create()
  expect(full.status).toBe(400)
  expect(((await full.json()) as { error: string }).error).toMatch(
    /already in 10 workspaces/,
  )
  expect(provider.database.createWorkspace).not.toHaveBeenCalled()
  // And only a few new ones an hour.
  vi.mocked(provider.database.workspaces).mockResolvedValue([])
  const statuses: number[] = []
  for (let i = 0; i < 5; i++) statuses.push((await create()).status)
  expect(statuses).toEqual([200, 200, 200, 200, 429])
})
