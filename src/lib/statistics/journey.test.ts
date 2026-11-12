import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot, FlowIssue } from '../../types'
import { calculateBoardMetrics } from '.'
import { collectAgingWork } from './aging-work'
import { assessDataQuality } from './data-quality'
import { findReenteredWorkInProgress } from './focus-now'
import {
  boardJourneys,
  isCancelledResolution,
  stageZoneLookup,
} from './journey'
import { filterBoardSnapshot } from './snapshot-filter'

// Fictional board: To do → In progress → Blocked → Code review → Testing → Done.
// Measured: In progress and Code review. Blocked sits between them, unmeasured.
const columns = [
  { id: 'c-todo', name: 'To do', statusIds: ['todo'] },
  { id: 'c-progress', name: 'In progress', statusIds: ['progress'] },
  { id: 'c-blocked', name: 'Blocked', statusIds: ['blocked'] },
  { id: 'c-review', name: 'Code review', statusIds: ['review'] },
  { id: 'c-testing', name: 'Testing', statusIds: ['testing'] },
  { id: 'c-done', name: 'Done', statusIds: ['done'] },
]
const selected = ['c-progress', 'c-review']

function issue(id: string, extra: Partial<FlowIssue> = {}): FlowIssue {
  return {
    id,
    key: `DEMO-${id}`,
    issueTypeId: 'story',
    issueTypeName: 'Story',
    createdAt: '2026-09-01T00:00:00Z',
    ...extra,
  }
}

function boardWith(
  issues: FlowIssue[],
  paths: Record<string, Array<[string, number]>>,
  statuses: FlowBoardSnapshot['board']['statuses'] = [],
): FlowBoardSnapshot {
  return {
    source: { kind: 'jira-cloud', label: 'Fictional board' },
    board: {
      id: 'b',
      name: 'Fictional board',
      columns,
      statuses: [
        ...columns.map((column) => ({
          id: column.statusIds[0]!,
          name: column.name,
        })),
        ...statuses,
      ],
    },
    issues,
    // Day numbers are days after 1 September 2026.
    transitions: Object.entries(paths).flatMap(([issueId, steps]) =>
      steps.map(([statusId, day]) => ({
        issueId,
        statusId,
        enteredAt: new Date(Date.UTC(2026, 8, 1 + day)).toISOString(),
      })),
    ),
    loadedAt: '2026-10-01T00:00:00Z',
  }
}

describe('stage zones', () => {
  it('places columns before, between, inside and after the measured stages', () => {
    const zoneOf = stageZoneLookup(boardWith([], {}).board, selected)
    expect(
      ['todo', 'progress', 'blocked', 'review', 'testing', 'done'].map(zoneOf),
    ).toEqual(['before', 'tracked', 'paused', 'tracked', 'after', 'after'])
  })

  it('uses the status category for statuses that are not on the board', () => {
    const zoneOf = stageZoneLookup(
      boardWith([], {}, [
        { id: 'closed', name: 'Closed', category: 'done' },
        { id: 'triage', name: 'Triage', category: 'todo' },
        { id: 'waiting', name: 'Waiting', category: 'in-progress' },
      ]).board,
      selected,
    )
    expect(['closed', 'triage', 'waiting'].map(zoneOf)).toEqual([
      'after',
      'before',
      'paused',
    ])
  })
})

describe('what counts as finished', () => {
  const snapshot = boardWith(
    [
      issue('forward'),
      issue('back-to-todo'),
      issue('wont-do', { resolution: 'Won’t Do' }),
      issue('blocked-now'),
      issue('reopened'),
    ],
    {
      forward: [
        ['todo', 0],
        ['progress', 1],
        ['review', 4],
        ['testing', 6],
        ['done', 8],
      ],
      'back-to-todo': [
        ['todo', 0],
        ['progress', 2],
        ['todo', 5],
      ],
      'wont-do': [
        ['todo', 0],
        ['progress', 1],
        ['done', 3],
      ],
      'blocked-now': [
        ['todo', 0],
        ['progress', 1],
        ['blocked', 3],
      ],
      reopened: [
        ['todo', 0],
        ['progress', 1],
        ['review', 3],
        ['testing', 5],
        ['review', 10],
        ['testing', 12],
      ],
    },
  )

  it('classifies each journey', () => {
    const journeys = boardJourneys(snapshot, selected)
    expect(
      Object.fromEntries(
        [...journeys].map(([id, journey]) => [id, journey.outcome]),
      ),
    ).toEqual({
      forward: 'finished',
      'back-to-todo': 'returned',
      'wont-do': 'cancelled',
      'blocked-now': 'active',
      reopened: 'finished',
    })
    expect(journeys.get('reopened')).toMatchObject({
      reopened: true,
      journeys: 2,
      // 2 days in progress + 2 in review + 2 more in review after reopening.
      trackedDays: 6,
    })
  })

  it('counts only forward, delivered finishes in cycle time and throughput', () => {
    const metrics = calculateBoardMetrics(snapshot, selected)
    expect(metrics?.cycleTimes.map(({ item }) => item)).toEqual([
      'DEMO-forward',
      'DEMO-reopened',
    ])
    // The reopened item counts once, on its latest finish.
    expect(
      metrics?.cycleTimes.find(({ item }) => item === 'DEMO-reopened')
        ?.cycleEnd,
    ).toBe('2026-09-13T00:00:00.000Z')
  })

  it('keeps items in a paused stage as active work without aging them', () => {
    const active = collectAgingWork(snapshot, selected)
    expect(active.map(({ item, column }) => [item, column])).toEqual([
      ['DEMO-blocked-now', 'Blocked'],
    ])
    // Two days in progress; the days in Blocked do not count.
    expect(active[0]?.ageInSelectedColumns).toBe(2)
  })

  it('reports the excluded journeys on the data checks', () => {
    const report = assessDataQuality(
      snapshot,
      { selectedColumnIds: selected, windowDays: null, ticketTypes: [] },
      new Date('2026-10-01T00:00:00Z'),
    )
    expect(report).toMatchObject({
      completedObservationCount: 2,
      workInProgressCount: 1,
      returnedCount: 1,
      cancelledCount: 1,
      reopenedCount: 1,
      metricsReconciled: true,
    })
  })
})

describe('rework', () => {
  it('does not treat a pause in an unmeasured stage as re-entry', () => {
    const snapshot = boardWith([issue('paused'), issue('rework')], {
      paused: [
        ['progress', 1],
        ['blocked', 2],
        ['review', 4],
      ],
      rework: [
        ['progress', 1],
        ['testing', 3],
        ['review', 5],
      ],
    })
    expect(
      findReenteredWorkInProgress(snapshot, selected).map(({ item }) => item),
    ).toEqual(['DEMO-rework'])
  })
})

describe('type scope', () => {
  const snapshot = boardWith(
    [
      issue('story'),
      issue('sub', { issueTypeName: 'Sub-task', hierarchy: 'subtask' }),
      issue('epic', { issueTypeName: 'Epic', hierarchy: 'epic' }),
    ],
    {
      story: [
        ['progress', 1],
        ['done', 3],
      ],
      sub: [
        ['progress', 1],
        ['done', 2],
      ],
      epic: [
        ['progress', 1],
        ['done', 20],
      ],
    },
  )

  it('leaves out sub-tasks and epics unless their types are chosen', () => {
    const keys = (ticketTypes: string[]) =>
      filterBoardSnapshot(
        snapshot,
        { selectedColumnIds: selected, windowDays: null, ticketTypes },
        new Date('2026-10-01T00:00:00Z'),
      ).issues.map(({ key }) => key)
    expect(keys([])).toEqual(['DEMO-story'])
    expect(keys(['Story', 'Sub-task'])).toEqual(['DEMO-story', 'DEMO-sub'])
  })
})

describe('cancelled resolutions', () => {
  it('matches common names regardless of case and apostrophe', () => {
    expect(isCancelledResolution("WON'T DO")).toBe(true)
    expect(isCancelledResolution('Won’t Fix')).toBe(true)
    expect(isCancelledResolution('Duplicate')).toBe(true)
    expect(isCancelledResolution('Done')).toBe(false)
    expect(isCancelledResolution(undefined)).toBe(false)
  })
})

describe('cancelled statuses', () => {
  // A board with a "Won't do" column and no resolutions, as on Trello.
  const withWontDo: FlowBoardSnapshot = {
    ...boardWith([issue('dropped'), issue('shipped')], {
      dropped: [
        ['progress', 1],
        ['wontdo', 4],
      ],
      shipped: [
        ['progress', 1],
        ['done', 4],
      ],
    }),
  }
  withWontDo.board = {
    ...withWontDo.board,
    columns: [
      ...withWontDo.board.columns,
      { id: 'c-wontdo', name: 'Won’t do', statusIds: ['wontdo'] },
    ],
  }

  it('treats a cancellation column as cancelled, not finished', () => {
    const journeys = boardJourneys(withWontDo, selected)
    expect(journeys.get('dropped')?.outcome).toBe('cancelled')
    expect(journeys.get('shipped')?.outcome).toBe('finished')
    expect(
      calculateBoardMetrics(withWontDo, selected)?.cycleTimes.map(
        ({ item }) => item,
      ),
    ).toEqual(['DEMO-shipped'])
  })
})
