// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  JiraClient,
  normaliseJiraInvestigation,
  normaliseTimestamp,
} from './jira-client'
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<
    (
      input: string,
      init: {
        method?: string
        headers: Record<string, string>
        redirect?: string
        body?: string
      },
    ) => Promise<Response>
  >(),
}))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())
const site = 'https://fictional.atlassian.net'
function client() {
  return new JiraClient({
    instance: 'Cloud',
    cloud: true,
    siteUrl: site,
    baseUrl: 'https://api.atlassian.com/ex/jira/fictional-cloud-id',
    accessToken: async () => 'fictional-server-token',
    pat: '',
    apiKey: '',
    proxyUrl: '',
    defaultProjectKey: 'DEMO',
    missing: [],
  })
}
const issue = {
  id: '10',
  key: 'DEMO-1',
  fields: {
    created: '2026-10-01T00:00:00Z',
    issuetype: { id: '1', name: 'Story' },
    status: { id: 'done', name: 'Done' },
  },
}
describe('Cloud delivery evidence', () => {
  it('falls back to complete per-issue changelog pages when bulk history is unavailable', async () => {
    mocks.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input)
      const path = url.pathname.replace('/ex/jira/fictional-cloud-id', '')
      if (path === '/rest/api/3/changelog/bulkfetch')
        return Response.json({ errorMessages: ['Not found'] }, { status: 404 })
      if (path === '/rest/agile/1.0/board')
        return Response.json({
          values: [{ id: 1, name: 'Fictional board' }],
          isLast: true,
        })
      if (path.endsWith('/configuration'))
        return Response.json({
          id: 1,
          name: 'Fictional board',
          columnConfig: {
            columns: [
              { name: 'Doing', statuses: [{ id: 'doing' }] },
              { name: 'Done', statuses: [{ id: 'done' }] },
            ],
          },
        })
      if (path === '/rest/api/3/status')
        return Response.json([
          { id: 'doing', name: 'Doing' },
          { id: 'done', name: 'Done' },
        ])
      if (path === '/rest/software/1.0/board/1/issue')
        return Response.json(
          url.searchParams.has('nextPageToken')
            ? { issues: [], isLast: true }
            : { issues: [issue], isLast: false, nextPageToken: 'next' },
        )
      if (path === '/rest/api/3/search/jql')
        return Response.json({ issues: [issue], isLast: true })
      if (path.endsWith('/changelog'))
        return Response.json(
          url.searchParams.get('startAt') === '0'
            ? {
                values: [
                  {
                    created: '2026-10-02T00:00:00Z',
                    items: [
                      {
                        field: 'status',
                        from: 'todo',
                        fromString: 'To Do',
                        to: 'doing',
                        toString: 'Doing',
                      },
                    ],
                  },
                ],
                total: 2,
                isLast: false,
              }
            : {
                values: [
                  {
                    created: '2026-10-05T00:00:00Z',
                    items: [
                      {
                        field: 'status',
                        from: 'doing',
                        fromString: 'Doing',
                        to: 'done',
                        toString: 'Done',
                      },
                    ],
                  },
                ],
                total: 2,
                isLast: true,
              },
        )
      throw new Error(`Unexpected test endpoint ${path}`)
    })
    const result = await client().loadBoard('DEMO', '1')
    expect(result.issues[0]?.browseUrl).toBe(`${site}/browse/DEMO-1`)
    expect(result.changes).toHaveLength(2)
    // Only GETs, plus the read-only bulk history POST.
    expect(
      mocks.fetch.mock.calls.every(
        (call) =>
          call[1].method === 'GET' ||
          String(call[0]).endsWith('/rest/api/3/changelog/bulkfetch'),
      ),
    ).toBe(true)
    expect(
      mocks.fetch.mock.calls.every(
        (call) =>
          call[1].headers.Authorization === 'Bearer fictional-server-token',
      ),
    ).toBe(true)
    expect(
      mocks.fetch.mock.calls.some((call) =>
        String(call[0]).includes('/rest/api/2/search'),
      ),
    ).toBe(false)
  })
  it('loads only recent activity on very large boards and says so', async () => {
    const boardQueries: string[] = []
    mocks.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input)
      const path = url.pathname.replace('/ex/jira/fictional-cloud-id', '')
      if (path === '/rest/agile/1.0/board')
        return Response.json({
          values: [{ id: 1, name: 'Fictional board' }],
          isLast: true,
        })
      if (path.endsWith('/configuration'))
        return Response.json({
          id: 1,
          name: 'Fictional board',
          columnConfig: {
            columns: [{ name: 'Done', statuses: [{ id: 'done' }] }],
          },
        })
      if (path === '/rest/api/3/status')
        return Response.json([{ id: 'done', name: 'Done' }])
      if (path === '/rest/software/1.0/board/1/issue') {
        const jql = url.searchParams.get('jql') ?? ''
        boardQueries.push(jql)
        return Response.json(
          jql.includes('-365d')
            ? { issues: [issue], isLast: true }
            : {
                issues: Array.from({ length: 5_001 }, (_, index) => ({
                  ...issue,
                  id: String(index),
                  key: `DEMO-${index}`,
                })),
                isLast: true,
              },
        )
      }
      if (path === '/rest/api/3/search/jql')
        return Response.json({ issues: [issue], isLast: true })
      if (path === '/rest/api/3/changelog/bulkfetch')
        return Response.json({ issueChangeLogs: [] })
      throw new Error(`Unexpected test endpoint ${path}`)
    })
    const events: Array<{ step: string; detail?: string }> = []
    const result = await client().loadBoard('DEMO', '1', undefined, (event) =>
      events.push(event),
    )
    expect(boardQueries).toHaveLength(2)
    expect(boardQueries[1]).toContain('updated >= -365d')
    expect(result.issues).toHaveLength(1)
    expect(result.historyWarnings?.[0]).toMatch(/last 12 months/)
    expect(events[0]).toEqual({
      step: 'board',
      label: 'Reading board settings',
    })
    expect(events).toContainEqual({
      step: 'items',
      label: 'Finding items on the board',
      detail: 'Large board: loading items active in the last 12 months',
    })
    expect(events).toContainEqual({
      step: 'history',
      label: 'Reading status history',
      detail: '1 of 1 items',
      done: 1,
      total: 1,
    })
    expect(events.at(-1)?.step).toBe('done')
    expect(events.length).toBeLessThan(100)
    // Counts and stage names only: no keys, summaries or credentials.
    expect(JSON.stringify(events)).not.toMatch(/DEMO-|fictional-server-token/)
  })

  it('reads status history in bulk, across pages, in one call per 1,000 items', async () => {
    const bulkBodies: Array<Record<string, unknown>> = []
    mocks.fetch.mockImplementation(
      async (input: string, init: { body?: string }) => {
        const url = new URL(input)
        const path = url.pathname.replace('/ex/jira/fictional-cloud-id', '')
        if (path === '/rest/agile/1.0/board')
          return Response.json({
            values: [{ id: 1, name: 'Fictional board' }],
            isLast: true,
          })
        if (path.endsWith('/configuration'))
          return Response.json({
            id: 1,
            name: 'Fictional board',
            columnConfig: {
              columns: [{ name: 'Done', statuses: [{ id: 'done' }] }],
            },
          })
        if (path === '/rest/api/3/status')
          return Response.json([{ id: 'done', name: 'Done' }])
        if (path === '/rest/software/1.0/board/1/issue')
          return Response.json({ issues: [issue], isLast: true })
        if (path === '/rest/api/3/search/jql') {
          expect(url.searchParams.has('expand')).toBe(false)
          return Response.json({ issues: [issue], isLast: true })
        }
        if (path === '/rest/api/3/changelog/bulkfetch') {
          const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
          bulkBodies.push(body)
          const change = (created: string, from: string, to: string) => ({
            created,
            items: [{ field: 'status', fieldId: 'status', from, to }],
          })
          return Response.json(
            body.nextPageToken
              ? {
                  issueChangeLogs: [
                    {
                      issueId: '10',
                      changeHistories: [
                        change('2026-10-05T00:00:00Z', 'doing', 'done'),
                      ],
                    },
                  ],
                  nextPageToken: null,
                }
              : {
                  issueChangeLogs: [
                    {
                      issueId: '10',
                      changeHistories: [
                        change('2026-10-02T00:00:00Z', 'todo', 'doing'),
                      ],
                    },
                  ],
                  nextPageToken: 'page-2',
                },
          )
        }
        throw new Error(`Unexpected test endpoint ${path}`)
      },
    )
    const result = await client().loadBoard('DEMO', '1')
    expect(result.changes).toHaveLength(2)
    expect(bulkBodies).toEqual([
      { issueIdsOrKeys: ['10'], fieldIds: ['status'], maxResults: 10000 },
      {
        issueIdsOrKeys: ['10'],
        fieldIds: ['status'],
        maxResults: 10000,
        nextPageToken: 'page-2',
      },
    ])
    expect(
      mocks.fetch.mock.calls.some((call) => call[0].endsWith('/changelog')),
    ).toBe(false)
  })

  it('fails explicitly when Cloud pagination does not progress', async () => {
    mocks.fetch.mockImplementation(async (input: string) =>
      String(input).includes('/rest/agile/1.0/board?')
        ? Response.json({
            values: [{ id: 1, name: 'Fictional board' }],
            isLast: true,
          })
        : String(input).includes('/rest/software/')
          ? Response.json({
              issues: [issue],
              isLast: false,
              nextPageToken: 'repeated',
            })
          : String(input).endsWith('/status')
            ? Response.json([])
            : Response.json({ columnConfig: { columns: [] } }),
    )
    await expect(client().loadBoard('DEMO', '1')).rejects.toThrow(
      'pagination did not complete',
    )
  })
  it('extracts bounded Cloud rich text without returning document attributes', () => {
    const evidence = normaliseJiraInvestigation(
      [
        {
          ...issue,
          fields: {
            ...issue.fields,
            description: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Fictional evidence.',
                      attrs: { private: 'discarded-private-attribute' },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      ['DEMO-1'],
    )
    expect(evidence.issues[0]?.description).toBe('Fictional evidence.')
    expect(JSON.stringify(evidence)).not.toContain(
      'discarded-private-attribute',
    )
  })
})

describe('Jira Cloud bulk changelog dates', () => {
  it('reads epoch-number dates as real times, in order', async () => {
    const at = (iso: string) => Date.parse(iso)
    mocks.fetch.mockImplementation(async (input: string) => {
      const url = new URL(input)
      const path = url.pathname.replace('/ex/jira/fictional-cloud-id', '')
      if (path === '/rest/api/3/changelog/bulkfetch')
        return Response.json({
          issueChangeLogs: [
            {
              issueId: '10',
              // Cloud's bulk changelog sends epoch milliseconds, newest first here.
              changeHistories: [
                {
                  created: at('2026-10-05T00:00:00Z'),
                  items: [{ fieldId: 'status', from: 'doing', to: 'done' }],
                },
                {
                  created: at('2026-10-02T00:00:00Z'),
                  items: [{ fieldId: 'status', from: 'todo', to: 'doing' }],
                },
              ],
            },
          ],
        })
      if (path === '/rest/agile/1.0/board')
        return Response.json({
          values: [{ id: 1, name: 'Fictional board' }],
          isLast: true,
        })
      if (path.endsWith('/configuration'))
        return Response.json({
          id: 1,
          name: 'Fictional board',
          columnConfig: {
            columns: [
              { name: 'Doing', statuses: [{ id: 'doing' }] },
              { name: 'Done', statuses: [{ id: 'done' }] },
            ],
          },
        })
      if (path === '/rest/api/3/status')
        return Response.json([
          { id: 'doing', name: 'Doing' },
          { id: 'done', name: 'Done' },
        ])
      if (path === '/rest/software/1.0/board/1/issue')
        return Response.json({ issues: [issue], isLast: true })
      if (path === '/rest/api/3/search/jql')
        return Response.json({ issues: [issue], isLast: true })
      throw new Error(`Unexpected test endpoint ${path}`)
    })
    const result = await client().loadBoard('DEMO', '1')
    expect(result.changes.map((change) => change.changedAt)).toEqual([
      '2026-10-02T00:00:00.000Z',
      '2026-10-05T00:00:00.000Z',
    ])
  })

  it('normalises text, epoch seconds and milliseconds, and drops the rest', () => {
    expect(normaliseTimestamp('2026-10-25T09:12:00.000+0200')).toBe(
      '2026-10-25T07:12:00.000Z',
    )
    expect(normaliseTimestamp(1761376320)).toBe('2025-10-25T07:12:00.000Z')
    expect(normaliseTimestamp(1761376320000)).toBe('2025-10-25T07:12:00.000Z')
    expect(normaliseTimestamp('1761376320000')).toBe('2025-10-25T07:12:00.000Z')
    expect(normaliseTimestamp(undefined)).toBe('')
    expect(normaliseTimestamp({})).toBe('')
  })
})
