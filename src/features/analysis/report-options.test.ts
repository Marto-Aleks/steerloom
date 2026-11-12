import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot } from '../../types'
import { countItemsByColumn, describeMeasuredStages } from './report-options'

const board: FlowBoardSnapshot['board'] = {
  id: 'board',
  name: 'Fictional board',
  statuses: [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'Doing' },
    { id: 'review', name: 'Review' },
    { id: 'done', name: 'Done' },
  ],
  columns: [
    { id: 'col-todo', name: 'To do', statusIds: ['todo'] },
    { id: 'col-active', name: 'Active', statusIds: ['doing', 'review'] },
    { id: 'col-done', name: 'Done', statusIds: ['done'] },
  ],
}

const issue = (id: string, archived = false) => ({
  id,
  key: id.toUpperCase(),
  issueTypeId: 'story',
  issueTypeName: 'Story',
  createdAt: '2026-01-01T00:00:00Z',
  ...(archived ? { archived } : {}),
})

describe('countItemsByColumn', () => {
  it('counts each live item once, in the column of its latest status', () => {
    const snapshot: FlowBoardSnapshot = {
      source: { kind: 'demo', label: 'demo' },
      board,
      issues: [issue('a'), issue('b'), issue('c'), issue('d', true)],
      transitions: [
        { issueId: 'a', statusId: 'todo', enteredAt: '2026-01-02T00:00:00Z' },
        { issueId: 'a', statusId: 'doing', enteredAt: '2026-01-03T00:00:00Z' },
        // Out-of-order rows: the latest timestamp wins, not the last row.
        { issueId: 'b', statusId: 'done', enteredAt: '2026-01-09T00:00:00Z' },
        { issueId: 'b', statusId: 'review', enteredAt: '2026-01-05T00:00:00Z' },
        { issueId: 'c', statusId: 'todo', enteredAt: '2026-01-02T00:00:00Z' },
        {
          issueId: 'c',
          statusId: 'unmapped',
          enteredAt: '2026-01-04T00:00:00Z',
        },
        { issueId: 'd', statusId: 'doing', enteredAt: '2026-01-04T00:00:00Z' },
        {
          issueId: 'ghost',
          statusId: 'doing',
          enteredAt: '2026-01-04T00:00:00Z',
        },
        { issueId: 'a', statusId: 'done', enteredAt: 'not a date' },
      ],
      loadedAt: '2026-01-10T00:00:00Z',
    }
    expect(countItemsByColumn(snapshot)).toEqual({
      'col-todo': 0,
      'col-active': 1,
      'col-done': 1,
    })
  })

  it('returns zero for every column when nothing has moved', () => {
    expect(
      countItemsByColumn({
        source: { kind: 'demo', label: 'demo' },
        board,
        issues: [],
        transitions: [],
        loadedAt: '2026-01-10T00:00:00Z',
      }),
    ).toEqual({ 'col-todo': 0, 'col-active': 0, 'col-done': 0 })
  })
})

describe('describeMeasuredStages', () => {
  it('lists selected stages in board order joined by arrows', () => {
    expect(
      describeMeasuredStages(board.columns, ['col-done', 'col-active']),
    ).toBe('Active → Done')
    expect(describeMeasuredStages(board.columns, [])).toBe(
      'Nothing selected yet',
    )
  })
})
