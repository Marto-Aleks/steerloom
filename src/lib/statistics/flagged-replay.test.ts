import { describe, expect, it } from 'vitest'
import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import { replayFlaggedItems } from './flagged-replay'

const filters: AnalysisFilters = {
  ticketTypes: ['Story'],
  windowDays: 30,
  selectedColumnIds: ['progress-column', 'review-column'],
}

function issue(key: string, createdAt: string) {
  return {
    id: `id-${key}`,
    key,
    issueTypeId: 'story',
    issueTypeName: 'Story',
    createdAt,
    title: `Title of ${key}`,
  }
}

function transition(key: string, statusId: string, enteredAt: string) {
  return { issueId: `id-${key}`, statusId, enteredAt }
}

// Now is 31 Mar 12:00; the replay looks at 24 Mar 12:00.
const snapshot: FlowBoardSnapshot = {
  source: { kind: 'jira-data-center', label: 'Example board' },
  board: {
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
  },
  issues: [
    // Finished before the flag date: the usual limit then is about 5.6 days.
    issue('DEMO-1', '2026-02-20T00:00:00Z'),
    issue('DEMO-2', '2026-02-20T00:00:00Z'),
    issue('DEMO-3', '2026-02-20T00:00:00Z'),
    issue('DEMO-4', '2026-02-20T00:00:00Z'),
    // Past the limit on 24 Mar.
    issue('DEMO-10', '2026-03-01T00:00:00Z'),
    issue('DEMO-11', '2026-03-01T00:00:00Z'),
    issue('DEMO-12', '2026-03-01T00:00:00Z'),
    issue('DEMO-13', '2026-03-01T00:00:00Z'),
    // Young on 24 Mar: not flagged.
    issue('DEMO-14', '2026-03-01T00:00:00Z'),
    // Came back into the flow before 24 Mar.
    issue('DEMO-15', '2026-03-01T00:00:00Z'),
  ],
  transitions: [
    transition('DEMO-1', 'progress', '2026-03-01T00:00:00Z'),
    transition('DEMO-1', 'done', '2026-03-06T00:00:00Z'),
    transition('DEMO-2', 'progress', '2026-03-01T00:00:00Z'),
    transition('DEMO-2', 'done', '2026-03-05T00:00:00Z'),
    transition('DEMO-3', 'progress', '2026-03-02T00:00:00Z'),
    transition('DEMO-3', 'done', '2026-03-08T00:00:00Z'),
    transition('DEMO-4', 'progress', '2026-03-02T00:00:00Z'),
    transition('DEMO-4', 'done', '2026-03-07T00:00:00Z'),
    // Finished 1.5 days after the flag.
    transition('DEMO-10', 'progress', '2026-03-10T00:00:00Z'),
    transition('DEMO-10', 'done', '2026-03-26T00:00:00Z'),
    // Never moved.
    transition('DEMO-11', 'progress', '2026-03-12T00:00:00Z'),
    // Moved to Review the same day, still there.
    transition('DEMO-12', 'progress', '2026-03-14T00:00:00Z'),
    transition('DEMO-12', 'review', '2026-03-25T00:00:00Z'),
    // Went back to To Do.
    transition('DEMO-13', 'progress', '2026-03-15T00:00:00Z'),
    transition('DEMO-13', 'todo', '2026-03-28T00:00:00Z'),
    transition('DEMO-14', 'progress', '2026-03-23T00:00:00Z'),
    // Done, then back in progress; finished 5.5 days after the flag.
    transition('DEMO-15', 'progress', '2026-03-18T00:00:00Z'),
    transition('DEMO-15', 'done', '2026-03-19T00:00:00Z'),
    transition('DEMO-15', 'progress', '2026-03-23T00:00:00Z'),
    transition('DEMO-15', 'done', '2026-03-30T00:00:00Z'),
  ],
  loadedAt: '2026-03-31T12:00:00Z',
}

const now = new Date('2026-03-31T12:00:00Z')

describe('replayFlaggedItems', () => {
  it('replays what the briefing flagged a week ago and what happened since', () => {
    const replay = replayFlaggedItems(snapshot, filters, now)
    expect(replay).not.toBeNull()
    expect(replay!.flaggedAt).toBe('2026-03-24T12:00:00.000Z')
    expect(replay!.limitThen).toBeCloseTo(5.55, 1)
    expect(replay!.limitNow).toBeGreaterThan(replay!.limitThen!)

    const byKey = Object.fromEntries(
      replay!.items.map((item) => [item.item, item]),
    )
    // Late items first, oldest first, then the re-entered one.
    expect(replay!.items.map(({ item }) => item)).toEqual([
      'DEMO-10',
      'DEMO-11',
      'DEMO-12',
      'DEMO-13',
      'DEMO-15',
    ])
    expect(byKey['DEMO-10']).toMatchObject({
      reason: 'late',
      flaggedAs: '14.5 days in progress, 2.6× the usual',
      outcome: 'finished',
      detail: 'Finished the next day',
      movedAfterDays: 1.5,
      title: 'Title of DEMO-10',
    })
    expect(byKey['DEMO-11']).toMatchObject({
      outcome: 'waiting',
      detail: 'Still in In Progress, now 19.5 days',
      movedAfterDays: null,
    })
    expect(byKey['DEMO-12']).toMatchObject({
      outcome: 'moved',
      detail: 'Moved to Review the same day',
      movedAfterDays: 0.5,
    })
    expect(byKey['DEMO-13']).toMatchObject({
      outcome: 'returned',
      detail: 'Went back to To Do',
    })
    expect(byKey['DEMO-15']).toMatchObject({
      reason: 'reentered',
      flaggedAs: 'Came back into the flow',
      outcome: 'finished',
      detail: 'Finished 6 days later',
    })
    expect(byKey['DEMO-14']).toBeUndefined()
    // DEMO-10 and DEMO-12 moved within two days; DEMO-15 took longer.
    expect(replay!.movedQuickly).toBe(2)
  })

  it('says cancelled, not finished, for work closed without delivery', () => {
    const dropped: FlowBoardSnapshot = {
      ...snapshot,
      issues: snapshot.issues.map((item) =>
        item.key === 'DEMO-10' ? { ...item, resolution: "Won't Do" } : item,
      ),
    }
    const replay = replayFlaggedItems(dropped, filters, now)
    expect(replay!.items.find(({ item }) => item === 'DEMO-10')).toMatchObject({
      outcome: 'returned',
      detail: 'Cancelled the next day',
    })
  })

  it('is absent when the history does not reach back that far', () => {
    const recent: FlowBoardSnapshot = {
      ...snapshot,
      transitions: snapshot.transitions.filter(
        ({ enteredAt }) => enteredAt >= '2026-03-26',
      ),
    }
    expect(replayFlaggedItems(recent, filters, now)).toBeNull()
  })

  it('is absent when nothing was flagged then', () => {
    const calm: FlowBoardSnapshot = {
      ...snapshot,
      issues: snapshot.issues.filter(({ key }) =>
        ['DEMO-1', 'DEMO-2', 'DEMO-3', 'DEMO-4', 'DEMO-14'].includes(key),
      ),
    }
    expect(replayFlaggedItems(calm, filters, now)).toBeNull()
  })

  it('is absent without measured columns', () => {
    expect(
      replayFlaggedItems(snapshot, { ...filters, selectedColumnIds: [] }, now),
    ).toBeNull()
  })
})
