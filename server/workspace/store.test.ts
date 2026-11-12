// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDashboard } from '../../src/lib/workspace/model'
import { WorkspaceStore } from './store'

let directory: string
let store: WorkspaceStore
const password = 'fictional-test-password'
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'flowlens-store-'))
  store = new WorkspaceStore(directory)
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
describe('local workspace accounts and settings', () => {
  it('keeps the GitHub token encrypted and shows only the host', async () => {
    const id = await store.register('sample.lead', password, 'Fictional team')
    store.saveGithubKey(id, {
      baseUrl: 'https://git.example.invalid',
      token: 'fictional-github-token',
      repositories: ['acme/web'],
    })
    const disk = readFileSync(join(directory, 'workspace.json'), 'utf8')
    expect(disk).not.toContain('fictional-github-token')
    expect(store.session(id).github).toEqual({
      host: 'git.example.invalid',
      repositories: ['acme/web'],
    })
    expect(JSON.stringify(store.session(id))).not.toContain('fictional-github')
    expect(new WorkspaceStore(directory).githubKey(id)?.token).toBe(
      'fictional-github-token',
    )
    store.removeGithubKey(id)
    expect(store.session(id).github).toBeUndefined()
  })
  it('keeps the Figma token encrypted and shows only that it is connected', async () => {
    const id = await store.register('sample.lead', password, 'Fictional team')
    store.saveFigmaKey(id, { token: 'fictional-figma-token' })
    const disk = readFileSync(join(directory, 'workspace.json'), 'utf8')
    expect(disk).not.toContain('fictional-figma-token')
    expect(store.session(id).figma).toEqual({ connected: true })
    expect(new WorkspaceStore(directory).figmaKey(id)?.token).toBe(
      'fictional-figma-token',
    )
    store.removeFigmaKey(id)
    expect(store.session(id).figma).toBeUndefined()
  })
  it('hashes passwords, restores accounts, and keeps connection secrets out of sessions', async () => {
    const id = await store.register('sample.lead', password, 'Fictional team')
    store.addConnection(id, {
      provider: 'trello',
      name: 'Sample board',
      apiKey: 'fictionalkey',
      token: 'fictionaltoken',
    })
    const disk = readFileSync(join(directory, 'workspace.json'), 'utf8')
    expect(disk).not.toContain(password)
    expect(disk).not.toContain('fictionaltoken')
    expect(disk).not.toContain('fictionalkey')
    const restored = new WorkspaceStore(directory)
    expect(await restored.login('SAMPLE.LEAD', password)).toBe(id)
    const session = restored.session(id)
    expect(session.workspaceName).toBe('Fictional team')
    expect(JSON.stringify(session)).not.toMatch(
      /encrypted|token|salt|passwordHash/,
    )
    expect(restored.connection(id, session.connections[0]!.id).token).toBe(
      'fictionaltoken',
    )
    await expect(
      restored.login('sample.lead', 'incorrect-password'),
    ).rejects.toThrow('Incorrect')
  })
  it('persists Google identities by subject without merging email matches or storing tokens', async () => {
    const local = await store.register(
      'person.example',
      password,
      'Existing workspace',
    )
    const google = store.signInGoogle(
      'fictional-subject-one',
      'person@example.invalid',
    )
    expect(google).not.toBe(local)
    expect(
      store.signInGoogle('fictional-subject-one', 'changed@example.invalid'),
    ).toBe(google)
    const other = store.signInGoogle(
      'fictional-subject-two',
      'person@example.invalid',
    )
    expect(other).not.toBe(google)
    expect(() =>
      store.linkGoogle(
        local,
        'fictional-subject-one',
        'person@example.invalid',
      ),
    ).toThrow()
    store.linkGoogle(local, 'fictional-subject-three', 'person@example.invalid')
    expect(
      store.signInGoogle('fictional-subject-three', 'person@example.invalid'),
    ).toBe(local)
    expect(() =>
      store.linkGoogle(
        local,
        'fictional-subject-four',
        'person@example.invalid',
      ),
    ).toThrow()
    expect(await store.login('person.example', password)).toBe(local)
    const restored = new WorkspaceStore(directory)
    expect(restored.googleUser('fictional-subject-one')).toBe(google)
    expect(restored.session(local).workspaceName).toBe('Existing workspace')
    expect(restored.session(google).connections).toEqual([])
    await expect(
      restored.login(restored.session(google).user.username, password),
    ).rejects.toThrow()
    expect(readFileSync(join(directory, 'workspace.json'), 'utf8')).not.toMatch(
      /access_token|id_token|refresh_token/,
    )
  })

  it('isolates connections and dashboards between accounts', async () => {
    const first = await store.register('first.lead', password, 'Team one')
    const second = await store.register('second.lead', password, 'Team two')
    const connection = store.addConnection(first, {
      provider: 'trello',
      name: 'Board',
      token: 'sampletoken',
      apiKey: 'samplekey',
    })
    expect(() => store.connection(second, connection.id)).toThrow('not found')
    const dashboard = readDashboard({
      id: 'sample',
      name: 'Delivery',
      provider: 'trello',
      connectionId: connection.id,
      boardId: 'board1',
      filters: {
        ticketTypes: [],
        selectedColumnIds: ['active'],
        windowDays: 30,
      },
      metrics: ['median-cycle-time'],
    })
    expect(() => store.saveDashboard(second, dashboard)).toThrow('not found')
    store.saveDashboard(first, dashboard)
    expect(store.session(first).dashboards).toHaveLength(1)
    expect(store.session(second).dashboards).toHaveLength(0)
    store.removeConnection(first, connection.id)
    expect(store.session(first).dashboards).toHaveLength(0)
  })
  it('prevents duplicate usernames during concurrent registration', async () => {
    const results = await Promise.allSettled([
      store.register('same.user', password, 'First'),
      store.register('same.user', password, 'Second'),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
  })
  it('rejects short passwords and incompatible dashboard connections', async () => {
    await expect(store.register('lead', 'short', 'Team')).rejects.toThrow(
      '12–128',
    )
    const id = await store.register('lead', password, 'Team')
    const connection = store.addConnection(id, {
      provider: 'jira',
      name: 'Sample',
      projectKey: 'DEMO',
      token: 'sample',
    })
    expect(() =>
      store.saveDashboard(
        id,
        readDashboard({
          id: 'sample',
          name: 'Delivery',
          provider: 'jira',
          connectionId: connection.id,
          boardId: '1',
          projectKey: 'OTHER',
          filters: {
            ticketTypes: [],
            selectedColumnIds: ['active'],
            windowDays: 30,
          },
          metrics: ['median-cycle-time'],
        }),
      ),
    ).toThrow('does not match')
  })
})
