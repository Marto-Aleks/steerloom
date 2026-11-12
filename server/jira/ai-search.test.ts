// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from './jira-client'

const mocks = vi.hoisted(() => ({
  fetch:
    vi.fn<(input: string, init: { method?: string }) => Promise<Response>>(),
}))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())

const client = () =>
  new JiraClient({
    instance: 'fictional',
    baseUrl: 'https://jira.example.invalid',
    pat: 'fictional-pat',
    apiKey: '',
    proxyUrl: '',
    defaultProjectKey: 'DEMO',
    missing: [],
  })

const jira = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-arequestid': '1' },
  })

const issue = (key: string, assignee: string | null) => ({
  key,
  fields: {
    summary: `Fictional ${key}`,
    status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
    issuetype: { name: 'Story' },
    priority: { name: 'High' },
    assignee: assignee ? { displayName: assignee } : null,
    updated: '2026-09-01T10:00:00.000+0000',
    parent: { key: 'DEMO-1', fields: { summary: 'Fictional epic' } },
  },
})

describe('the assistant’s Jira search', () => {
  it('asks one page inside the project and matches the person by name', async () => {
    mocks.fetch.mockResolvedValue(
      jira({
        total: 3,
        issues: [
          issue('DEMO-5', 'Ana Lima'),
          issue('DEMO-6', 'Ben Ode'),
          issue('DEMO-7', 'Ana Lima'),
        ],
      }),
    )
    const found = await client().aiSearch('DEMO', {
      assignee: 'lima',
      state: 'open',
      limit: 1,
    })
    const url = new URL(mocks.fetch.mock.calls[0]![0])
    expect(url.pathname).toBe('/rest/api/2/search')
    expect(url.searchParams.get('jql')).toBe(
      'project = "DEMO" AND statusCategory != Done ORDER BY updated DESC',
    )
    // Names are matched afterwards, so a wider page is read.
    expect(url.searchParams.get('maxResults')).toBe('100')
    expect(found.items.map((item) => item.key)).toEqual(['DEMO-5'])
    expect(found.items[0]!.parent?.key).toBe('DEMO-1')
    expect(found.more).toBe(true)
  })

  it('passes on why Jira could not run a search, so the model can fix it', async () => {
    mocks.fetch.mockResolvedValue(
      jira(
        {
          errorMessages: [
            "The value 'Blocked' does not exist for the field 'status'.",
          ],
        },
        400,
      ),
    )
    await expect(
      client().aiSearch('DEMO', { status: 'Blocked' }),
    ).rejects.toThrow(
      "Jira could not run this: The value 'Blocked' does not exist for the field 'status'.",
    )
  })
})
