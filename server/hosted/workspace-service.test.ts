// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HostedWorkspaceStore } from './workspace-store'
import { HostedSupabase } from './supabase'
import { createHostedWorkspaceServices, LIMITS } from './workspace-service'
import type { TrelloProvider } from '../trello/oauth'
import type { AtlassianProvider } from '../workspace/atlassian'
import { TrelloClient } from '../trello/client'
import type { WorkspaceSession } from '../../src/lib/workspace/model'

const workspace = '20000000-0000-4000-8000-000000000001'
const other = '20000000-0000-4000-8000-000000000002'
const connection = '30000000-0000-4000-8000-000000000001'
let server: Server
let origin: string
let store: HostedWorkspaceStore
let session: WorkspaceSession
let atlassian: AtlassianProvider
let trello: TrelloProvider
let live: boolean
beforeEach(async () => {
  const database = new HostedSupabase({
    supabaseUrl: 'https://fictional.supabase.co',
    publishableKey: 'sb_publishable_fictional',
  })
  store = new HostedWorkspaceStore(
    database,
    'https://fictional.supabase.co',
    'sb_secret_fictional',
    Buffer.alloc(32, 1),
  )
  session = {
    user: {
      id: '10000000-0000-4000-8000-000000000001',
      username: 'person@example.invalid',
    },
    workspaceId: workspace,
    workspaceRole: 'owner',
    workspaceName: 'Team',
    connections: [{ id: connection, name: 'Board', provider: 'trello' }],
    dashboards: [],
  }
  vi.spyOn(store, 'session').mockImplementation(async (_token, id) => {
    if (id !== workspace) throw new Error('Workspace access is not permitted.')
    return session
  })
  vi.spyOn(store, 'saveConnection').mockResolvedValue(connection)
  vi.spyOn(store, 'connection').mockResolvedValue({
    secret: {
      provider: 'trello',
      name: 'Board',
      apiKey: 'fictionalkey',
      token: 'fictionaltoken',
    },
    encrypted: 'ciphertext',
  })
  vi.spyOn(store, 'saveDashboard').mockResolvedValue(undefined)
  vi.spyOn(store, 'removeConnection').mockResolvedValue(undefined)
  vi.spyOn(TrelloClient.prototype, 'boards').mockResolvedValue([
    { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Team', shortLink: 'AbCd1234' },
  ])
  live = true
  atlassian = {
    redirectUri: new URL('http://127.0.0.1:5173/api/hosted/atlassian/callback'),
    authorize: (state) =>
      new URL(`https://auth.atlassian.com/authorize?state=${state}`),
    exchange: vi.fn().mockResolvedValue({
      accessToken: 'fictional-cloud-token',
      refreshToken: 'fictional-refresh',
      expiresAt: Date.now() + 3600000,
    }),
    resources: vi.fn().mockResolvedValue([
      {
        id: 'fictional-cloud-id',
        url: 'https://fictional.atlassian.net',
        scopes: ['read:jira-work', 'read:board-scope:jira-software'],
      },
    ]),
    refresh: vi.fn(),
  }
  trello = {
    authorize: (state, verifier) =>
      `https://auth.atlassian.com/authorize?state=${state}&challenge=${verifier.length}`,
    exchange: vi.fn().mockResolvedValue({
      accessToken: 'fictional-trello-access',
      refreshToken: 'fictional-trello-refresh',
      expiresAt: Date.now() + 3600000,
    }),
    refresh: vi.fn(),
  }
  const service = createHostedWorkspaceServices(
    store,
    atlassian,
    undefined,
    undefined,
    trello,
  )
  server = createServer((req, res) => {
    void service
      .handle(
        {
          token: 'verified-server-session',
          sessionId: 'session',
          valid: () => live,
        },
        req,
        res,
        new URL(req.url!, origin),
        async () => {
          const chunks: Buffer[] = []
          for await (const chunk of req as AsyncIterable<Buffer>)
            chunks.push(Buffer.from(chunk))
          return JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >
        },
      )
      .then((handled) => {
        if (!handled) {
          res.statusCode = 404
          res.end()
        }
      })
      .catch((error: unknown) => {
        res.statusCode = 400
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server')
  origin = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  vi.restoreAllMocks()
})
function request(path: string, method = 'GET', body?: unknown, id = workspace) {
  return fetch(`${origin}/api/hosted/workspaces/${id}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
it('returns the selected workspace and exposes no machine credentials route', async () => {
  const response = await request('/session')
  expect(await response.json()).toMatchObject({
    session: { workspaceId: workspace },
  })
  expect((await request('/local-jira')).status).toBe(404)
})
it('validates a provider connection and stores it under the authenticated workspace', async () => {
  const response = await request('/connections', 'POST', {
    provider: 'trello',
    name: 'Board',
    apiKey: 'fictionalkey',
    token: 'fictionaltoken',
    workspaceId: other,
    userId: 'forged',
  })
  expect(response.status).toBe(200)
  expect(store.saveConnection).toHaveBeenCalledWith(
    'verified-server-session',
    workspace,
    {
      provider: 'trello',
      name: 'Board',
      apiKey: 'fictionalkey',
      token: 'fictionaltoken',
    },
  )
  expect(JSON.stringify(await response.json())).not.toMatch(
    /fictionaltoken|fictionalkey|encrypted/,
  )
})
it('denies cross-workspace access before decrypting credentials or reading provider boards', async () => {
  const response = await request(
    `/connections/${connection}/boards`,
    'GET',
    undefined,
    other,
  )
  expect(response.status).toBe(400)
  expect(store.connection).not.toHaveBeenCalled()
  expect(TrelloClient.prototype.boards).not.toHaveBeenCalled()
})
it('permits members to read boards but denies connection and dashboard mutations', async () => {
  session.workspaceRole = 'member'
  expect((await request(`/connections/${connection}/boards`)).status).toBe(200)
  expect((await request('/connections', 'POST', {})).status).toBe(403)
  expect((await request('/dashboards', 'PUT', {})).status).toBe(403)
  expect(
    (await request(`/connections/${connection}`, 'DELETE', {})).status,
  ).toBe(403)
  expect(store.saveConnection).not.toHaveBeenCalled()
  expect(store.saveDashboard).not.toHaveBeenCalled()
  expect(store.removeConnection).not.toHaveBeenCalled()
})
it('does not save a connection if upstream authentication fails', async () => {
  vi.mocked(TrelloClient.prototype.boards).mockRejectedValue(
    new Error('Fictional provider authentication failure'),
  )
  expect(
    (
      await request('/connections', 'POST', {
        provider: 'trello',
        name: 'Board',
        apiKey: 'fictionalkey',
        token: 'fictionaltoken',
      })
    ).status,
  ).toBe(400)
  expect(store.saveConnection).not.toHaveBeenCalled()
})

async function startCloud() {
  const response = await request('/atlassian/start', 'POST', {
    link: 'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/12',
  })
  const value = (await response.json()) as { url: string }
  return {
    state: new URL(value.url).searchParams.get('state'),
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0]!)
      .join('; '),
  }
}
async function cloudCallback(state: string | null, cookie = '') {
  return fetch(
    `${origin}/api/hosted/atlassian/callback?state=${state}&code=fictional-code`,
    { headers: { Cookie: cookie } },
  )
}
it('binds Cloud authorization to its workspace/browser and consumes it once', async () => {
  const flow = await startCloud()
  expect(await (await cloudCallback(flow.state)).text()).toContain('jira=error')
  expect(atlassian.exchange).not.toHaveBeenCalled()
  const returned = await cloudCallback(flow.state, flow.cookie)
  expect(await returned.text()).toContain(
    `workspace=${workspace}&jira=connected`,
  )
  expect(store.saveConnection).toHaveBeenCalledWith(
    'verified-server-session',
    workspace,
    expect.objectContaining({
      jiraEdition: 'cloud',
      projectKey: 'DEMO',
      token: 'fictional-cloud-token',
    }),
    undefined,
  )
  expect(await (await cloudCallback(flow.state, flow.cookie)).text()).toContain(
    'jira=error',
  )
  expect(store.saveConnection).toHaveBeenCalledOnce()
})
it('rejects approval for another Cloud site without saving credentials', async () => {
  const flow = await startCloud()
  vi.mocked(atlassian.resources).mockResolvedValue([
    {
      id: 'different-site',
      url: 'https://different.atlassian.net',
      scopes: ['read:jira-work', 'read:board-scope:jira-software'],
    },
  ])
  expect(await (await cloudCallback(flow.state, flow.cookie)).text()).toContain(
    'jira=error',
  )
  expect(store.saveConnection).not.toHaveBeenCalled()
})
it('rechecks role after authorization and does not save credentials after logout', async () => {
  const flow = await startCloud()
  session.workspaceRole = 'member'
  expect(await (await cloudCallback(flow.state, flow.cookie)).text()).toContain(
    'jira=error',
  )
  expect(atlassian.exchange).not.toHaveBeenCalled()
  session.workspaceRole = 'owner'
  const next = await startCloud()
  live = false
  expect(await (await cloudCallback(next.state, next.cookie)).text()).toContain(
    'jira=error',
  )
  expect(store.saveConnection).not.toHaveBeenCalled()
})

async function startTrello() {
  const response = await request('/trello/start', 'POST', {
    link: 'https://trello.com/b/AbCd1234/team',
  })
  const { url } = (await response.json()) as { url: string }
  return {
    state: new URL(url).searchParams.get('state'),
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  }
}
const trelloCallback = (state: string | null, cookie = '') =>
  fetch(`${origin}/api/hosted/trello/callback?state=${state}&code=fictional`, {
    headers: { Cookie: cookie },
  })
it('binds Trello approval to its initiating workspace/browser and consumes it once', async () => {
  const flow = await startTrello()
  expect(await (await trelloCallback(flow.state)).text()).toContain(
    'trello=error',
  )
  expect(trello.exchange).not.toHaveBeenCalled()
  const response = await trelloCallback(flow.state, flow.cookie)
  const html = await response.text()
  expect(html).toContain(
    `workspace=${workspace}&trello=connected&connection=${connection}&board=AbCd1234`,
  )
  expect(html).not.toContain('fictional-trello-access')
  expect(trello.exchange).toHaveBeenCalledWith(
    'fictional',
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  )
  expect(store.saveConnection).toHaveBeenCalledWith(
    'verified-server-session',
    workspace,
    expect.objectContaining({
      provider: 'trello',
      refreshToken: 'fictional-trello-refresh',
    }),
  )
  expect(
    await (await trelloCallback(flow.state, flow.cookie)).text(),
  ).toContain('trello=error&trelloReason=session')
  expect(store.saveConnection).toHaveBeenCalledOnce()
})
it('reports a Trello refusal separately from a lost session', async () => {
  const flow = await startTrello()
  const response = await fetch(
    `${origin}/api/hosted/trello/callback?state=${flow.state}&error=access_denied`,
    { headers: { Cookie: flow.cookie } },
  )
  const html = await response.text()
  expect(html).toContain(
    `workspace=${workspace}&trello=error&trelloReason=denied`,
  )
  expect(html).not.toContain('access_denied')
  expect(trello.exchange).not.toHaveBeenCalled()
})
it('refuses Trello grants after sign-out, role loss or upstream failure', async () => {
  const flow = await startTrello()
  live = false
  expect(
    await (await trelloCallback(flow.state, flow.cookie)).text(),
  ).toContain('trello=error&trelloReason=session')
  expect(trello.exchange).not.toHaveBeenCalled()
  live = true
  const second = await startTrello()
  session.workspaceRole = 'member'
  expect(
    await (await trelloCallback(second.state, second.cookie)).text(),
  ).toContain('trello=error&trelloReason=permission')
  expect(trello.exchange).not.toHaveBeenCalled()
  session.workspaceRole = 'owner'
  const third = await startTrello()
  vi.mocked(TrelloClient.prototype.boards).mockRejectedValue(
    new Error('fictional upstream failure'),
  )
  const denied = await (await trelloCallback(third.state, third.cookie)).text()
  expect(denied).toContain('trello=error&trelloReason=boards')
  expect(denied).not.toContain('fictional upstream failure')
  expect(store.saveConnection).not.toHaveBeenCalled()
})
it('identifies a Trello token exchange failure without returning provider details', async () => {
  const flow = await startTrello()
  vi.mocked(trello.exchange).mockRejectedValueOnce(
    new Error('fictional secret rejected by provider'),
  )
  const response = await trelloCallback(flow.state, flow.cookie)
  const html = await response.text()
  expect(html).toContain('trello=error&trelloReason=exchange')
  expect(html).not.toContain('fictional secret rejected by provider')
  expect(store.saveConnection).not.toHaveBeenCalled()
})
it('rejects members starting Trello approval and invalid board links', async () => {
  expect(
    (
      await request('/trello/start', 'POST', {
        link: 'https://attacker.example.invalid/b/AbCd1234',
      })
    ).status,
  ).toBe(400)
  session.workspaceRole = 'member'
  expect((await request('/trello/start', 'POST', {})).status).toBe(403)
})

it('limits how often one account reads boards, checks connections and asks the AI in an hour', async () => {
  const boards = () => request(`/connections/${connection}/boards`)
  for (let i = 0; i < LIMITS.boardReadsAnHour; i++)
    expect((await boards()).status).toBe(200)
  const refused = await boards()
  expect(refused.status).toBe(429)
  expect(((await refused.json()) as { error: string }).error).toMatch(
    /read boards 120 times in the last hour/,
  )
  // A refused read never reaches the provider.
  expect(TrelloClient.prototype.boards).toHaveBeenCalledTimes(
    LIMITS.boardReadsAnHour,
  )

  // Each check of a new connection reaches out to a provider.
  for (let i = 0; i < LIMITS.setupChecksAnHour; i++)
    expect((await request('/connections', 'POST', {})).status).toBe(400)
  expect((await request('/connections', 'POST', {})).status).toBe(429)

  // Questions spend the workspace's AI key, set up or not.
  vi.spyOn(store, 'aiKey').mockResolvedValue(undefined)
  const ask = () => request('/ai/chat', 'POST', {})
  for (let i = 0; i < LIMITS.aiQuestionsAnHour; i++)
    expect((await ask()).status).toBe(503)
  const tooMany = await ask()
  expect(tooMany.status).toBe(429)
  expect(((await tooMany.json()) as { error: string }).error).toMatch(
    /60 questions in an hour/,
  )
})
it('loads as many boards at once as the browser sends together, and no more', async () => {
  let finish: () => void = () => {}
  const held = new Promise<void>((resolve) => (finish = resolve))
  const history = vi
    .spyOn(TrelloClient.prototype, 'history')
    .mockImplementation(async () => {
      await held
      return {} as never
    })
  const load = (board: number) =>
    request(`/connections/${connection}/boards/board-${board}/snapshot`)
  const loading = Array.from({ length: LIMITS.boardLoadsAtOnce }, (_, index) =>
    load(index),
  )
  await vi.waitFor(() =>
    expect(history).toHaveBeenCalledTimes(LIMITS.boardLoadsAtOnce),
  )
  const refused = await load(99)
  expect(refused.status).toBe(429)
  expect(((await refused.json()) as { error: string }).error).toMatch(
    /10 boards are already loading/,
  )
  finish()
  for (const response of await Promise.all(loading))
    expect(response.status).toBe(200)
  // Finished loads make room again.
  expect((await load(100)).status).toBe(200)
})
