import { describe, expect, it } from 'vitest'
import type {
  FlowBoardSnapshot,
  FlowColumnMapping,
  ImportedDataset,
} from '../../types'
import {
  buildLocalBoardSnapshot,
  localColumnId,
  suggestLocalBoardColumns,
} from './local-transition'

const mapping: FlowColumnMapping = {
  itemId: 'key',
  itemType: 'type',
  createdDate: 'created',
  status: 'status',
  transitionDate: 'changed',
}

const dataset: ImportedDataset = {
  filename: 'history.csv',
  delimiter: ',',
  importedAt: '2026-07-24T12:00:00Z',
  columns: ['key', 'type', 'created', 'status', 'changed'],
  rows: [
    {
      key: 'ABC-1',
      type: 'Story',
      created: '2026-07-01',
      status: 'Backlog',
      changed: '2026-07-01T09:00:00Z',
    },
    {
      key: 'ABC-1',
      type: 'Story',
      created: '2026-07-01',
      status: 'In Progress',
      changed: '2026-07-03T09:00:00Z',
    },
    {
      key: 'ABC-1',
      type: 'Story',
      created: '2026-07-01',
      status: 'Code Review',
      changed: '2026-07-05T09:00:00Z',
    },
  ],
}

describe('local transition data source', () => {
  it('normalises CSV rows into the same board snapshot used by API sources', () => {
    const snapshot = buildLocalBoardSnapshot(dataset, mapping)

    expect(snapshot.source.kind).toBe('local-transition-csv')
    expect(snapshot.issues).toHaveLength(1)
    expect(snapshot.transitions).toHaveLength(3)
    expect(snapshot.board.columns.map((column) => column.name)).toEqual([
      'Backlog',
      'In Progress',
      'Code Review',
    ])
    expect(suggestLocalBoardColumns(snapshot)).toEqual([
      localColumnId('In Progress'),
      localColumnId('Code Review'),
    ])
  })

  // A board reduced to what the suggestion reads: columns and statuses.
  const board = (
    columns: Array<[name: string, category?: 'todo' | 'in-progress' | 'done']>,
    kind: FlowBoardSnapshot['source']['kind'] = 'jira-data-center',
  ): FlowBoardSnapshot => ({
    source: { kind, label: 'Fictional board' },
    board: {
      id: 'fictional',
      name: 'Fictional board',
      statuses: columns.map(([name, category]) => ({
        id: `status-${name}`,
        name,
        ...(category ? { category } : {}),
      })),
      columns: columns.map(([name]) => ({
        id: `column-${name}`,
        name,
        statusIds: [`status-${name}`],
      })),
    },
    issues: [],
    transitions: [],
    loadedAt: '2026-11-12T09:00:00Z',
  })

  it('suggests the stages Jira itself calls in progress, whatever their names', () => {
    expect(
      suggestLocalBoardColumns(
        board([
          ['Offen', 'todo'],
          ['In Arbeit', 'in-progress'],
          ['Abnahme', 'in-progress'],
          ['Erledigt', 'done'],
        ]),
      ),
    ).toEqual(['column-In Arbeit', 'column-Abnahme'])
  })

  it('never suggests a column that holds no statuses', () => {
    const snapshot = board([
      ['To Do', 'todo'],
      ['In Progress', 'in-progress'],
      ['Done', 'done'],
    ])
    snapshot.board.columns.splice(1, 0, {
      id: 'column-empty',
      name: 'Unmapped',
      statusIds: [],
    })
    expect(suggestLocalBoardColumns(snapshot)).toEqual(['column-In Progress'])
  })

  it('without categories or known names, suggests the columns between the first and the last, not the backlog', () => {
    expect(
      suggestLocalBoardColumns(
        board(
          [['Ideen'], ['Wird gemacht'], ['Wird geprüft'], ['Fertig']],
          'trello',
        ),
      ),
    ).toEqual(['column-Wird gemacht', 'column-Wird geprüft'])
    // Known names still win, and "Doing" is one of them.
    expect(
      suggestLocalBoardColumns(
        board([['To do'], ['Doing'], ['Review'], ['Done']], 'trello'),
      ),
    ).toEqual(['column-Doing', 'column-Review'])
    // Two columns leave nothing between: the first, as before.
    expect(
      suggestLocalBoardColumns(board([['Open'], ['Closed']], 'trello')),
    ).toEqual(['column-Open'])
  })
})
