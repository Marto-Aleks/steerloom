import { describe, expect, it } from 'vitest'
import { calculateBoardMetrics } from '../statistics'
import { boardJourneys } from '../statistics/journey'
import { normalizeAzureBoard, type AzureBoardHistory } from './azure-devops'
import { suggestLocalBoardColumns } from './local-transition'

function payload(): AzureBoardHistory {
  return {
    board: { id: 'team-1', name: 'Web Team' },
    itemUrlPrefix: 'https://dev.azure.com/contoso/Web/_workitems/edit/',
    columns: [
      {
        id: 'c-new',
        name: 'New',
        columnType: 'incoming',
        isSplit: false,
        stateMappings: { 'User Story': 'New', Bug: 'New' },
      },
      {
        id: 'c-dev',
        name: 'Develop',
        columnType: 'inProgress',
        isSplit: true,
        stateMappings: { 'User Story': 'Active', Bug: 'Active' },
      },
      {
        id: 'c-closed',
        name: 'Closed',
        columnType: 'outgoing',
        isSplit: false,
        stateMappings: { 'User Story': 'Closed', Bug: 'Closed' },
      },
    ],
    stateCategories: {
      'User Story': {
        New: 'Proposed',
        Active: 'InProgress',
        Closed: 'Completed',
        Removed: 'Removed',
      },
      Bug: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed' },
    },
    items: [
      {
        id: 1,
        type: 'User Story',
        title: 'Fictional sign-in story',
        createdAt: '2026-01-01T09:00:00Z',
        revisions: [
          { at: '2026-01-01T09:00:00Z', state: 'New', column: 'New' },
          { at: '2026-01-02T09:00:00Z', state: 'Active', column: 'Develop' },
          {
            at: '2026-01-04T09:00:00Z',
            state: 'Active',
            column: 'Develop',
            done: true,
          },
          { at: '2026-01-05T09:00:00Z', state: 'Closed', column: 'Closed' },
        ],
      },
    ],
  }
}

describe('normalizeAzureBoard', () => {
  it('turns board columns into stages, with split columns as two statuses', () => {
    const snapshot = normalizeAzureBoard(payload(), '2026-02-01T00:00:00Z')
    expect(snapshot.source.kind).toBe('azure-devops')
    expect(snapshot.board.columns).toEqual([
      { id: 'c-new', name: 'New', statusIds: ['c-new'] },
      { id: 'c-dev', name: 'Develop', statusIds: ['c-dev', 'c-dev:done'] },
      { id: 'c-closed', name: 'Closed', statusIds: ['c-closed'] },
    ])
    expect(snapshot.issues[0]).toMatchObject({
      id: '1',
      key: '#1',
      issueTypeName: 'User Story',
      title: 'Fictional sign-in story',
      browseUrl: 'https://dev.azure.com/contoso/Web/_workitems/edit/1',
    })
    expect(snapshot.transitions.map((event) => event.statusId)).toEqual([
      'c-new',
      'c-dev',
      'c-dev:done',
      'c-closed',
    ])
    // Develop, including its Done part, from Jan 2 to Jan 5.
    expect(calculateBoardMetrics(snapshot, ['c-dev'])?.medianCycleTime).toBe(3)
  })

  it('suggests the columns the board marks as in progress', () => {
    const snapshot = normalizeAzureBoard(payload(), '2026-02-01T00:00:00Z')
    expect(suggestLocalBoardColumns(snapshot)).toEqual(['c-dev'])
  })

  it('places items without a board column by their state', () => {
    const data = payload()
    data.items = [
      {
        id: 2,
        type: 'Bug',
        createdAt: '2026-01-01T09:00:00Z',
        revisions: [
          { at: '2026-01-01T09:00:00Z', state: 'New' },
          { at: '2026-01-03T09:00:00Z', state: 'Active' },
        ],
      },
    ]
    const snapshot = normalizeAzureBoard(data, '2026-02-01T00:00:00Z')
    expect(snapshot.transitions.map((event) => event.statusId)).toEqual([
      'c-new',
      'c-dev',
    ])
  })

  it('treats removed work as cancelled, not delivered', () => {
    const data = payload()
    data.items = [
      {
        id: 3,
        type: 'User Story',
        createdAt: '2026-01-01T09:00:00Z',
        revisions: [
          { at: '2026-01-01T09:00:00Z', state: 'New', column: 'New' },
          { at: '2026-01-02T09:00:00Z', state: 'Active', column: 'Develop' },
          // The column value stays behind when work is removed.
          { at: '2026-01-03T09:00:00Z', state: 'Removed', column: 'Develop' },
        ],
      },
    ]
    const snapshot = normalizeAzureBoard(data, '2026-02-01T00:00:00Z')
    expect(snapshot.issues[0]?.resolution).toBe('Removed')
    expect(snapshot.board.statuses.at(-1)).toEqual({
      id: 'state:Removed',
      name: 'Removed',
      category: 'done',
    })
    expect(boardJourneys(snapshot, ['c-dev']).get('3')?.outcome).toBe(
      'cancelled',
    )
    // Counted with the board's final column, so no status is left unmapped.
    expect(snapshot.board.columns.at(-1)?.statusIds).toEqual([
      'c-closed',
      'state:Removed',
    ])
  })

  it('trusts the state when the board column disagrees with it', () => {
    const data = payload()
    data.items = [
      {
        id: 5,
        type: 'User Story',
        createdAt: '2026-01-01T09:00:00Z',
        revisions: [
          { at: '2026-01-01T09:00:00Z', state: 'New', column: 'New' },
          { at: '2026-01-02T09:00:00Z', state: 'Closed', column: 'New' },
        ],
      },
    ]
    const snapshot = normalizeAzureBoard(data, '2026-02-01T00:00:00Z')
    expect(snapshot.transitions.map((event) => event.statusId)).toEqual([
      'c-new',
      'c-closed',
    ])
  })

  it('leaves out items whose history cannot be read, and says so', () => {
    const data = payload()
    data.items.push({ id: 4, type: 'Bug', createdAt: 'never', revisions: [] })
    const snapshot = normalizeAzureBoard(data, '2026-02-01T00:00:00Z')
    expect(snapshot.issues).toHaveLength(1)
    expect(snapshot.historyWarnings).toEqual([
      '1 work item was excluded because its history could not be read.',
    ])
  })
})
