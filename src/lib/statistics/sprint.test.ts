import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot, SprintItemRecord } from '../../types'
import { readSprintData } from '../data-source/sprint-data'
import { scrumDemoSnapshot } from '../workspace/demo-scrum'
import { demoSnapshot } from '../workspace/demo'
import { AI_USER_MESSAGE_CHAR_LIMIT } from '../ai/conversation'
import { toAiSprintContext } from '../ai/sprint-context'
import {
  buildSprintBriefing,
  chanceNotStarted,
  chanceStarted,
  confidentAtLeast,
  ordinal,
  pointsAt,
  spearman,
  sprintsAt,
  sprintDay,
  sprintLength,
  sprintDescopePrompt,
  sprintGoalPrompt,
  sprintHistoryPrompt,
  sprintTodayPrompt,
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

  it('counts sprint days in calendar days, and ordinals', () => {
    // Started Monday 9 Nov 09:00; Wednesday 18 Nov noon is day 10.
    expect(
      sprintDay(at('2026-11-09T09:00:00Z'), at('2026-11-18T12:00:00Z')),
    ).toBe(10)
    expect(
      sprintDay(at('2026-11-09T09:00:00Z'), at('2026-11-09T10:00:00Z')),
    ).toBe(1)
    expect(
      sprintDay(at('2026-11-09T09:00:00Z'), at('2026-11-08T10:00:00Z')),
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
  const briefing = buildSprintBriefing(scrumDemoSnapshot(NOW))!
  const active = briefing.active!

  it('answers whether the running sprint lands, with its sample', () => {
    expect(active.sprint.name).toBe('Sprint 24')
    // Pinned to today: always day 10 of 14, whatever the weekday.
    expect([active.day, active.days]).toEqual([10, 14])
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
    // Planned above what the team finishes, two items not estimated.
    expect(planning.planned).toBe(52)
    expect(planning.planned).toBeGreaterThan(planning.high)
    expect(planning.unestimated).toBe(2)
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

describe('real boards: planning day, late start, little history', () => {
  const HOUR = 3_600_000
  const withActive = (
    change: (
      snapshot: FlowBoardSnapshot,
      active: NonNullable<FlowBoardSnapshot['sprints']>['sprints'][number],
    ) => FlowBoardSnapshot,
  ) => {
    const snapshot = scrumDemoSnapshot(NOW)
    const active = snapshot.sprints!.sprints.find((s) => s.state === 'active')!
    return buildSprintBriefing(change(snapshot, active))!.active!
  }

  it('counts items added on the sprint’s first day as planned', () => {
    const before = buildSprintBriefing(scrumDemoSnapshot(NOW))!.active!
    const active = withActive((snapshot, sprint) => {
      // Everything joins three hours after the start, as when a team
      // presses Start and then drags the plan in.
      const joined = new Date(Date.parse(sprint.startAt!) + 3 * HOUR)
      const data = snapshot.sprints!
      return {
        ...snapshot,
        sprints: {
          ...data,
          items: data.items.map((item) =>
            item.sprintIds.includes(sprint.id) &&
            item.sprintChanges.at(-1)?.to.includes(sprint.id) &&
            !item.sprintChanges.at(-1)?.from.includes(sprint.id) &&
            Date.parse(item.sprintChanges.at(-1)!.at) <
              Date.parse(sprint.startAt!)
              ? {
                  ...item,
                  sprintChanges: [
                    ...item.sprintChanges.slice(0, -1),
                    { ...item.sprintChanges.at(-1)!, at: joined.toISOString() },
                  ],
                }
              : item,
          ),
        },
      }
    })
    expect(active.planned.length).toBe(before.planned.length)
    expect(active.added.length).toBe(before.added.length)
  })

  it('reads the plan from when Start was pressed, if later than the start date', () => {
    const active = withActive((snapshot, sprint) => ({
      ...snapshot,
      sprints: {
        ...snapshot.sprints!,
        sprints: snapshot.sprints!.sprints.map((s) =>
          s.id === sprint.id
            ? {
                ...s,
                // Started two days late: the items added on day 2 were
                // there when the team pressed Start.
                activatedAt: new Date(
                  Date.parse(sprint.startAt!) + 2 * 24 * HOUR,
                ).toISOString(),
              }
            : s,
        ),
      },
    }))
    expect(active.added.length).toBeLessThan(3)
  })

  it('ages work from its latest pick-up, not a start months before', () => {
    const snapshot = scrumDemoSnapshot(NOW)
    const before = buildSprintBriefing(snapshot)!.active!
    const item = before.items.find((i) => i.ageDays !== undefined)!
    const issueId = snapshot.issues.find((i) => i.key === item.key)!.id
    const ago = (days: number) =>
      new Date(NOW.getTime() - days * 24 * HOUR).toISOString()
    // Started 60 days ago, back to the backlog 50 days ago, then picked up
    // again where the fixture has it.
    const active = buildSprintBriefing({
      ...snapshot,
      transitions: [
        { issueId, statusId: 'progress', enteredAt: ago(60) },
        { issueId, statusId: 'todo', enteredAt: ago(50) },
        ...snapshot.transitions,
      ],
    })!.active!
    expect(active.items.find((i) => i.key === item.key)!.ageDays).toBeCloseTo(
      item.ageDays!,
    )
  })

  it('says how much is done, not what is likely, without enough history', () => {
    const active = withActive((snapshot) => {
      // Only the running sprint's work has ever finished.
      const running = new Set(
        snapshot
          .sprints!.items.filter((item) => item.sprintIds.includes('124'))
          .map((item) => item.issueId),
      )
      return {
        ...snapshot,
        transitions: snapshot.transitions.filter(
          (t) => t.statusId !== 'done' || running.has(t.issueId),
        ),
      }
    })
    expect(active.sample).toBe(0)
    expect(active.finishedRecently).toBeLessThan(5)
    const states = new Set(active.items.map((item) => item.state))
    expect(states.has('track')).toBe(false)
    expect(states.has('risk')).toBe(false)
    const done = active.items.filter((item) => item.state === 'done').length
    expect(active.likely).toBe(done)
    expect(active.atLeast).toBe(done)
  })
})

describe('cards that cannot say anything yet say why', () => {
  it('explains a missing planning check and points check', () => {
    const snapshot = scrumDemoSnapshot(NOW)
    const data = snapshot.sprints!
    // No next sprint in Jira, and estimates on only a few items.
    const kept = data.sprints.filter((sprint) => sprint.state !== 'future')
    const items = data.items.map((item, index) =>
      index % 6 ? { ...item, points: undefined } : item,
    )
    const briefing = buildSprintBriefing({
      ...snapshot,
      sprints: { ...data, sprints: kept, items },
    })!
    expect(briefing.planning).toBeUndefined()
    expect(briefing.planningGap).toMatch(/Create the next sprint in Jira/)
    expect(briefing.pointsTime).toBeUndefined()
    expect(briefing.pointsTimeGap!.estimated).toBeLessThan(15)
    expect(briefing.pointsTimeGap!.needed).toBe(15)
  })

  it('names an empty next sprint', () => {
    const snapshot = scrumDemoSnapshot(NOW)
    const data = snapshot.sprints!
    const next = data.sprints.find((sprint) => sprint.state === 'future')!
    const items = data.items.map((item) => ({
      ...item,
      sprintIds: item.sprintIds.filter((id) => id !== next.id),
    }))
    expect(
      buildSprintBriefing({ ...snapshot, sprints: { ...data, items } })!
        .planningGap,
    ).toBe('Sprint 25 has no items yet.')
  })
})

describe('boards without sprints', () => {
  it('leave Kanban boards to the flow briefing', () => {
    expect(buildSprintBriefing(demoSnapshot('demo', NOW))).toBe(undefined)
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
    expect(buildSprintBriefing(snapshot)).toMatchObject({
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

describe('questions for Steerloom AI', () => {
  it('stay a sentence long, whatever the sprint holds or its goal says', () => {
    const sprint = buildSprintBriefing(scrumDemoSnapshot(NOW))!
    // A real team's goal can be paragraphs, and its sprint dozens of items.
    const active = {
      ...sprint.active!,
      sprint: {
        ...sprint.active!.sprint,
        goal: `Have reliable test reports.\n${'Get straight to the point. '.repeat(120)}`,
      },
      items: Array.from({ length: 60 }, () => sprint.active!.items[0]!),
    }
    const questions = [
      sprintDescopePrompt(active),
      sprintGoalPrompt(active),
      sprintTodayPrompt(active),
      sprintHistoryPrompt(sprint.history),
    ]
    for (const question of questions) {
      expect(question.length).toBeLessThan(700)
      expect(question.length).toBeLessThan(AI_USER_MESSAGE_CHAR_LIMIT)
    }
    // The facts travel with the briefing data, not in the question.
    expect(sprintDescopePrompt(active)).not.toMatch(/SHOP-\d+/)
    expect(sprintHistoryPrompt(sprint.history)).toBe(
      'What do the last 5 sprints tell us for the next planning?',
    )
    expect(sprintDescopePrompt(active)).toContain(
      'Have reliable test reports. Get',
    )
    expect(sprintDescopePrompt(active)).toContain('…')
  })
})

describe('how long a sprint is, from the dates Jira holds', () => {
  it('counts four weeks as 28 days, and a part of a day at the end as a day', () => {
    // Four weeks, ending at the time of day it started: 28 days, not 29.
    expect(
      sprintLength(at('2026-03-02T10:00:00Z'), at('2026-03-30T10:00:00Z')),
    ).toBe(28)
    expect(
      sprintLength(at('2026-11-09T09:00:00Z'), at('2026-11-23T09:00:00Z')),
    ).toBe(14)
    expect(
      sprintLength(at('2026-11-09T09:00:00Z'), at('2026-11-22T17:00:00Z')),
    ).toBe(14)
    expect(
      sprintLength(at('2026-11-09T09:00:00Z'), at('2026-11-09T09:00:00Z')),
    ).toBe(1)
  })

  it('shows a sprint that started today as day 1 of 28, and never a day past its last', () => {
    const DAY = 86_400_000
    const running = (startedAgo: number) => {
      const snapshot = scrumDemoSnapshot(NOW)
      const start = NOW.getTime() - startedAgo
      return buildSprintBriefing({
        ...snapshot,
        sprints: {
          ...snapshot.sprints!,
          sprints: snapshot.sprints!.sprints.map((sprint) =>
            sprint.state === 'active'
              ? {
                  ...sprint,
                  startAt: new Date(start).toISOString(),
                  endAt: new Date(start + 28 * DAY).toISOString(),
                }
              : sprint,
          ),
        },
      })!.active!
    }
    expect(running(2 * 3_600_000)).toMatchObject({ day: 1, days: 28 })
    expect(running(27.5 * DAY)).toMatchObject({ day: 28, days: 28 })
    expect(running(28 * DAY)).toMatchObject({ day: 28, days: 28 })
  })
})

describe('unfinished work leaves a sprint in three ways', () => {
  const DAY = 86_400_000
  const HOUR = 3_600_000
  const base = scrumDemoSnapshot(NOW)
  const sprintOf = (name: string) =>
    base.sprints!.sprints.find((sprint) => sprint.name === name)!
  const last = sprintOf('Sprint 23')
  const running = sprintOf('Sprint 24')
  const start = at(last.startAt!)
  const end = at(last.completedAt!)
  const iso = (time: number) => new Date(time).toISOString()
  const joined = { at: iso(start - 2 * DAY), from: [], to: [last.id] }
  // Three open items, rewritten as planned in Sprint 23 and never finished.
  const histories: Record<
    string,
    Pick<SprintItemRecord, 'sprintIds' | 'sprintChanges'>
  > = {
    // Taken out in the middle of the sprint, back to the backlog.
    'SHOP-247': {
      sprintIds: [],
      sprintChanges: [
        joined,
        { at: iso(start + 5 * DAY), from: [last.id], to: [] },
      ],
    },
    // Taken out before the sprint was closed, added to the next one by hand.
    'SHOP-248': {
      sprintIds: [running.id],
      sprintChanges: [
        joined,
        { at: iso(end - HOUR), from: [last.id], to: [] },
        { at: iso(at(running.startAt!) + HOUR), from: [], to: [running.id] },
      ],
    },
    // Moved to the next sprint at the moment the sprint was closed.
    'SHOP-251': {
      sprintIds: [running.id],
      sprintChanges: [
        joined,
        { at: iso(end), from: [last.id], to: [running.id] },
      ],
    },
  }
  const idOf = (key: string) =>
    base.issues.find((issue) => issue.key === key)!.id
  const ids = new Map(Object.keys(histories).map((key) => [idOf(key), key]))
  const snapshot: FlowBoardSnapshot = {
    ...base,
    issues: base.issues.map((issue) =>
      ids.has(issue.id) ? { ...issue, createdAt: iso(start - 3 * DAY) } : issue,
    ),
    sprints: {
      ...base.sprints!,
      items: base.sprints!.items.map((item) =>
        ids.has(item.issueId)
          ? { ...item, ...histories[ids.get(item.issueId)!]! }
          : item,
      ),
    },
  }
  const before = buildSprintBriefing(base)!.history.at(-1)!
  const briefing = buildSprintBriefing(snapshot)!
  const view = briefing.history.at(-1)!
  const keys = (refs: Array<{ key: string }>) => refs.map((ref) => ref.key)

  it('tells work carried into a later sprint from work taken out for good', () => {
    expect(view.sprint.name).toBe('Sprint 23')
    expect(view.planned.length).toBe(before.planned.length + 3)
    expect(view.finishedPlanned).toBe(before.finishedPlanned)
    // All three left before the end, so all three are "removed" in the plan.
    expect(keys(view.removed).sort()).toEqual([
      'SHOP-247',
      'SHOP-248',
      'SHOP-251',
    ])
    // Two of them went on into the next sprint; one went to the backlog.
    expect(keys(view.movedOn).sort()).toEqual(['SHOP-248', 'SHOP-251'])
    // Carried over: those two, and SHOP-231, which Jira moved on when the
    // sprint was completed (it stays in Sprint 23 and joins Sprint 24).
    expect(keys(view.notFinished)).toEqual(['SHOP-231'])
    expect(keys(view.carriedOver).sort()).toEqual([
      'SHOP-231',
      'SHOP-248',
      'SHOP-251',
    ])
  })

  it('gives Steerloom AI the same split, in counts', () => {
    const ai = toAiSprintContext(briefing)!.lastSprints.at(-1)!
    expect(ai).toMatchObject({
      name: 'Sprint 23',
      removed: 3,
      backToBacklog: 1,
      carriedOver: 3,
    })
  })

  it('does not call finished work carried over, wherever it went next', () => {
    // An earlier sprint where everything finished carries nothing over.
    const clean = briefing.history.find(
      (closed) => closed.sprint.name === 'Sprint 21',
    )!
    expect(clean.carriedOver).toEqual([])
    expect(clean.movedOn).toEqual([])
  })
})
