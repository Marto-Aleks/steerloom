import type { WorkspaceSession } from '../../src/lib/workspace/model'
// @vitest-environment node
import { generateKeyPairSync, createSign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceServices } from './vite-plugin'
import {
  googleIdentity,
  loadGoogleProvider,
  type GoogleProvider,
  type GoogleTransaction,
} from './google'

let origin: string
let directory: string
let server: Server
let transactions: GoogleTransaction[]
let browsers: string[]
let subject: string
let rejectProvider: boolean
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'steerloom-google-'))
  transactions = []
  browsers = []
  subject = 'fictional-google-subject'
  rejectProvider = false
  const provider: GoogleProvider = {
    get redirectUri() {
      return new URL(`${origin}/api/auth/google/callback`)
    },
    async authorize(tx) {
      transactions.push(tx)
      return new URL(
        `https://accounts.google.com/o/oauth2/v2/auth?state=${tx.state}`,
      )
    },
    async verify() {
      if (rejectProvider)
        throw new Error('Provider response with fictional-sensitive-data')
      return { subject, email: 'person@example.invalid' }
    },
  }
  const services = createWorkspaceServices(directory, '', provider)
  server = createServer(
    (req, res) =>
      void services.handle(req, res, () => {
        res.statusCode = 404
        res.end()
      }),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server')
  origin = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
async function start(mode = 'login', cookie = '') {
  const response = await fetch(`${origin}/api/auth/google/start`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ mode }),
  })
  const binding = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('steerloom_google='))
  if (binding) browsers[transactions.length - 1] = binding.split(';')[0]!
  return response
}
async function callback(
  tx: GoogleTransaction,
  cookie = browsers[transactions.indexOf(tx)] ?? '',
) {
  return fetch(
    `${origin}/api/auth/google/callback?state=${tx.state}&code=fictional-code`,
    { headers: { Cookie: cookie }, redirect: 'manual' },
  )
}
function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('flowlens_session='))!
    .split(';')[0]!
}
async function session(cookie: string) {
  const response = await fetch(`${origin}/api/auth/session`, {
    headers: { Cookie: cookie },
  })
  const value = (await response.json()) as { session: WorkspaceSession | null }
  return value.session
}

describe('Google browser login boundary', () => {
  it('creates an isolated workspace, onboards once, rotates sessions, and consumes callbacks', async () => {
    const response = await start()
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain(
      'HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600',
    )
    const tx = transactions[0]!
    const finished = await callback(tx)
    expect(finished.status).toBe(200)
    expect(finished.headers.get('set-cookie')).toContain('SameSite=Strict')
    expect(finished.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    )
    const cookie = sessionCookie(finished)
    const first = (await session(cookie))!
    expect(first.needsWorkspaceName).toBe(true)
    expect(first.connections).toEqual([])
    expect(JSON.stringify(first)).not.toMatch(/subject|verifier|nonce|token/i)
    const named = await fetch(`${origin}/api/workspace/name`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Fictional team' }),
    })
    expect(named.status).toBe(200)
    expect((await session(cookie))?.needsWorkspaceName).toBeUndefined()
    expect((await callback(tx)).status).toBe(303)
    await start()
    const returning = await callback(transactions.at(-1)!)
    const secondCookie = sessionCookie(returning)
    expect(secondCookie).not.toBe(cookie)
    expect((await session(secondCookie))?.user.id).toBe(first.user.id)
    expect((await session(secondCookie))?.workspaceName).toBe('Fictional team')
  })
  it('rejects missing browser binding, expired state, and provider failure without leaking details', async () => {
    await start()
    const tx = transactions[0]!
    expect((await callback(tx, '')).status).toBe(303)
    expect((await callback(tx, 'steerloom_google=wrong')).status).toBe(303)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000)
    expect((await callback(tx)).status).toBe(303)
    clock.mockRestore()
    await start()
    rejectProvider = true
    const failed = await callback(transactions.at(-1)!)
    expect(failed.status).toBe(303)
    expect(failed.headers.get('location')).toBe('/?google=error')
    expect(await failed.text()).not.toContain('sensitive')
    expect(
      failed.headers
        .getSetCookie()
        .some((c) => c.startsWith('flowlens_session=')),
    ).toBe(false)
  })
  it('requires deliberate same-origin starts and an authenticated linking session', async () => {
    expect((await start('link')).status).toBe(400)
    const cross = await fetch(`${origin}/api/auth/google/start`, {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.example.invalid',
        'Content-Type': 'application/json',
      },
      body: '{"mode":"login"}',
    })
    expect(cross.status).toBe(403)
    const missing = await fetch(`${origin}/api/auth/google/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"mode":"login"}',
    })
    expect(missing.status).toBe(400)
  })
  it('links to the existing account without needing its Strict cookie on the callback, and invalidates the old session', async () => {
    const registered = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'fictional.lead',
        password: 'fictional-long-password',
        workspaceName: 'Original workspace',
      }),
    })
    const cookie = sessionCookie(registered)
    const user = (await session(cookie))?.user.id
    expect((await start('link', cookie)).status).toBe(200)
    const linked = await callback(transactions.at(-1)!)
    expect((await session(sessionCookie(linked)))?.user.id).toBe(user)
    expect(await session(cookie)).toBeNull()
    await start()
    const login = await callback(transactions.at(-1)!)
    expect((await session(sessionCookie(login)))?.workspaceName).toBe(
      'Original workspace',
    )
  })
  it('does not link after logout or permit the same identity to take another workspace', async () => {
    const registered = await fetch(`${origin}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'fictional.lead',
        password: 'fictional-long-password',
        workspaceName: 'Original workspace',
      }),
    })
    const cookie = sessionCookie(registered)
    await start('link', cookie)
    const tx = transactions.at(-1)!
    await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect((await callback(tx)).status).toBe(303)
    expect(await session(cookie)).toBeNull()
  })
})

describe('Google ID-token verification', () => {
  it('verifies signatures and rejects incorrect issuer, audience, expiry, nonce, or unverified email', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    })
    const jwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'fictional-key',
      alg: 'RS256',
      use: 'sig',
    }
    const tx: GoogleTransaction = {
      state: 'fictional-state',
      nonce: 'fictional-nonce',
      verifier: 'a'.repeat(43),
    }
    const now = Math.floor(Date.now() / 1000)
    let overrides: Record<string, unknown> = {}
    let tamper = false
    const transport: typeof fetch = async (input) => {
      if (
        (input instanceof Request ? input.url : input.toString()).includes(
          '/certs',
        )
      )
        return Response.json({ keys: [jwk] })
      const claims = {
        iss: 'https://accounts.google.com',
        aud: 'fictional-client',
        sub: 'fictional-subject',
        email: 'person@example.invalid',
        email_verified: true,
        iat: now,
        exp: now + 300,
        nonce: tx.nonce,
        ...overrides,
      }
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fictional-key' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
      const signature = createSign('RSA-SHA256')
        .update(unsigned)
        .sign(privateKey)
        .toString('base64url')
      const token = `${unsigned}.${tamper ? (signature[0] === 'X' ? 'Y' : 'X') + signature.slice(1) : signature}`
      return Response.json({
        access_token: 'fictional-transient-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: token,
      })
    }
    const env = {
      STEERLOOM_GOOGLE_CLIENT_ID: 'fictional-client',
      STEERLOOM_GOOGLE_CLIENT_SECRET: 'fictional-secret',
    }
    const verify = () =>
      loadGoogleProvider(env, transport)!.verify(
        new URL(
          `http://127.0.0.1:5173/api/auth/google/callback?code=fictional-code&state=${tx.state}`,
        ),
        tx,
      )
    expect(await verify()).toEqual({
      subject: 'fictional-subject',
      email: 'person@example.invalid',
    })
    for (overrides of [
      { iss: 'https://untrusted.example.invalid' },
      { aud: 'wrong' },
      { exp: now - 3600 },
      { nonce: 'wrong' },
      { email_verified: false },
    ])
      await expect(verify()).rejects.toThrow()
    overrides = {}
    tamper = true
    await expect(verify()).rejects.toThrow()
  })
  it('lets Google reuse normal sign-in while keeping account choice for explicit linking', async () => {
    const provider = loadGoogleProvider({
      STEERLOOM_GOOGLE_CLIENT_ID: 'fictional-client',
      STEERLOOM_GOOGLE_CLIENT_SECRET: 'fictional-secret',
    })!
    const tx: GoogleTransaction = {
      state: 'fictional-state',
      nonce: 'fictional-nonce',
      verifier: 'a'.repeat(43),
    }
    const login = await provider.authorize(tx)
    expect(login.searchParams.has('prompt')).toBe(false)
    expect(login.searchParams.get('scope')).toBe('openid email')
    const linking = await provider.authorize({
      ...tx,
      userId: 'fictional-user',
    })
    expect(linking.searchParams.get('prompt')).toBe('select_account')
  })

  it('disables incomplete/nonlocal configuration and validates identity fields', () => {
    expect(loadGoogleProvider({})).toBeNull()
    expect(
      loadGoogleProvider({
        STEERLOOM_GOOGLE_CLIENT_ID: 'fictional',
        STEERLOOM_GOOGLE_CLIENT_SECRET: 'fictional',
        STEERLOOM_GOOGLE_REDIRECT_URI:
          'https://untrusted.example.invalid/callback',
      }),
    ).toBeNull()
    expect(
      loadGoogleProvider({
        STEERLOOM_GOOGLE_CLIENT_ID: 'fictional',
        STEERLOOM_GOOGLE_CLIENT_SECRET: 'fictional',
        STEERLOOM_GOOGLE_PROXY: 'file:///untrusted',
      }),
    ).toBeNull()
    expect(() =>
      googleIdentity({
        sub: 'fictional',
        email: 'not-email',
        email_verified: true,
      }),
    ).toThrow()
  })
})
