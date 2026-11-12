// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  azureSearchWiql,
  filterItems,
  jiraSearchJql,
  readSearch,
} from './board-reader'
import { azureReader, plainText, trelloReader } from './board-readers'
import type { TrelloClient } from '../trello/client'
import type { AzureDevOpsClient } from '../azure-devops/client'

describe('searches the model can ask for', () => {
  it('reads only known filters, within limits', () => {
    expect(
      readSearch({
        text: 'zoom',
        state: 'open',
        limit: 400,
        not_updated_for_days: 14.4,
        updated_within_days: -3,
        anything: 'else',
      }),
    ).toEqual({ text: 'zoom', state: 'open', limit: 25, notUpdatedForDays: 14 })
  })

  it('builds JQL inside the project, with text reduced to words', () => {
    const jql = jiraSearchJql(
      'DEMO',
      {
        text: 'zoom" OR project = SECRET -- ~',
        status: 'In "Review"',
        assignee: 'unassigned',
        parent: 'demo-7',
        state: 'open',
        notUpdatedForDays: 14,
      },
      false,
    )
    expect(jql).toBe(
      'project = "DEMO" AND text ~ "zoom OR project SECRET" AND status = "In \\"Review\\"" AND assignee is EMPTY AND (parent = DEMO-7 OR "Epic Link" = DEMO-7) AND statusCategory != Done AND updated <= -14d ORDER BY updated DESC',
    )
    expect(jiraSearchJql('DEMO', { parent: 'DEMO-7' }, true)).toContain(
      'parent = DEMO-7 ORDER BY',
    )
    // A parent that is not a key is left out rather than passed through.
    expect(
      jiraSearchJql('DEMO', { parent: 'x) OR (1=1' }, false),
    ).not.toContain('parent')
  })

  it('builds WIQL inside the project with quotes escaped', () => {
    expect(
      azureSearchWiql({
        text: "it's",
        type: 'Bug',
        parent: '#42',
        state: 'done',
        updatedWithinDays: 7,
      }),
    ).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS 'it''s' AND [System.WorkItemType] = 'Bug' AND [System.Parent] = 42 AND [System.State] IN ('Done', 'Closed', 'Completed', 'Resolved', 'Removed') AND [System.ChangedDate] >= @today - 7 ORDER BY [System.ChangedDate] DESC",
    )
  })

  it('matches assignee names and, on Trello, every filter in memory', () => {
    const now = Date.parse('2026-09-10T00:00:00Z')
    const base = {
      issueType: 'Card',
      statusCategory: 'Open',
      priority: 'Not supplied',
      components: [],
    }
    const items = [
      {
        ...base,
        key: 'CARD-1',
        summary: 'Zoom bug',
        status: 'Doing',
        assignee: 'Ana Lima',
        updatedAt: '2026-09-09T00:00:00Z',
      },
      {
        ...base,
        key: 'CARD-2',
        summary: 'Other',
        status: 'Doing',
        assignee: null,
        updatedAt: '2026-08-01T00:00:00Z',
      },
    ]
    expect(filterItems(items, { assignee: 'lima' }).map((i) => i.key)).toEqual([
      'CARD-1',
    ])
    expect(
      filterItems(
        items,
        { notUpdatedForDays: 30, status: 'doing' },
        { inMemory: true, now },
      ).map((i) => i.key),
    ).toEqual(['CARD-2'])
    expect(
      filterItems(items, { assignee: 'unassigned' }).map((i) => i.key),
    ).toEqual(['CARD-2'])
  })
})

describe('Trello as the assistant reads it', () => {
  const board = {
    lists: [
      { id: 'l1', name: 'Doing' },
      { id: 'l2', name: 'Review' },
    ],
    cards: [
      {
        id: 'a'.repeat(24),
        idShort: 12,
        name: 'Image zoom',
        idList: 'l1',
        idMembers: ['m1'],
        dateLastActivity: '2026-09-01T10:00:00Z',
        labels: [{ name: 'Bug' }],
      },
      {
        id: 'b'.repeat(24),
        idShort: 13,
        name: 'Checkout copy',
        idList: 'l2',
        idMembers: [],
        dateLastActivity: '2026-09-09T10:00:00Z',
      },
    ],
    members: [{ id: 'm1', fullName: 'Ana Lima' }],
  }
  const card = {
    desc: 'Zoom stays on the first photo.',
    actions: [
      {
        type: 'commentCard',
        date: '2026-09-02T10:00:00Z',
        data: { text: 'Blocked on the design decision.' },
        memberCreator: { fullName: 'Ben' },
      },
      {
        type: 'updateCard',
        date: '2026-08-30T10:00:00Z',
        data: { listBefore: { name: 'To do' }, listAfter: { name: 'Doing' } },
        memberCreator: { fullName: 'Ana Lima' },
      },
    ],
    checklists: [
      {
        name: 'Done when',
        checkItems: [
          { name: 'Pinch works', state: 'complete' },
          { name: 'Swipe works', state: 'incomplete' },
        ],
      },
    ],
  }
  const client = {
    aiBoard: () => Promise.resolve(board),
    aiCard: () => Promise.resolve(card),
  } as unknown as TrelloClient
  const reader = trelloReader(client, 'f'.repeat(24))

  it('finds cards by person, list and label, and reads one in full', async () => {
    expect(reader.normaliseKey('#12')).toBe('CARD-12')
    const found = await reader.search({
      assignee: 'ana',
      type: 'bug',
      limit: 5,
    })
    expect(found.items.map((item) => item.key)).toEqual(['CARD-12'])
    expect(found.items[0]).toMatchObject({
      status: 'Doing',
      assignee: 'Ana Lima',
      labels: ['Bug'],
    })
    const { items, unavailable } = await reader.items(
      ['CARD-12', 'CARD-99'],
      true,
    )
    expect(unavailable).toEqual(['CARD-99'])
    expect(items[0]!.description).toContain('1 of 2 done; open: Swipe works')
    expect(items[0]!.comments).toEqual([
      expect.objectContaining({
        author: 'Ben',
        body: 'Blocked on the design decision.',
      }),
    ])
    expect(items[0]!.history).toEqual([
      expect.objectContaining({
        field: 'List',
        fromValue: 'To do',
        toValue: 'Doing',
      }),
    ])
  })
})

describe('Azure DevOps as the assistant reads it', () => {
  const workItem = (
    id: number,
    fields: Record<string, unknown>,
    relations?: unknown[],
  ) => ({ id, fields, ...(relations ? { relations } : {}) })
  const items = new Map([
    [
      7,
      workItem(
        7,
        {
          'System.Title': 'Checkout',
          'System.State': 'Active',
          'System.WorkItemType': 'User Story',
          'System.AssignedTo': { displayName: 'Ana Lima' },
          'System.ChangedDate': '2026-09-01T10:00:00Z',
          'System.Description': '<p>Pay with <b>cards</b>&nbsp;too</p>',
        },
        [
          {
            rel: 'System.LinkTypes.Dependency-Reverse',
            url: 'https://dev.azure.com/o/_apis/wit/workItems/8',
          },
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/o/_apis/wit/workItems/9',
          },
        ],
      ),
    ],
    [
      8,
      workItem(8, {
        'System.Title': 'Payment API',
        'System.State': 'New',
        'System.WorkItemType': 'Task',
      }),
    ],
    [
      9,
      workItem(9, {
        'System.Title': 'Payments epic',
        'System.State': 'Active',
        'System.WorkItemType': 'Epic',
      }),
    ],
  ])
  const queries: string[] = []
  const client = {
    aiQuery: (wiql: string) => {
      queries.push(wiql)
      return Promise.resolve([7])
    },
    aiWorkItems: (ids: number[]) =>
      Promise.resolve(
        ids.flatMap((id) => (items.get(id) ? [items.get(id)!] : [])),
      ),
    aiComments: () =>
      Promise.resolve([
        {
          text: '<div>Waiting on <i>#8</i></div>',
          createdBy: { displayName: 'Ben' },
          createdDate: '2026-09-02T10:00:00Z',
        },
      ]),
    aiUpdates: () =>
      Promise.resolve([
        {
          revisedBy: { displayName: 'Ana Lima' },
          revisedDate: '9999-01-01T00:00:00Z',
          fields: {
            'System.ChangedDate': { newValue: '2026-08-30T10:00:00Z' },
            'System.State': { oldValue: 'New', newValue: 'Active' },
          },
        },
      ]),
  } as unknown as AzureDevOpsClient
  const reader = azureReader(client)

  it('reads a work item with its links, parent, comments and history', async () => {
    expect(reader.normaliseKey('7')).toBe('#7')
    const { items: read } = await reader.items(['#7'], true)
    expect(read[0]).toMatchObject({
      key: '#7',
      assignee: 'Ana Lima',
      statusCategory: 'In Progress',
      description: 'Pay with cards too',
      parent: { key: '#9', summary: 'Payments epic' },
      links: [{ relationship: 'depends on', key: '#8', status: 'New' }],
      comments: [{ author: 'Ben', body: 'Waiting on #8' }],
      history: [
        {
          field: 'Status',
          fromValue: 'New',
          toValue: 'Active',
          changedAt: '2026-08-30T10:00:00.000Z',
        },
      ],
    })
  })

  it('searches with WIQL and matches names afterwards', async () => {
    const found = await reader.search({ assignee: 'ana', state: 'open' })
    expect(found.items.map((item) => item.key)).toEqual(['#7'])
    expect(queries.at(-1)).toContain('NOT IN')
    expect(queries.at(-1)).not.toContain('AssignedTo')
  })

  it('reads HTML as text', () => {
    expect(plainText('<p>a&amp;b</p><p>c</p>', 100)).toBe('a&b\nc')
  })
})
