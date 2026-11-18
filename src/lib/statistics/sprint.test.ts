import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot, SprintItemRecord } from '../../types'
import { readSprintData } from '../data-source/sprint-data'
import { scrumDemoSnapshot, SCRUM_DEMO_FILTERS } from '../workspace/demo-scrum'
import { demoSnapshot, DEMO_FILTERS } from '../workspace/demo'
import {
  buildSprintBriefing,
  chanceNotStarted,
  chanceStarted,
  confidentAtLeast,
  ordinal,
  pointsAt,
  spearman,
  sprintsAt,
  workdays,
} from './sprint'

const NOW = new Date('2026-11-18T12:00:00.000Z') // a Wednesday
const at = (iso: string) => Date.parse(iso)

describe('sprint membership and estimates over time', () => {
  const record: SprintItemRecord = {
    issueId: '1',
    sprintIds: ['12', '13'],
    points: 5,
    sprintChanges: [
      { at: '2026-11-02T09:00:00.000Z', from: [], to: ['12'] },
      { at: '2026-11-13T17:00:00.000Z', from: ['12'], to: ['12', '13'] },
    ],
    pointChanges: [{ at: '2026-11-05T09:00:00.000Z', from: 3, to: 5 }],
  }

  it('rebuilds the sprints an item was in at any moment', () => {
    expect(sprintsAt(record, at('2026-11-01T00:00:00Z'))).toEqual([])
    expect(sprintsAt(record, at('2026-11-10T00:00:00Z'))).toEqual(['12'])
    expect(sprintsAt(record, at('2026-11-14T00:00:00Z'))).toEqual(['12', '13'])
  })

  it('rebuilds its estimate, so day one counts what was planned', () => {
    expect(pointsAt(record, at('2026-11-03T00:00:00Z'))).toBe(3)
    expect(pointsAt(record, at('2026-11-06T00:00:00Z'))).toBe(5)
    expect(pointsAt(undefined, 0)).toBeNull()
  })
})

describe('the forecast’s arithmetic', () => {
  const sample = [2, 3, 4, 5, 6, 8, 10, 12].map((days, index) => ({
    key: `K-${index}`,
    days,
  }))

  it('gives a started item the share of longer items that finished in the days left', () => {
    // Older than 4 days: 5, 6, 8, 10, 12; within 4 + 3 = 7 days: 5 and 6.
    expect(chanceStarted(sample, 4, 3)).toBeCloseTo(2.5 / 6)
    // Older than every finished item: very unlikely, never certain.
    expect(chanceStarted(sample, 20, 3)).toBe(0.05)
  })

  it('gives an item not started the share that took no longer than the days left', () => {
    expect(chanceNotStarted(sample, 4)).toBeCloseTo(3.5 / 9)
    expect(chanceNotStarted(sample, 0)).toBe(0)
  })

  it('finds how many finish with 85% confidence from each item’s chance', () => {
    expect(confidentAtLeast([1, 1, 1], 0.85)).toBe(3)
    expect(confidentAtLeast([0, 0], 0.85)).toBe(0)
    // Ten items at 90%: at least 8 with 93% confidence, 9 with only 74%.
    expect(confidentAtLeast(new Array(10).fill(0.9), 0.85)).toBe(8)
  })

  it('measures whether estimates rank like durations', () => {
    expect(spearman([1, 2, 3, 5, 8], [1, 2, 3, 4, 5])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 5, 8], [5, 4, 3, 2, 1])).toBeCloseTo(-1)
    expect(spearman([3, 3, 3], [1, 2, 3])).toBe(0)
  })

  it('counts working days and ordinals', () => {
    // Monday 9 Nov to Wednesday 18 Nov: 8 working days.
    expect(
      workdays(at('2026-11-09T09:00:00Z'), at('2026-11-18T12:00:00Z')),
    ).toBe(8)
    expect(
      workdays(at('2026-11-14T09:00:00Z'), at('2026-11-15T12:00:00Z')),
    ).toBe(0)
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ])
  })
})

describe('the Sprint tab on a fictional Scrum team', () => {
  const briefing = buildSprintBriefing(
    scrumDemoSnapshot(NOW),
    SCRUM_DEMO_FILTERS,
  )!
  const active = briefing.active!

  it('answers whether the running sprint lands, with its sample', () => {
    expect(active.sprint.name).toBe('Sprint 24')
    expect([active.day, active.days]).toEqual([8, 10])
    expect(active.sample).toBeGreaterThanOrEqual(20)
    expect(active.likely).toBeLessThan(active.items.length)
    expect(active.atLeast).toBeLessThanOrEqual(active.likely)
    const states = new Set(active.items.map((item) => item.state))
    expect(states).toEqual(new Set(['done', 'track', 'risk', 'todo']))
    // Points: unestimated bugs count as items, not as zero-point work.
    expect(active.points!.unestimated).toBe(2)
    expect(active.points!.likely + active.points!.atRisk).toBe(
      active.points!.total,
    )
    // Every item reads like a list row: key, link and title on hover.
    for (const item of active.items) {
      expect(item.title).toBeTruthy()
      expect(item.browseUrl).toContain(item.key)
    }
  })

  it('knows what was planned on day one and what was added since', () => {
    // Nine planned, plus one carried over from the last sprint.
    expect(active.planned).toHaveLength(10)
    expect(active.added).toHaveLength(3)
    expect(active.removed).toHaveLength(0)
  })

  it('rebuilds the last five sprints, with points finished as velocity', () => {
    expect(briefing.history.map((view) => view.sprint.name)).toEqual([
      'Sprint 19',
      'Sprint 20',
      'Sprint 21',
      'Sprint 22',
      'Sprint 23',
    ])
    for (const view of briefing.history) {
      expect(view.finishedPlanned).toBeLessThanOrEqual(view.planned.length)
      expect(view.finished.length + view.notFinished.length).toBe(
        view.planned.length + view.added.length - view.removed.length,
      )
      expect(view.finishedPoints).toBeGreaterThan(0)
    }
    // Some planned work rolls over: no team finishes everything.
    const planned = briefing.history.reduce((n, v) => n + v.planned.length, 0)
    const finished = briefing.history.reduce((n, v) => n + v.finishedPlanned, 0)
    expect(finished / planned).toBeLessThan(1)
  })

  it('checks the next sprint’s plan against what the team usually finishes', () => {
    const planning = briefing.planning!
    expect(planning.sprint.name).toBe('Sprint 25')
    expect(planning.planned).toBe(40)
    expect(planning.low).toBeLessThanOrEqual(planning.usual)
    expect(planning.usual).toBeLessThanOrEqual(planning.high)
    expect(planning.sprints).toBe(5)
  })

  it('tells whether points predict time on this board', () => {
    const view = briefing.pointsTime!
    expect(view.verdict).not.toBe('no')
    expect(view.largeMedian).toBeGreaterThan(view.smallMedian)
    expect(view.rows.map((row) => row.points)).toEqual([1, 2, 3, 5, 8])
  })

  it('raises scope change and carry-over as decisions, with Jira links', () => {
    const ids = briefing.signals.map((signal) => signal.id)
    expect(ids).toEqual(['sprint-scope', 'sprint-carry-over'])
    const carry = briefing.signals[1]!
    expect(carry.title).toMatch(/is in its 3rd sprint/)
    expect(carry.evidence).toContain('Sprint 22 and Sprint 23')
    expect(briefing.signals.every((signal) => signal.jiraFilter)).toBe(true)
  })
})

describe('boards without sprints', () => {
  it('leave Kanban boards to the flow briefing', () => {
    expect(buildSprintBriefing(demoSnapshot('demo', NOW), DEMO_FILTERS)).toBe(
      undefined,
    )
  })

  it('say so when the connection may not read sprints', () => {
    const snapshot: FlowBoardSnapshot = {
      ...demoSnapshot('demo', NOW),
      sprints: {
        estimate: { kind: 'items' },
        sprints: [],
        items: [],
        unavailable: 'permission',
      },
    }
    expect(buildSprintBriefing(snapshot, DEMO_FILTERS)).toMatchObject({
      unavailable: 'permission',
      history: [],
      signals: [],
    })
  })

  it('read a sprint payload defensively', () => {
    expect(readSprintData(undefined)).toBeUndefined()
    expect(
      readSprintData({
        estimate: { kind: 'points', field: 'Story Points' },
        sprints: [
          { id: '1', name: 'Sprint 1', state: 'active', startAt: 'not a date' },
          { id: '2', state: 'closed' },
        ],
        items: [
          {
            issueId: '9',
            sprintIds: ['1', 2],
            points: -1,
            sprintChanges: [{ at: 'bad' }],
          },
        ],
      }),
    ).toEqual({
      estimate: { kind: 'points', field: 'Story Points' },
      sprints: [{ id: '1', name: 'Sprint 1', state: 'active' }],
      items: [
        { issueId: '9', sprintIds: ['1'], sprintChanges: [], pointChanges: [] },
      ],
    })
  })
})
