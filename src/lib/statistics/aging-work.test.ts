import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot } from '../../types'
import { agingBaselineState, collectAgingWork } from './aging-work'
import { findDelayedWorkInProgress } from '.'

const snapshot: FlowBoardSnapshot = {
  source: { kind: 'demo', label: 'Fictional team' },
  board: {
    id: 'sample',
    name: 'Fictional team',
    columns: [
      { id: 'active', name: 'Development', statusIds: ['doing', 'review'] },
      { id: 'done', name: 'Done', statusIds: ['done'] },
    ],
    statuses: [
      { id: 'doing', name: 'Doing' },
      { id: 'review', name: 'Review' },
      { id: 'done', name: 'Done' },
    ],
  },
  loadedAt: '2026-10-13T12:00:00Z',
  issues: [
    {
      id: 'one',
      key: 'DEMO-1',
      issueTypeId: 'story',
      issueTypeName: 'Story',
      createdAt: '2026-10-01T12:00:00Z',
    },
  ],
  transitions: [
    { issueId: 'one', statusId: 'doing', enteredAt: '2026-10-01T12:00:00Z' },
    { issueId: 'one', statusId: 'review', enteredAt: '2026-10-03T12:00:00Z' },
    { issueId: 'one', statusId: 'done', enteredAt: '2026-10-04T12:00:00Z' },
    { issueId: 'one', statusId: 'doing', enteredAt: '2026-10-10T12:00:00Z' },
    { issueId: 'one', statusId: 'review', enteredAt: '2026-10-12T12:00:00Z' },
  ],
}

describe('all active work age', () => {
  it('separates accumulated measured age from the latest continuous stage visit', () => {
    const [item] = collectAgingWork(snapshot, ['active'])
    expect(item).toMatchObject({
      item: 'DEMO-1',
      column: 'Development',
      currentStatus: 'Review',
      ageInSelectedColumns: 6,
      currentStageAgeDays: 3,
    })
    expect(
      item?.history.map((visit) => [visit.durationDays, visit.measured]),
    ).toEqual([
      [2, true],
      [1, true],
      [6, false],
      [2, true],
      [1, true],
    ])
    expect(
      findDelayedWorkInProgress(snapshot, ['active'], 5)[0]
        ?.ageInSelectedColumns,
    ).toBe(6)
    expect(findDelayedWorkInProgress(snapshot, ['active'], 6)).toEqual([])
  })
  it('includes newly started work at age zero without needing a completed baseline', () => {
    const input = {
      ...snapshot,
      transitions: [
        { issueId: 'one', statusId: 'doing', enteredAt: snapshot.loadedAt },
      ],
    }
    expect(collectAgingWork(input, ['active'])[0]?.ageInSelectedColumns).toBe(0)
    expect(agingBaselineState(0, null)).toBe('unavailable')
    expect(agingBaselineState(5, 5)).toBe('within')
    expect(agingBaselineState(5.1, 5)).toBe('beyond')
    expect(agingBaselineState(5, Number.NaN)).toBe('unavailable')
  })
  it('excludes archived, completed, unmeasured, and missing-history items', () => {
    expect(
      collectAgingWork(
        { ...snapshot, issues: [{ ...snapshot.issues[0]!, archived: true }] },
        ['active'],
      ),
    ).toEqual([])
    expect(
      collectAgingWork(
        {
          ...snapshot,
          transitions: [
            ...snapshot.transitions,
            { issueId: 'one', statusId: 'done', enteredAt: snapshot.loadedAt },
          ],
        },
        ['active'],
      ),
    ).toEqual([])
    expect(collectAgingWork(snapshot, ['done'])).toEqual([])
    expect(
      collectAgingWork({ ...snapshot, transitions: [] }, ['active']),
    ).toEqual([])
    expect(
      collectAgingWork({ ...snapshot, loadedAt: 'invalid' }, ['active']),
    ).toEqual([])
  })
  it('deduplicates items and repeated status events, ignores invalid and future events, and handles unordered history', () => {
    const input = {
      ...snapshot,
      issues: [...snapshot.issues, snapshot.issues[0]!],
      transitions: [
        ...snapshot.transitions,
        {
          issueId: 'one',
          statusId: 'review',
          enteredAt: '2026-10-12T18:00:00Z',
        },
        { issueId: 'one', statusId: 'done', enteredAt: '2026-10-15T12:00:00Z' },
        { issueId: 'one', statusId: 'done', enteredAt: 'invalid' },
      ].reverse(),
    }
    const result = collectAgingWork(input, ['active'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      ageInSelectedColumns: 6,
      currentStageAgeDays: 3,
    })
    expect(result[0]?.history).toHaveLength(5)
    expect(input.transitions[0]?.enteredAt).toBe('invalid')
  })
})
