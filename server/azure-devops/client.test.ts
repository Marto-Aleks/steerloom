// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AzureDevOpsClient, AzureDevOpsError, identityName } from './client'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<
    (
      input: URL,
      init: {
        method?: string
        headers: Record<string, string>
        body?: string
      },
    ) => Promise<Response>
  >(),
}))
vi.mock('undici', () => ({ fetch: mocks.fetch, ProxyAgent: class {} }))
afterEach(() => vi.resetAllMocks())

const TEAM = '11111111-2222-3333-4444-555555555555'
const org = 'https://dev.azure.com/contoso'
const client = () =>
  new AzureDevOpsClient({ orgUrl: org, project: 'Web App', token: 'pat' })
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

function route(answers: Record<string, unknown>) {
  mocks.fetch.mockImplementation(async (input) => {
    const path = decodeURIComponent(input.pathname).replace('/contoso', '')
    const answer = answers[path]
    if (answer === undefined) throw new Error(`Unexpected request ${path}`)
    return json(
      typeof answer === 'function'
        ? (answer as (url: URL) => unknown)(input)
        : answer,
    )
  })
}

describe('AzureDevOpsClient', () => {
  it('sends the token as Basic auth and lists teams as boards', async () => {
    route({
      '/_apis/projects/Web App/teams': {
        value: [
          { id: 'b', name: 'Platform' },
          { id: 'a', name: 'Checkout' },
        ],
      },
    })
    expect(await client().boards()).toEqual([
      { id: 'a', name: 'Checkout' },
      { id: 'b', name: 'Platform' },
    ])
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url.searchParams.get('api-version')).toBe('6.0')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from(':pat').toString('base64')}`,
    )
  })

  it('reads the team board, its items and their changes on the board', async () => {
    route({
      [`/_apis/projects/Web App/teams/${TEAM}`]: { name: 'Checkout' },
      [`/Web App/${TEAM}/_apis/work/backlogs`]: {
        value: [
          {
            name: 'Features',
            type: 'portfolio',
            workItemTypes: [{ name: 'Feature' }],
          },
          {
            name: 'Stories',
            type: 'requirement',
            workItemTypes: [{ name: 'User Story' }, { name: 'Bug' }],
          },
        ],
      },
      [`/Web App/${TEAM}/_apis/work/teamsettings/teamfieldvalues`]: {
        field: { referenceName: 'System.AreaPath' },
        values: [{ value: "Web App\\Checkout's", includeChildren: true }],
      },
      [`/Web App/${TEAM}/_apis/work/boards/Stories`]: {
        columns: [
          {
            id: 'c1',
            name: 'New',
            columnType: 'incoming',
            stateMappings: { 'User Story': 'New' },
          },
          {
            id: 'c2',
            name: 'Develop',
            columnType: 'inProgress',
            isSplit: true,
            stateMappings: { 'User Story': 'Active' },
          },
          {
            id: 'c3',
            name: 'Closed',
            columnType: 'outgoing',
            stateMappings: { 'User Story': 'Closed' },
          },
        ],
        fields: {
          columnField: { referenceName: 'WEF_X_Kanban.Column' },
          doneField: { referenceName: 'WEF_X_Kanban.Column.Done' },
        },
      },
      '/Web App/_apis/wit/workitemtypes/User Story/states': {
        value: [
          { name: 'New', category: 'Proposed' },
          { name: 'Active', category: 'InProgress' },
          { name: 'Closed', category: 'Completed' },
        ],
      },
      '/Web App/_apis/wit/workitemtypes/Bug/states': { value: [] },
      [`/Web App/${TEAM}/_apis/wit/wiql`]: () => ({
        workItems: [{ id: 7 }],
      }),
      '/Web App/_apis/wit/reporting/workitemrevisions': (url: URL) =>
        url.searchParams.get('continuationToken')
          ? { values: [], isLastBatch: true }
          : {
              continuationToken: 'next',
              isLastBatch: false,
              values: [
                // Another team's item is left out.
                {
                  id: 8,
                  rev: 1,
                  fields: {
                    'System.State': 'New',
                    'System.ChangedDate': '2026-01-01T00:00:00Z',
                  },
                },
                ...[
                  ['New', 'New', false, '2026-01-01T00:00:00Z'],
                  ['New', 'New', false, '2026-01-01T05:00:00Z'], // a title edit
                  ['Active', 'Develop', false, '2026-01-02T00:00:00Z'],
                  ['Active', 'Develop', true, '2026-01-04T00:00:00Z'],
                ].map(([state, column, done, at], index) => ({
                  id: 7,
                  rev: index + 1,
                  fields: {
                    'System.WorkItemType': 'User Story',
                    'System.State': state,
                    'System.CreatedDate': '2026-01-01T00:00:00Z',
                    'System.ChangedDate': at,
                    'WEF_X_Kanban.Column': column,
                    'WEF_X_Kanban.Column.Done': done,
                    // Reassigned on the last revision: the latest owner wins.
                    ...(index === 2
                      ? {
                          'System.AssignedTo':
                            'Dana Fictional <dana@example.invalid>',
                        }
                      : index === 3
                        ? {
                            'System.AssignedTo': {
                              displayName: 'Priya Fictional',
                            },
                          }
                        : {}),
                  },
                })),
              ],
            },
    })
    const history = await client().history(TEAM)
    const wiqlCall = mocks.fetch.mock.calls.find(([url]) =>
      url.pathname.endsWith('/wiql'),
    )!
    const wiql = (JSON.parse(wiqlCall[1].body!) as { query: string }).query
    expect(wiqlCall[1].method).toBe('POST')
    expect(wiql).toContain("[System.WorkItemType] IN ('User Story', 'Bug')")
    expect(wiql).toContain("[System.AreaPath] UNDER 'Web App\\Checkout''s'")
    expect(history.board).toEqual({ id: TEAM, name: 'Checkout' })
    expect(history.itemUrlPrefix).toBe(`${org}/Web%20App/_workitems/edit/`)
    expect(history.items).toEqual([
      {
        id: 7,
        type: 'User Story',
        createdAt: '2026-01-01T00:00:00Z',
        assignee: 'Priya Fictional',
        revisions: [
          { at: '2026-01-01T00:00:00Z', state: 'New', column: 'New' },
          { at: '2026-01-02T00:00:00Z', state: 'Active', column: 'Develop' },
          {
            at: '2026-01-04T00:00:00Z',
            state: 'Active',
            column: 'Develop',
            done: true,
          },
        ],
      },
    ])
    expect(history.stateCategories['User Story']?.Active).toBe('InProgress')
    expect(history.columns[1]).toMatchObject({ name: 'Develop', isSplit: true })
  })

  it('explains a rejected token, which Azure DevOps answers with a sign-in page', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('<html>Sign in</html>', { status: 203 }),
    )
    const failure = await client()
      .verify()
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AzureDevOpsError)
    expect(failure).toMatchObject({ reason: 'azure-token-rejected' })
  })

  it('refuses board ids that are not team ids', async () => {
    await expect(client().history('../../_apis')).rejects.toThrow(
      'Choose a team board.',
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('keeps only the name of whoever an item is assigned to', () => {
    expect(identityName({ displayName: ' Dana Fictional ' })).toBe(
      'Dana Fictional',
    )
    expect(identityName('Priya Fictional <priya@example.invalid>')).toBe(
      'Priya Fictional',
    )
    expect(identityName(undefined)).toBe('')
    expect(identityName(42)).toBe('')
  })
})
