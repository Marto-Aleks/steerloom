// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { MockAgent, Response, fetch } from 'undici'
import { afterEach, expect, it, vi } from 'vitest'
import { loadHostedConfig } from './config'
import { credentialVault } from './credentials'
import { HostedSupabase } from './supabase'

const env = {
  STEERLOOM_PUBLIC_ORIGIN: 'https://app.example.invalid',
  STEERLOOM_SUPABASE_URL: 'https://fictional.supabase.co',
  STEERLOOM_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fictional',
  STEERLOOM_CREDENTIAL_KEY: 'ab'.repeat(32),
}
const id = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const agents: MockAgent[] = []
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()))
})
function client() {
  const agent = new MockAgent()
  agents.push(agent)
  agent.disableNetConnect()
  const pool = agent.get(env.STEERLOOM_SUPABASE_URL)
  const transport: typeof fetch = (input, init) =>
    fetch(input, { ...init, dispatcher: agent })
  return { pool, api: new HostedSupabase(loadHostedConfig(env), transport) }
}
it.each([200, 201, 204])(
  'accepts a successful dashboard save with no response body (HTTP %s)',
  async (status) => {
    const { api, pool } = client()
    pool
      .intercept({
        path: '/rest/v1/workspace_dashboards?on_conflict=workspace_id,dashboard_key',
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      })
      .reply(status, '')
    await expect(
      api.request(
        '/rest/v1/workspace_dashboards?on_conflict=workspace_id,dashboard_key',
        'fictional-jwt',
        { workspace_id: id, dashboard_key: 'fictional-board', settings: {} },
        'POST',
        'resolution=merge-duplicates,return=minimal',
      ),
    ).resolves.toBeNull()
  },
)
it('still rejects failed minimal writes and empty read responses', async () => {
  const { api, pool } = client()
  pool
    .intercept({ path: '/rest/v1/workspace_dashboards', method: 'POST' })
    .reply(403, '')
  await expect(
    api.request(
      '/rest/v1/workspace_dashboards',
      'fictional-jwt',
      {},
      'POST',
      'return=minimal',
    ),
  ).rejects.toThrow('Sign in or request workspace access.')
  pool.intercept({ path: '/rest/v1/workspace_dashboards' }).reply(200, '')
  await expect(
    api.request('/rest/v1/workspace_dashboards', 'fictional-jwt'),
  ).rejects.toThrow('The workspace service response could not be loaded.')
})
it('sanitizes workspace transport timeouts without replaying mutations', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(
      new DOMException('sensitive upstream request details', 'TimeoutError'),
    )
  const api = new HostedSupabase(loadHostedConfig(env), transport)
  await expect(
    api.request('/rest/v1/rpc/steerloom_create_workspace', 'fictional-jwt', {
      workspace_name: 'Example',
    }),
  ).rejects.toThrow(
    'Could not reach the workspace service. Check your connection or VPN, then try again.',
  )
  expect(transport).toHaveBeenCalledTimes(1)
})
it('sanitizes workspace response failures after headers arrive', async () => {
  const response = new Response('{}')
  vi.spyOn(response, 'json').mockRejectedValue(
    new DOMException('sensitive body details', 'TimeoutError'),
  )
  const transport = vi.fn<typeof fetch>().mockResolvedValue(response)
  const api = new HostedSupabase(loadHostedConfig(env), transport)
  await expect(api.request('/auth/v1/user', 'fictional-jwt')).rejects.toThrow(
    'The workspace service response could not be loaded. Try again.',
  )
  expect(transport).toHaveBeenCalledTimes(1)
})
it('requires explicit HTTPS origins, publishable keys and a persistent encryption key', () => {
  expect(loadHostedConfig(env).credentialKey).toHaveLength(32)
  for (const origin of [
    'http://localhost:5173',
    'https://app.example.invalid/path',
    'https://user:secret@app.example.invalid',
    'https://app.example.invalid?x=1',
  ])
    expect(() =>
      loadHostedConfig({ ...env, STEERLOOM_PUBLIC_ORIGIN: origin }),
    ).toThrow(/HTTPS origin/)
  expect(() =>
    loadHostedConfig({
      ...env,
      STEERLOOM_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private',
    }),
  ).toThrow(/publishable key/)
  expect(() =>
    loadHostedConfig({ ...env, STEERLOOM_CREDENTIAL_KEY: '' }),
  ).toThrow(/random bytes/)
})
it('binds credentials to their workspace and connection and detects modification', () => {
  const vault = credentialVault(randomBytes(32))
  const encrypted = vault.encrypt('fictional-token', id, id)
  expect(encrypted).not.toContain('fictional-token')
  expect(vault.decrypt(encrypted, id, id)).toBe('fictional-token')
  expect(vault.encrypt('fictional-token', id, id)).not.toBe(encrypted)
  expect(() => vault.decrypt(encrypted, other, id)).toThrow(/Reconnect/)
  expect(() => vault.decrypt(encrypted, id, other)).toThrow(/Reconnect/)
  expect(() => vault.decrypt('invalid', id, id)).toThrow(/Reconnect/)
  expect(() =>
    credentialVault(randomBytes(32)).decrypt(encrypted, id, id),
  ).toThrow(/Reconnect/)
})
it('validates the user with Supabase and checks current access rather than trusting JWT payloads', async () => {
  const { api, pool } = client()
  pool
    .intercept({
      path: '/auth/v1/user',
      headers: {
        authorization: 'Bearer fictional-jwt',
        apikey: 'sb_publishable_fictional',
      },
    })
    .reply(200, {
      id,
      email: 'person@example.invalid',
      email_confirmed_at: '2026-10-15',
      is_anonymous: false,
    })
  pool
    .intercept({
      path: '/rest/v1/rpc/steerloom_active_user',
      method: 'POST',
      body: '{}',
    })
    .reply(200, 'true')
  expect(await api.identity('fictional-jwt')).toEqual({
    id,
    email: 'person@example.invalid',
  })
})
it('rejects unverified and disabled users', async () => {
  const { api, pool } = client()
  pool
    .intercept({ path: '/auth/v1/user' })
    .reply(200, { id, email: 'person@example.invalid' })
  await expect(api.identity('fictional-jwt')).rejects.toThrow(
    /Verify your email/,
  )
  pool.intercept({ path: '/auth/v1/user' }).reply(200, {
    id,
    email: 'person@example.invalid',
    email_confirmed_at: '2026-10-15',
  })
  pool
    .intercept({ path: '/rest/v1/rpc/steerloom_active_user', method: 'POST' })
    .reply(200, 'false')
  await expect(api.identity('fictional-jwt')).rejects.toThrow(
    /does not have access/,
  )
})
it('does not expose upstream response bodies and refuses authorization redirects', async () => {
  const { api, pool } = client()
  pool
    .intercept({ path: '/auth/v1/user' })
    .reply(401, 'sensitive-provider-diagnostic')
  await expect(api.identity('fictional-jwt')).rejects.toThrow(
    'Sign in or request workspace access.',
  )
  pool.intercept({ path: '/auth/v1/user' }).reply(302, '', {
    headers: { location: 'https://untrusted.example.invalid' },
  })
  await expect(api.identity('fictional-jwt')).rejects.toThrow()
})

it('uses a fixed hosted origin and rejects forged proxy headers and cross-site mutations', async () => {
  const { hostedRequestUrl } = await import('./request-policy')
  const origin = env.STEERLOOM_PUBLIC_ORIGIN
  const request = {
    method: 'POST',
    url: '/api/workspace',
    headers: { host: 'app.example.invalid', origin },
  }
  expect(hostedRequestUrl(request, origin).origin).toBe(origin)
  expect(
    hostedRequestUrl(
      {
        method: 'GET',
        url: '/api/auth/callback?code=fictional',
        headers: { host: 'app.example.invalid' },
      },
      origin,
    ).pathname,
  ).toBe('/api/auth/callback')
  for (const override of [
    {
      headers: {
        host: 'attacker.example.invalid',
        origin,
        'x-forwarded-host': 'app.example.invalid',
      },
    },
    {
      headers: {
        host: 'app.example.invalid',
        origin: 'https://attacker.example.invalid',
      },
    },
    { headers: { host: 'app.example.invalid' } },
    {
      headers: {
        host: 'app.example.invalid',
        origin,
        'sec-fetch-site': 'cross-site',
      },
    },
    { url: '//attacker.example.invalid' },
    { url: 'https://attacker.example.invalid' },
  ])
    expect(() => hostedRequestUrl({ ...request, ...override }, origin)).toThrow(
      /configured Steerloom/,
    )
})
it('checks an identity once per token for a short while, never reusing a failure', async () => {
  let clock = 0
  const calls: string[] = []
  let confirmed = false
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(input as string).pathname
    calls.push(path)
    if (path === '/auth/v1/user')
      return new Response(
        JSON.stringify({
          id,
          email: 'person@example.invalid',
          email_confirmed_at: confirmed ? '2026-10-26T00:00:00Z' : null,
        }),
      )
    return new Response('true')
  })
  const api = new HostedSupabase(loadHostedConfig(env), transport, () => clock)
  await expect(api.identity('token-a')).rejects.toThrow('Verify your email')
  confirmed = true
  // A failed check is asked again, and parallel requests share one check.
  const [first, second] = await Promise.all([
    api.identity('token-a'),
    api.identity('token-a'),
  ])
  expect(first).toEqual({ id, email: 'person@example.invalid' })
  expect(second).toBe(first)
  expect(calls).toHaveLength(3)
  clock = 29_000
  await api.identity('token-a')
  expect(calls).toHaveLength(3)
  // Another token is checked on its own; after 30 s the token is checked again.
  await api.identity('token-b')
  expect(calls).toHaveLength(5)
  clock = 31_000
  await api.identity('token-a')
  expect(calls).toHaveLength(7)
})
