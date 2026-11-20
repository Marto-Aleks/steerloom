import { describe, expect, it } from 'vitest'
import type { AiReportContext } from '../../src/lib/ai/report-context'
import { toAiSprintContext } from '../../src/lib/ai/sprint-context'
import { buildSprintBriefing } from '../../src/lib/statistics/sprint'
import { scrumDemoSnapshot } from '../../src/lib/workspace/demo-scrum'
import { buildAiSystemPrompt } from './client'
import { getAiSkill } from './skills/registry'
import { parseSprintContext } from './sprint-parse'

const NOW = new Date('2026-11-18T12:00:00.000Z')
const snapshot = scrumDemoSnapshot(NOW)
const sprint = toAiSprintContext(buildSprintBriefing(snapshot)!)!

const context: AiReportContext = {
  generatedAt: NOW.toISOString(),
  sourceLabel: 'Fictional Scrum team',
  boardName: 'Shop team',
  scope: { selectedColumns: [], ticketTypes: [], windowDays: 30 },
  headline: {
    completedObservations: 0,
    medianCycleTimeDays: null,
    percentile85CycleTimeDays: null,
    exitThroughputPerWeek: null,
  },
  focusSignals: [],
  ticketGroupTotals: {
    completedOutliers: 0,
    delayedWorkInProgress: 0,
    reenteredWorkInProgress: 0,
  },
  weeklyThroughput: [],
  cycleTimeDistribution: [],
  weeklyCycleTimeTrend: [],
  delayedWorkInProgress: [],
  completedOutliers: [],
  reenteredWorkInProgress: [],
}

describe('the Sprint tab for Steerloom AI', () => {
  it('gives the running sprint as keys and numbers, never titles', () => {
    const running = sprint.running!
    expect(running.name).toBe('Sprint 24')
    expect(running.goal).toBeTruthy()
    expect(running.items.length).toBe(13)
    expect(running.scopeChange.added).toHaveLength(3)
    expect(sprint.planning?.planned).toBe(52)
    expect(sprint.lastSprints).toHaveLength(5)
    const json = JSON.stringify(sprint)
    for (const issue of snapshot.issues)
      expect(json).not.toContain(issue.title!)
  })

  it('passes the server’s checks as built, and fails them when tampered with', () => {
    expect(parseSprintContext(sprint)).toEqual(sprint)
    expect(parseSprintContext(undefined)).toBeUndefined()
    const bad = (change: (copy: typeof sprint) => unknown) =>
      parseSprintContext(change(structuredClone(sprint)))
    expect(
      bad((copy) => {
        copy.running!.items[0]!.key = 'not a key; DROP'
        return copy
      }),
    ).toBeNull()
    expect(
      bad((copy) => {
        ;(copy.running!.items[0] as { state: string }).state = 'great'
        return copy
      }),
    ).toBeNull()
    expect(
      bad((copy) => ({
        ...copy,
        running: {
          ...copy.running!,
          items: new Array(81).fill(copy.running!.items[0]),
        },
      })),
    ).toBeNull()
    expect(bad((copy) => ({ ...copy, unit: 'hours' }))).toBeNull()
  })

  it('adds the sprint rules to the instructions only for sprint boards', () => {
    const skill = getAiSkill('flow-diagnosis')
    expect(buildAiSystemPrompt(context, skill)).not.toContain('\nSPRINT\n')
    const prompt = buildAiSystemPrompt({ ...context, sprint }, skill)
    expect(prompt).toContain('\nSPRINT\n')
    expect(prompt).toMatch(/never a target, and never compare teams or people/)
    expect(prompt).toContain('"Sprint 24"')
  })
})

describe('free text a team wrote in Jira', () => {
  it('is shortened to what the server accepts, so no question is refused', () => {
    const briefing = buildSprintBriefing(snapshot)!
    const long = 'Reliable test reports and running tests. '.repeat(40)
    const built = toAiSprintContext({
      ...briefing,
      active: {
        ...briefing.active!,
        sprint: {
          ...briefing.active!.sprint,
          name: `Shop team ${'very long sprint name '.repeat(10)}`,
          goal: long,
        },
        items: briefing.active!.items.map((item) => ({
          ...item,
          status: `${item.status} ${'and a long note '.repeat(20)}`,
        })),
      },
      history: briefing.history.map((view) => ({
        ...view,
        sprint: { ...view.sprint, goal: long },
      })),
    })!
    expect(built.running!.goal!.length).toBeLessThanOrEqual(300)
    expect(built.running!.goal).toMatch(/^Reliable test reports.*…$/)
    expect(built.running!.name.length).toBeLessThanOrEqual(80)
    expect(built.lastSprints[0]!.goal!.length).toBeLessThanOrEqual(300)
    // The server takes it as built.
    expect(parseSprintContext(built)).toEqual(built)
  })
})

describe('boards with and without sprints', () => {
  const skill = getAiSkill('flow-diagnosis')
  it('tells the assistant not to speak of sprints where the board shows none', () => {
    const prompt = buildAiSystemPrompt(context, skill)
    expect(prompt).toContain('This board shows no sprints')
    expect(prompt).not.toContain('END_SPRINT')
  })
  it('tells it how to read carried-over work, and to keep points and items apart', () => {
    const prompt = buildAiSystemPrompt({ ...context, sprint }, skill)
    expect(prompt).not.toContain('This board shows no sprints')
    expect(prompt).toContain(
      'never set a number of items against a number of points',
    )
    expect(prompt).toContain('never call carried-over work churn')
  })
})
