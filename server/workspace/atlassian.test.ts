// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceServices } from './vite-plugin'
import { WorkspaceStore } from './store'
import {
  atlassianConnections,
  ATLASSIAN_SCOPES,
  loadAtlassianProvider,
  type AtlassianProvider,
} from './atlassian'
import type { WorkspaceSession } from '../../src/lib/workspace/model'
let directory: string,
  server: Server,
  origin: string,
  state: string,
  cookie: string
let provider: AtlassianProvider
let resources: Array<{ id: string; url: string; scopes: string[] }>
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'steerloom-atlassian-'))
  resources = [
    {
      id: 'fictional-cloud-id',
      url: 'https://fictional.atlassian.net',
      scopes: [...ATLASSIAN_SCOPES],
    },
  ]
  provider = {
    get redirectUri() {
      return new URL(`${origin}/api/auth/atlassian/callback`)
    },
    authorize(value) {
      state = value
      return new URL(`https://auth.atlassian.com/authorize?state=${value}`)
    },
    exchange: vi.fn().mockResolvedValue({
      accessToken: 'fictional-access',
      refreshToken: 'fictional-refresh',
      expiresAt: Date.now() + 3600000,
    }),
    resources: vi.fn(async () => resources),
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'fictional-new-access',
      refreshToken: 'fictional-new-refresh',
      expiresAt: Date.now() + 3600000,
    }),
  }
  const services = createWorkspaceServices(directory, '', null, provider)
  server = createServer(
    (request, response) =>
      void services.handle(request, response, () => {
        response.statusCode = 404
        response.end()
      }),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server')
  origin = `http://127.0.0.1:${address.port}`
  const registered = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'fictional.lead',
      password: 'fictional-long-password',
      workspaceName: 'Fictional workspace',
    }),
  })
  cookie = registered.headers.getSetCookie()[0]!.split(';')[0]!
})
afterEach(async () => {
  vi.restoreAllMocks()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
})
async function start(session = cookie) {
  return fetch(`${origin}/api/auth/atlassian/start`, {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      link: 'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/1',
    }),
  })
}
async function finish(transaction: string, returnedState = state) {
  return fetch(
    `${origin}/api/auth/atlassian/callback?state=${returnedState}&code=fictional-code`,
    { headers: { Cookie: transaction }, redirect: 'manual' },
  )
}
async function session(): Promise<WorkspaceSession> {
  const response = await fetch(`${origin}/api/auth/session`, {
    headers: { Cookie: cookie },
  })
  return ((await response.json()) as { session: WorkspaceSession }).session
}
describe('Cloud authorization boundary', () => {
  it('binds approval to the user and exact pasted site, encrypts tokens, and preserves dashboards on reconnection', async () => {
    const started = await start()
    expect(started.status).toBe(200)
    expect(started.headers.get('set-cookie')).toContain(
      'HttpOnly; SameSite=Lax',
    )
    const transaction = started.headers.getSetCookie()[0]!.split(';')[0]!
    expect(await (await finish(transaction)).text()).toContain('jira=connected')
    const first = await session()
    expect(first.connections[0]?.jiraEdition).toBe('cloud')
    expect(first.connections[0]?.projectKey).toBe('DEMO')
    expect(JSON.stringify(first)).not.toMatch(
      /fictional-access|fictional-refresh|cloudId/,
    )
    expect(readFileSync(join(directory, 'workspace.json'), 'utf8')).not.toMatch(
      /fictional-access|fictional-refresh/,
    )
    expect(await (await finish(transaction)).text()).toContain('jira=error')
    const dashboard = {
      id: 'fictional-dashboard',
      name: 'Delivery',
      provider: 'jira',
      connectionId: first.connections[0]!.id,
      boardId: '1',
      projectKey: 'DEMO',
      filters: {
        ticketTypes: [],
        selectedColumnIds: ['doing'],
        windowDays: 30,
      },
      metrics: ['aging-wip'],
    }
    const saved = await fetch(`${origin}/api/workspace/dashboards`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dashboard),
    })
    expect(saved.status).toBe(200)
    const restarted = await start()
    expect(
      await (
        await finish(restarted.headers.getSetCookie()[0]!.split(';')[0]!)
      ).text(),
    ).toContain('jira=connected')
    const next = await session()
    expect(next.connections).toHaveLength(1)
    expect(next.connections[0]!.id).toBe(first.connections[0]!.id)
    expect(next.dashboards[0]?.id).toBe('fictional-dashboard')
  })
  it('rejects missing browser state and wrong-site approval without storing a connection', async () => {
    await start()
    expect(await (await finish('')).text()).toContain('jira=error')
    const started = await start()
    resources = [
      {
        id: 'other-cloud-id',
        url: 'https://other.atlassian.net',
        scopes: [...ATLASSIAN_SCOPES],
      },
    ]
    expect(
      await (
        await finish(started.headers.getSetCookie()[0]!.split(';')[0]!)
      ).text(),
    ).toContain('jira=error')
    expect((await session()).connections).toEqual([])
  })
  it('rejects anonymous starts, expired transactions, and callbacks after logout', async () => {
    expect((await start('')).status).toBe(400)
    let started = await start()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 600001)
    expect(
      await (
        await finish(started.headers.getSetCookie()[0]!.split(';')[0]!)
      ).text(),
    ).toContain('jira=error')
    vi.restoreAllMocks()
    started = await start()
    await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(
      await (
        await finish(started.headers.getSetCookie()[0]!.split(';')[0]!)
      ).text(),
    ).toContain('jira=error')
    expect(provider.exchange).not.toHaveBeenCalled()
  })
  it('refreshes once for concurrent requests, rotates encrypted credentials, and isolates users', async () => {
    const store = new WorkspaceStore(directory)
    const userId = (await session()).user.id
    const connection = store.addConnection(userId, {
      provider: 'jira',
      name: 'Cloud',
      jiraEdition: 'cloud',
      baseUrl: 'https://fictional.atlassian.net',
      cloudId: 'fictional-cloud-id',
      projectKey: 'DEMO',
      token: 'fictional-old-access',
      refreshToken: 'fictional-old-refresh',
      expiresAt: Date.now() - 1000,
    })
    const flow = atlassianConnections(
      provider,
      () => store,
      () => undefined,
    )
    expect(
      await Promise.all([
        flow.accessToken(userId, connection.id),
        flow.accessToken(userId, connection.id),
      ]),
    ).toEqual(['fictional-new-access', 'fictional-new-access'])
    expect(provider.refresh).toHaveBeenCalledTimes(1)
    expect(store.connection(userId, connection.id).refreshToken).toBe(
      'fictional-new-refresh',
    )
    await expect(
      flow.accessToken('other-user', connection.id),
    ).rejects.toThrow()
    expect(
      readFileSync(join(directory, 'workspace.json'), 'utf8'),
    ).not.toContain('fictional-new-refresh')
  })
  it('requests only read scopes and stays disabled without operator credentials', () => {
    expect(loadAtlassianProvider({})).toBeNull()
    const configured = loadAtlassianProvider({
      STEERLOOM_ATLASSIAN_CLIENT_ID: 'fictional-client',
      STEERLOOM_ATLASSIAN_CLIENT_SECRET: 'fictional-secret',
    })!
    const url = configured.authorize('fictional-state')
    expect(url.searchParams.get('scope')).not.toMatch(/write:|manage:|delete:/)
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('state')).toBe('fictional-state')
    expect(url.href).not.toContain('fictional-secret')
  })
})
