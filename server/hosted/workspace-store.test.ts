// @vitest-environment node
import { MockAgent, fetch } from 'undici'
import { afterEach, expect, it, vi } from 'vitest'
import { HostedWorkspaceStore } from './workspace-store'
import { HostedSupabase } from './supabase'

const actor = '10000000-0000-4000-8000-000000000001'
const workspace = '20000000-0000-4000-8000-000000000001'
const connection = '30000000-0000-4000-8000-000000000001'
const url = 'https://fictional.supabase.co'
const agents: MockAgent[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(agents.splice(0).map((agent) => agent.close()))
})
function setup() {
  const agent = new MockAgent()
  agents.push(agent)
  agent.disableNetConnect()
  const database = new HostedSupabase({
    supabaseUrl: url,
    publishableKey: 'sb_publishable_fictional',
  })
  vi.spyOn(database, 'identity').mockResolvedValue({
    id: actor,
    email: 'person@example.invalid',
  })
  vi.spyOn(database, 'role').mockResolvedValue('owner')
  const store = new HostedWorkspaceStore(
    database,
    url,
    'sb_secret_fictional',
    Buffer.alloc(32, 1),
    (input, init) => fetch(input, { ...init, dispatcher: agent }),
  )
  return { store, database, pool: agent.get(url) }
}
it('sends only ciphertext to the privileged RPC and authenticates with an API key header', async () => {
  const { store, pool } = setup()
  let ciphertext = ''
  pool
    .intercept({
      path: '/rest/v1/rpc/steerloom_server_save_connection',
      method: 'POST',
      headers: (headers) => {
        expect(headers.apikey).toBe('sb_secret_fictional')
        expect(headers.authorization).toBeUndefined()
        return true
      },
    })
    .reply(200, (options) => {
      const value = JSON.parse(String(options.body as string)) as Record<
        string,
        string
      >
      expect(value.actor).toBe(actor)
      expect(value.target).toBe(workspace)
      expect(value.connection).toBe(connection)
      ciphertext = value.ciphertext!
      expect(String(options.body as string)).not.toContain('fictional-token')
      return JSON.stringify(connection)
    })
  await store.saveConnection(
    'user-jwt',
    workspace,
    {
      provider: 'trello',
      name: 'Team',
      token: 'fictional-token',
      apiKey: 'fictional-key',
    },
    connection,
  )
  pool
    .intercept({
      path: '/rest/v1/rpc/steerloom_server_connection',
      method: 'POST',
    })
    .reply(200, { encrypted: ciphertext, keyVersion: 1 })
  expect(
    (await store.connection('user-jwt', workspace, connection)).secret.token,
  ).toBe('fictional-token')
})
it('blocks member writes before using privileged database credentials', async () => {
  const { store, database } = setup()
  vi.mocked(database.role).mockResolvedValue('member')
  await expect(
    store.saveConnection('user-jwt', workspace, {
      provider: 'trello',
      name: 'Team',
    }),
  ).rejects.toThrow(/Only owners/)
  await expect(
    store.removeConnection('user-jwt', workspace, connection),
  ).rejects.toThrow(/Only owners/)
  await expect(store.saveDashboard('user-jwt', workspace, {})).rejects.toThrow(
    /Only owners/,
  )
})
it('explains a missing migration without exposing the database diagnostic', async () => {
  const { store, pool } = setup()
  pool
    .intercept({
      path: '/rest/v1/rpc/steerloom_server_connection',
      method: 'POST',
    })
    .reply(404, 'fictional-sensitive-database-error')
  await expect(
    store.connection('user-jwt', workspace, connection),
  ).rejects.toThrow(
    'Apply the workspace connection migration in Supabase before connecting boards.',
  )
})
