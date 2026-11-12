// @vitest-environment node
import { createHash } from 'node:crypto'
import { MockAgent, fetch } from 'undici'
import { afterEach, expect, it } from 'vitest'
import {
  createVerifier,
  loadSupabaseAuthConfig,
  supabaseAuthProvider,
} from './auth-provider'
const config = {
  origin: 'http://127.0.0.1:5173',
  supabaseUrl: 'https://fictional.supabase.co',
  publishableKey: 'sb_publishable_fictional',
}
const agents: MockAgent[] = []
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()))
})
function setup() {
  const agent = new MockAgent()
  agents.push(agent)
  agent.disableNetConnect()
  return {
    pool: agent.get(config.supabaseUrl),
    provider: supabaseAuthProvider(config, (input, init) =>
      fetch(input, { ...init, dispatcher: agent }),
    ),
  }
}
it('constructs a Google PKCE redirect with an exact app callback and no forced consent', () => {
  const { provider } = setup()
  const verifier = createVerifier()
  const url = new URL(provider.authorize(verifier))
  expect(url.origin).toBe(config.supabaseUrl)
  expect(url.searchParams.get('redirect_to')).toBe(
    `${config.origin}/api/hosted/auth/callback`,
  )
  expect(url.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(verifier).digest('base64url'),
  )
  expect(url.searchParams.get('code_challenge_method')).toBe('s256')
  expect(url.searchParams.has('prompt')).toBe(false)
  expect(url.href).not.toContain(verifier)
})
it('exchanges codes and refreshes tokens only through the server transport', async () => {
  const { pool, provider } = setup()
  const reply = {
    access_token: 'fictional-access',
    refresh_token: 'fictional-refresh',
    expires_in: 3600,
  }
  pool
    .intercept({
      path: '/auth/v1/token?grant_type=pkce',
      method: 'POST',
      body: JSON.stringify({
        auth_code: 'fictional-code',
        code_verifier: 'fictional-verifier',
      }),
    })
    .reply(200, reply)
  expect(
    (await provider.exchange('fictional-code', 'fictional-verifier'))
      .accessToken,
  ).toBe('fictional-access')
  pool
    .intercept({
      path: '/auth/v1/token?grant_type=refresh_token',
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'fictional-refresh' }),
    })
    .reply(200, reply)
  expect((await provider.refresh('fictional-refresh')).refreshToken).toBe(
    'fictional-refresh',
  )
})
it('rejects malformed token responses and sanitizes provider failures', async () => {
  const { pool, provider } = setup()
  pool
    .intercept({ path: '/auth/v1/token?grant_type=password', method: 'POST' })
    .reply(200, { access_token: 'fictional-access' })
  await expect(
    provider.login('person@example.invalid', 'fictional-password'),
  ).rejects.toThrow(/could not be completed/)
  pool
    .intercept({ path: '/auth/v1/token?grant_type=password', method: 'POST' })
    .reply(400, {
      error_code: 'email_not_confirmed',
      message: 'sensitive-provider-details',
    })
  await expect(
    provider.login('person@example.invalid', 'fictional-password'),
  ).rejects.toThrow('Confirm your email before signing in. Check your inbox.')
})
it('explains when the confirmation email could not be sent', async () => {
  const { pool, provider } = setup()
  pool
    .intercept({
      path: (path) => path.startsWith('/auth/v1/signup'),
      method: 'POST',
    })
    .reply(500, {
      error_code: 'unexpected_failure',
      msg: 'Error sending confirmation email',
    })
  await expect(
    provider.register(
      'person@example.invalid',
      'fictional-password-123',
      createVerifier(),
    ),
  ).rejects.toThrow(/confirmation email could not be sent/)
})
it('accepts only publishable configuration for loopback account testing', () => {
  expect(loadSupabaseAuthConfig({})).toBeNull()
  expect(
    loadSupabaseAuthConfig({
      STEERLOOM_SUPABASE_URL: config.supabaseUrl,
      STEERLOOM_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    }),
  ).toEqual(config)
  expect(() =>
    loadSupabaseAuthConfig({
      STEERLOOM_SUPABASE_URL: config.supabaseUrl,
      STEERLOOM_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fictional',
    }),
  ).toThrow(/publishable key/)
  expect(() =>
    loadSupabaseAuthConfig({
      STEERLOOM_SUPABASE_URL: config.supabaseUrl,
      STEERLOOM_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
      STEERLOOM_AUTH_ORIGIN: 'https://app.example.invalid',
    }),
  ).toThrow(/loopback/)
})

it('asks Supabase for a PKCE reset link and sets a new password with the session token', async () => {
  const { pool, provider } = setup()
  const verifier = createVerifier()
  pool
    .intercept({
      path: `/auth/v1/recover?redirect_to=${encodeURIComponent(`${config.origin}/api/hosted/auth/callback`)}`,
      method: 'POST',
      body: JSON.stringify({
        email: 'person@example.invalid',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 's256',
      }),
    })
    .reply(200, {})
  await provider.recover('person@example.invalid', verifier)
  pool
    .intercept({
      path: '/auth/v1/user',
      method: 'PUT',
      headers: { authorization: 'Bearer fictional-access' },
      body: JSON.stringify({ password: 'a-new-fictional-password' }),
    })
    .reply(200, {})
  await provider.updatePassword('fictional-access', 'a-new-fictional-password')
  pool
    .intercept({ path: '/auth/v1/user', method: 'PUT' })
    .reply(422, { error_code: 'weak_password' })
  await expect(
    provider.updatePassword('fictional-access', 'password1234'),
  ).rejects.toThrow('stronger password')
})
