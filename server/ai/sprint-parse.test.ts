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
