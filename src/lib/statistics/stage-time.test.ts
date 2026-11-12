import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot } from '../../types'
import { buildFocusNowSummary } from './focus-now'
import {
  stageTimeShares,
  startFinishBalance,
  startsOutrunFinishes,
} from './stage-time'

function issue(key: string) {
  return {
    id: `id-${key}`,
    key,
    issueTypeId: 'story',
    issueTypeName: 'Story',
    createdAt: '2026-02-01T00:00:00Z',
  }
}

function transition(key: string, statusId: string, enteredAt: string) {
  return { issueId: `id-${key}`, statusId, enteredAt }
}

const board: FlowBoardSnapshot['board'] = {
  id: 'board-1',
  name: 'Example board',
  statuses: [
    { id: 'todo', name: 'To Do' },
    { id: 'progress', name: 'In Progress' },
    { id: 'review', name: 'Review' },
    { id: 'done', name: 'Done' },
  ],
  columns: [
    { id: 'todo-column', name: 'To Do', statusIds: ['todo'] },
    { id: 'progress-column', name: 'In Progress', statusIds: ['progress'] },
    { id: 'review-column', name: 'Review', statusIds: ['review'] },
    { id: 'done-column', name: 'Done', statusIds: ['done'] },
  ],
}
const selected = ['progress-column', 'review-column']

describe('stageTimeShares', () => {
  it('splits finished items’ measured time across the measured stages', () => {
    const snapshot: FlowBoardSnapshot = {
      source: { kind: 'jira-data-center', label: 'Example' },
      board,
      issues: [issue('A'), issue('B'), issue('C')],
      transitions: [
        // A: 2 days in progress, 6 in review.
        transition('A', 'progress', '2026-03-01T00:00:00Z'),
        transition('A', 'review', '2026-03-03T00:00:00Z'),
        transition('A', 'done', '2026-03-09T00:00:00Z'),
        // B: 1 day in progress, 1 in review, back to progress 1 day, done.
        transition('B', 'progress', '2026-03-01T00:00:00Z'),
        transition('B', 'review', '2026-03-02T00:00:00Z'),
        transition('B', 'progress', '2026-03-03T00:00:00Z'),
        transition('B', 'done', '2026-03-04T00:00:00Z'),
        // C is still active: it does not count.
        transition('C', 'progress', '2026-03-01T00:00:00Z'),
      ],
      loadedAt: '2026-03-31T00:00:00Z',
    }
    const shares = stageTimeShares(snapshot, selected)
    // progress: 2 + 1 + 1 = 4 days; review: 6 + 1 = 7 days; total 11.
    expect(shares.get('progress-column')).toBeCloseTo(4 / 11, 5)
    expect(shares.get('review-column')).toBeCloseTo(7 / 11, 5)
    expect(shares.has('done-column')).toBe(false)
  })

  it('is empty without finished items', () => {
    const snapshot: FlowBoardSnapshot = {
      source: { kind: 'jira-data-center', label: 'Example' },
      board,
      issues: [issue('C')],
      transitions: [transition('C', 'progress', '2026-03-01T00:00:00Z')],
      loadedAt: '2026-03-31T00:00:00Z',
    }
    expect(stageTimeShares(snapshot, selected).size).toBe(0)
  })
})

// Loaded on Wednesday 25 Mar 2026; the two complete weeks are 9–22 Mar.
const loadedAt = '2026-03-25T12:00:00Z'

function growing(): FlowBoardSnapshot {
  const starts = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
  return {
    source: { kind: 'jira-data-center', label: 'Example' },
    board,
    issues: [
      ...starts.map(issue),
      issue('F1'),
      issue('F2'),
      issue('OLD'),
      issue('EARLY'),
    ],
    transitions: [
      // History reaches back before the window.
      transition('OLD', 'progress', '2026-02-20T00:00:00Z'),
      // Started before the window, finished inside it.
      transition('F1', 'progress', '2026-03-02T00:00:00Z'),
      transition('F1', 'done', '2026-03-12T00:00:00Z'),
      transition('F2', 'progress', '2026-03-03T00:00:00Z'),
      transition('F2', 'done', '2026-03-18T00:00:00Z'),
      // Started and finished before the window: counts for neither.
      transition('EARLY', 'progress', '2026-02-10T00:00:00Z'),
      transition('EARLY', 'done', '2026-02-15T00:00:00Z'),
      // Six started inside the window, all still active.
      ...starts.map((key, index) =>
        transition(key, 'progress', `2026-03-${10 + index}T00:00:00Z`),
      ),
    ],
    loadedAt,
  }
}

describe('startFinishBalance', () => {
  it('counts starts and finishes in the last two complete weeks and active work then and now', () => {
    const balance = startFinishBalance(growing(), selected)
    expect(balance).toMatchObject({
      started: 6,
      finished: 2,
      days: 14,
      activeThen: 3, // OLD, F1, F2 on 9 Mar
      activeNow: 7, // OLD + six starts
      windowStart: '2026-03-09T00:00:00.000Z',
      windowEnd: '2026-03-23T00:00:00.000Z',
    })
    expect(startsOutrunFinishes(balance!)).toBe(true)
  })

  it('does not fire on small gaps or when active work did not grow', () => {
    expect(
      startsOutrunFinishes({
        started: 4,
        finished: 3,
        days: 14,
        activeThen: 3,
        activeNow: 4,
        windowStart: '',
        windowEnd: '',
      }),
    ).toBe(false)
    expect(
      startsOutrunFinishes({
        started: 8,
        finished: 2,
        days: 14,
        activeThen: 9,
        activeNow: 9,
        windowStart: '',
        windowEnd: '',
      }),
    ).toBe(false)
  })

  it('is absent when the history does not reach the window', () => {
    const snapshot = growing()
    snapshot.transitions = snapshot.transitions.filter(
      ({ enteredAt }) => enteredAt >= '2026-03-09',
    )
    expect(startFinishBalance(snapshot, selected)).toBeNull()
  })

  it('becomes a signal in the briefing', () => {
    const summary = buildFocusNowSummary({
      snapshot: growing(),
      selectedColumnIds: selected,
      metrics: {
        uniqueItemCount: 10,
        validTransitionCount: 12,
        workItemCount: 3,
        cycleTimeItemCount: 3,
        medianCycleTime: 10,
        percentile85CycleTime: 40,
        weeklyThroughput: [],
        cycleTimes: [],
        distribution: [],
        explanation: '',
      },
      windowDays: null,
    })
    const signal = summary.signals.find(({ id }) => id === 'start-finish')
    expect(signal?.title).toBe('Starting more than finishing')
    expect(signal?.evidence).toBe(
      '6 items started and 2 finished in the last two complete weeks. Active work grew from 3 to 7.',
    )
  })
})
