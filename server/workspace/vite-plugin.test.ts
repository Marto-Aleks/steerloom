import { JiraClient } from '../jira/jira-client'
import { WorkspaceStore } from './store'
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceServices } from './vite-plugin'
import { PROGRESS_CONTENT_TYPE } from '../../src/lib/progress'
import { BOARD_PROGRESS } from '../../src/lib/workspace/board-progress'

let directory: string
let server: Server
let origin: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'flowlens-http-'))
  // No Google or Atlassian app, whatever the developer's .env.local says.
  const services = createWorkspaceServices(directory, '', null, null)
  server = createServer((request, response) => {
    void services.handle(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Test server did not start.')
  origin = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  vi.restoreAllMocks()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  rmSync(directory, { recursive: true, force: true })
})
async function register(username = 'sample.lead') {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      username,
      password: 'fictional-long-password',
      workspaceName: 'Fictional team',
    }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')!
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Strict')
  return cookie.split(';')[0]!
}
describe('workspace HTTP boundary', () => {
  it('normalizes pasted Jira pages and encrypts user-owned gateway keys', async () => {
    const boards = vi
      .spyOn(JiraClient.prototype, 'listBoards')
      .mockResolvedValue([])
    const cookie = await register()
    const response = await fetch(`${origin}/api/workspace/connections`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'jira',
        name: 'Fictional Jira',
        baseUrl: 'https://jira.example.invalid/instance/projects/DEMO/summary',
        projectKey: 'DEMO',
        token: 'fictional-pat',
        apiKey: 'fictional-gateway-key',
      }),
    })
    expect(response.status).toBe(200)
    expect(boards).toHaveBeenCalledWith('DEMO', expect.any(AbortSignal))
    const value = (await response.json()) as {
      session: { user: { id: string }; connections: Array<{ id: string }> }
    }
    const stored = new WorkspaceStore(directory).connection(
      value.session.user.id,
      value.session.connections[0]!.id,
    )
    expect(stored.baseUrl).toBe('https://jira.example.invalid/instance')
    expect(stored.apiKey).toBe('fictional-gateway-key')
    expect(JSON.stringify(value)).not.toMatch(
      /fictional-pat|fictional-gateway-key/,
    )
  })
  it('offers Cloud API tokens without an Atlassian app and validates them before contacting Jira', async () => {
    const boards = vi
      .spyOn(JiraClient.prototype, 'listBoards')
      .mockResolvedValue([])
    const providers = await fetch(`${origin}/api/auth/providers`)
    expect(await providers.json()).toMatchObject({
      atlassian: false,
      jiraCloudToken: true,
    })
    const cookie = await register()
    const connect = (body: Record<string, string>) =>
      fetch(`${origin}/api/workspace/connections`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'jira',
          name: 'Fictional Cloud',
          baseUrl:
            'https://fictional.atlassian.net/jira/software/c/projects/DEMO/boards/12',
          token: 'fictional-api-token',
          ...body,
        }),
      })
    const missingEmail = await connect({})
    expect(missingEmail.status).toBe(400)
    expect(boards).not.toHaveBeenCalled()
    const response = await connect({ email: 'person@example.invalid' })
    expect(response.status).toBe(200)
    expect(boards).toHaveBeenCalledWith('DEMO', expect.anything())
    const text = await response.text()
    expect(text).toContain('"jiraEdition":"cloud"')
    expect(text).not.toMatch(/fictional-api-token|person@example\.invalid/)
  })
  it('requires login for connector, agent, and workspace APIs', async () => {
    for (const path of [
      '/api/jira/connection',
      '/api/ai/config',
      '/api/workspace/connections/unknown/boards',
    ]) {
      expect((await fetch(origin + path)).status).toBe(401)
    }
    expect(await (await fetch(`${origin}/api/auth/session`)).json()).toEqual({
      session: null,
    })
  })
  it('rejects cross-origin and non-JSON mutations before creating accounts', async () => {
    expect(
      (
        await fetch(`${origin}/api/auth/register`, {
          method: 'POST',
          headers: {
            Origin: 'https://untrusted.example.invalid',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(`${origin}/api/auth/register`, {
          method: 'POST',
          headers: { Origin: `${origin}0`, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(`${origin}/api/auth/register`, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(415)
  })
  it('saves only configuration, isolates users, and invalidates logout sessions', async () => {
    const cookie = await register()
    const dashboard = {
      id: 'demo:sample',
      name: 'Sample dashboard',
      provider: 'demo',
      connectionId: 'demo',
      boardId: 'demo-product',
      filters: {
        selectedColumnIds: ['stage-1'],
        ticketTypes: [],
        windowDays: 30,
      },
      metrics: ['median-cycle-time'],
      rows: [{ title: 'Fictional work row' }],
    }
    const saved = await fetch(`${origin}/api/workspace/dashboards`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify(dashboard),
    })
    expect(saved.status).toBe(200)
    const body = (await saved.json()) as { session: { dashboards: unknown[] } }
    expect(body.session.dashboards).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('Fictional work row')
    const second = await register('other.lead')
    const other = (await (
      await fetch(`${origin}/api/auth/session`, { headers: { Cookie: second } })
    ).json()) as {
      session: { dashboards: unknown[] }
    }
    expect(other.session.dashboards).toEqual([])
    const logout = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(logout.status).toBe(200)
    expect(
      (
        await fetch(`${origin}/api/workspace/connections/unknown/boards`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(401)
  })
  it('does not let a user fetch another workspace’s connection', async () => {
    const cookie = await register()
    const response = await fetch(
      `${origin}/api/workspace/connections/unknown/boards`,
      { headers: { Cookie: cookie } },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Connection not found in this workspace.',
    })
  })
  it('streams board loading progress when asked and keeps plain JSON otherwise', async () => {
    vi.spyOn(JiraClient.prototype, 'listBoards').mockResolvedValue([])
    const payload = {
      board: { id: '12', name: 'Fictional board', columns: [] },
      issues: [],
      changes: [],
    }
    const load = vi
      .spyOn(JiraClient.prototype, 'loadBoard')
      .mockImplementation(async (_project, _board, _signal, onProgress) => {
        onProgress?.(BOARD_PROGRESS.board)
        onProgress?.({ ...BOARD_PROGRESS.items, detail: '3 found' })
        onProgress?.({
          ...BOARD_PROGRESS.history,
          detail: '3 of 3 items',
          done: 3,
          total: 3,
        })
        onProgress?.(BOARD_PROGRESS.done)
        return payload as never
      })
    const cookie = await register()
    const created = (await (
      await fetch(`${origin}/api/workspace/connections`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'jira',
          name: 'Fictional Jira',
          baseUrl: 'https://jira.example.invalid',
          projectKey: 'DEMO',
          token: 'fictional-pat',
        }),
      })
    ).json()) as { session: { connections: Array<{ id: string }> } }
    const url = `${origin}/api/workspace/connections/${created.session.connections[0]!.id}/boards/12/snapshot`

    const streamed = await fetch(url, {
      headers: { Cookie: cookie, Accept: PROGRESS_CONTENT_TYPE },
    })
    expect(streamed.headers.get('content-type')).toContain(
      PROGRESS_CONTENT_TYPE,
    )
    const text = await streamed.text()
    expect(text).not.toContain('fictional-pat')
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; step?: string })
    expect(lines.map((line) => line.step ?? line.type)).toEqual([
      'board',
      'items',
      'history',
      'done',
      'result',
    ])
    expect(lines.at(-1)).toEqual({
      type: 'result',
      value: { provider: 'jira', payload },
    })

    const plain = await fetch(url, { headers: { Cookie: cookie } })
    expect(plain.headers.get('content-type')).toContain('application/json')
    expect(await plain.json()).toEqual({ provider: 'jira', payload })

    // A board loaded minutes ago comes from memory; a refresh asks again.
    load.mockRejectedValueOnce(new Error('Fictional board is unavailable.'))
    const failed = await fetch(`${url}?fresh=1`, {
      headers: { Cookie: cookie, Accept: PROGRESS_CONTENT_TYPE },
    })
    expect(JSON.parse((await failed.text()).trim())).toEqual({
      type: 'error',
      error: 'Fictional board is unavailable.',
      status: 400,
    })
  })
})
