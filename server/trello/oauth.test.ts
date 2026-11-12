// @vitest-environment node
import { createHash } from 'node:crypto'
import {
  MockAgent,
  fetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici'
import { afterEach, expect, it } from 'vitest'
import { loadTrelloProvider } from './oauth'
import { TrelloClient } from './client'
const agents: MockAgent[] = []
const original = getGlobalDispatcher()
afterEach(async () => {
  setGlobalDispatcher(original)
  for (const agent of agents.splice(0)) await agent.close()
})
function setup() {
  const agent = new MockAgent()
  agents.push(agent)
  agent.disableNetConnect()
  const provider = loadTrelloProvider(
    {
      STEERLOOM_TRELLO_CLIENT_ID: 'fictional-client',
      STEERLOOM_TRELLO_CLIENT_SECRET: 'fictional-secret',
    },
    'https://app.example.invalid',
    (input, init) => fetch(input, { ...init, dispatcher: agent }),
  )!
  return { agent, provider, pool: agent.get('https://auth.atlassian.com') }
}
it('requests only read scopes and offline refresh using PKCE and a fixed callback', () => {
  const { provider } = setup(),
    verifier = 'fictional-verifier'
  const url = new URL(provider.authorize('fictional-state', verifier))
  expect(url.searchParams.get('state')).toBe('fictional-state')
  expect(url.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(verifier).digest('base64url'),
  )
  expect(url.searchParams.get('scope')).toBe(
    'read:board:trello read:member:trello offline_access',
  )
  expect(url.searchParams.get('redirect_uri')).toBe(
    'https://app.example.invalid/api/hosted/trello/callback',
  )
  expect(url.href).not.toMatch(/fictional-secret|fictional-verifier/)
})
it('exchanges and rotates credentials server-side and sanitizes failures', async () => {
  const { provider, pool } = setup()
  const tokens = {
    access_token: 'fictional-access',
    refresh_token: 'fictional-refresh',
    expires_in: 3600,
  }
  pool
    .intercept({
      path: '/oauth/token',
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: 'fictional-code',
        code_verifier: 'fictional-verifier',
        redirect_uri: 'https://app.example.invalid/api/hosted/trello/callback',
        client_id: 'fictional-client',
        client_secret: 'fictional-secret',
      }),
    })
    .reply(200, tokens)
  expect(
    (await provider.exchange('fictional-code', 'fictional-verifier'))
      .accessToken,
  ).toBe('fictional-access')
  pool
    .intercept({ path: '/oauth/token', method: 'POST' })
    .reply(200, { ...tokens, refresh_token: 'rotated' })
  expect((await provider.refresh('fictional-refresh')).refreshToken).toBe(
    'rotated',
  )
  pool
    .intercept({ path: '/oauth/token', method: 'POST' })
    .reply(401, 'private-diagnostic')
  await expect(provider.refresh('fictional-refresh')).rejects.toThrow(
    'Trello authorization expired or was revoked. Connect again.',
  )
})
it('rejects incomplete grants and missing client configuration', async () => {
  const { provider, pool } = setup()
  expect(loadTrelloProvider({}, 'https://app.example.invalid')).toBeNull()
  pool
    .intercept({ path: '/oauth/token', method: 'POST' })
    .reply(200, { access_token: 'fictional-access' })
  await expect(provider.exchange('fictional', 'fictional')).rejects.toThrow(
    /Invalid Trello/,
  )
})
it('reads boards using a server-provided bearer token without putting credentials in URLs', async () => {
  const { agent } = setup()
  setGlobalDispatcher(agent)
  agent
    .get('https://trello.com')
    .intercept({
      path: '/1/members/me/boards?fields=name%2CshortLink&filter=open',
      method: 'GET',
      headers: { authorization: 'Bearer fictional-access' },
    })
    .reply(200, [
      {
        id: 'a'.repeat(24),
        name: 'Team',
        shortLink: 'AbCd1234',
        privateExtra: 'omitted',
      },
    ])
  expect(
    await new TrelloClient(
      '',
      '',
      undefined,
      async () => 'fictional-access',
    ).boards(),
  ).toEqual([{ id: 'a'.repeat(24), name: 'Team', shortLink: 'AbCd1234' }])
})
