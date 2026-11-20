import { describe, expect, it } from 'vitest'
import type { FlowMetrics } from '../../types'
import { forecastThroughput } from '../statistics/forecast'
import { buildAiReportContext } from './report-context'

const metrics: FlowMetrics = {
  uniqueItemCount: 4,
  validTransitionCount: 20,
  workItemCount: 3,
  cycleTimeItemCount: 3,
  medianCycleTime: 5,
  percentile85CycleTime: 9,
  weeklyThroughput: [{ week: '2026-09-07', items: 3 }],
  cycleTimes: [],
  distribution: [
    {
      range: '0–7d',
      items: 2,
      share: 66.67,
      cumulativeShare: 66.67,
      containsPercentile85: false,
    },
  ],
  explanation: 'Fictional flow explanation.',
}

describe('AI report context', () => {
  it('includes aggregate evidence and minimized ticket fields only', () => {
    const context = buildAiReportContext({
      generatedAt: '2026-09-10T09:00:00Z',
      sourceLabel: 'DEMO · Fictional board',
      boardName: 'Fictional board',
      filters: {
        ticketTypes: ['Story'],
        windowDays: 30,
        selectedColumnIds: ['progress'],
      },
      selectedColumnNames: ['In Progress'],
      metrics,
      exitThroughputPerWeek: 0.7,
      focusSignals: [
        {
          id: 'delayed-wip',
          severity: 'critical',
          title: '1 ticket beyond P85',
          evidence: 'Current work exceeded 9 days.',
          action: 'Review the delayed set.',
          jiraFilter: {
            label: 'View in Jira',
            href: 'https://example.invalid/issues/?jql=key%20in%20(DEMO-4)',
          },
        },
      ],
      weeklyCycleTimeTrend: [],
      delayedWorkInProgress: [
        {
          item: 'DEMO-4',
          currentStatus: 'In Progress',
          ageInSelectedColumns: 12,
          browseUrl: 'https://example.invalid/browse/DEMO-4',
        },
      ],
      completedOutliers: [
        {
          item: 'DEMO-3',
          cycleTime: 10,
          sequence: 3,
          cycleStart: '2026-09-01T00:00:00Z',
          cycleEnd: '2026-09-10T00:00:00Z',
          completedLabel: '2026-09-10',
          browseUrl: 'https://example.invalid/browse/DEMO-3',
        },
      ],
      reenteredWorkInProgress: [{ item: 'DEMO-2', currentStatus: 'Review' }],
      periodComparison: {
        current: {
          period: {
            start: '2026-08-12T00:00:00.000Z',
            end: '2026-09-11T00:00:00.000Z',
            days: 30,
          },
          completedObservations: 3,
          medianCycleTimeDays: 5,
          percentile85CycleTimeDays: 9,
          exitThroughputPerWeek: 0.7,
          delayedWorkInProgress: 1,
          reenteredWorkInProgress: 1,
          historyCoverage: 'complete',
        },
        previous: {
          period: {
            start: '2026-07-13T00:00:00.000Z',
            end: '2026-08-12T00:00:00.000Z',
            days: 30,
          },
          completedObservations: 4,
          medianCycleTimeDays: 4,
          percentile85CycleTimeDays: 7,
          exitThroughputPerWeek: 0.9,
          delayedWorkInProgress: 0,
          reenteredWorkInProgress: 0,
          historyCoverage: 'partial',
        },
      },
    })

    expect(context.headline).toEqual({
      completedObservations: 3,
      medianCycleTimeDays: 5,
      percentile85CycleTimeDays: 9,
      exitThroughputPerWeek: 0.7,
    })
    expect(context.ticketGroupTotals).toEqual({
      completedOutliers: 1,
      delayedWorkInProgress: 1,
      reenteredWorkInProgress: 1,
    })
    expect(context.delayedWorkInProgress).toEqual([
      { key: 'DEMO-4', status: 'In Progress', ageDays: 12 },
    ])
    expect(context.completedOutliers).toEqual([
      { key: 'DEMO-3', cycleTimeDays: 10 },
    ])
    expect(context.reenteredWorkInProgress).toEqual([
      { key: 'DEMO-2', status: 'Review' },
    ])
    expect(context.periodComparison?.previous).toEqual({
      start: '2026-07-13T00:00:00.000Z',
      endExclusive: '2026-08-12T00:00:00.000Z',
      completedObservations: 4,
      medianCycleTimeDays: 4,
      percentile85CycleTimeDays: 7,
      exitThroughputPerWeek: 0.9,
      delayedWorkInProgress: 0,
      reenteredWorkInProgress: 0,
      historyCoverage: 'partial',
    })
    expect(JSON.stringify(context)).not.toContain('browseUrl')
    expect(JSON.stringify(context)).not.toContain('jiraFilter')
  })

  it('passes the deterministic forecast through and its unavailable reason', () => {
    const base = {
      generatedAt: '2026-09-10T09:00:00Z',
      sourceLabel: 'DEMO · Fictional board',
      boardName: 'Fictional board',
      filters: {
        ticketTypes: [],
        windowDays: 30,
        selectedColumnIds: ['progress'],
      },
      selectedColumnNames: ['In Progress'],
      metrics,
      exitThroughputPerWeek: 0.7,
      focusSignals: [],
      weeklyCycleTimeTrend: [],
      delayedWorkInProgress: [],
      completedOutliers: [],
      reenteredWorkInProgress: [],
    }
    const completedExits = Array.from({ length: 28 }, (_, index) =>
      new Date(
        Date.parse('2026-09-09T12:00:00Z') - index * 86_400_000,
      ).toISOString(),
    )
    const result = forecastThroughput({
      completedExits,
      asOf: '2026-09-10T09:00:00Z',
      currentWorkInProgress: 3,
    })

    expect(
      buildAiReportContext({ ...base, forecast: result }).forecast,
    ).toEqual({
      basis: {
        sampleStart: '2026-08-13',
        sampleEndExclusive: '2026-09-10',
        sampledDays: 28,
        completedItems: 28,
      },
      finishCurrentWork: {
        items: 3,
        p50: '2026-09-13',
        p70: '2026-09-13',
        p85: '2026-09-13',
        p95: '2026-09-13',
        beyondYear: false,
        withinTwoWeeksPercent: 100,
      },
      nextTwoWeeks: { atLeastItemsP85: 14, itemsP50: 14 },
    })
    expect(
      buildAiReportContext({
        ...base,
        forecast: { unavailable: 'Too little history.', basis: null },
      }).forecast,
    ).toEqual({ unavailable: 'Too little history.' })
    expect(buildAiReportContext(base)).not.toHaveProperty('forecast')
  })

  it('groups active work by its current stage, longest in stage first', () => {
    const context = buildAiReportContext({
      generatedAt: '2026-09-10T09:00:00Z',
      sourceLabel: 'DEMO · Fictional board',
      boardName: 'Fictional board',
      filters: {
        ticketTypes: [],
        windowDays: 30,
        selectedColumnIds: ['p', 'r'],
      },
      selectedColumnNames: ['In Progress', 'Review'],
      metrics,
      exitThroughputPerWeek: 0.7,
      focusSignals: [],
      weeklyCycleTimeTrend: [],
      delayedWorkInProgress: [],
      completedOutliers: [],
      reenteredWorkInProgress: [],
      currentWork: [
        {
          item: 'DEMO-1',
          column: 'Review',
          ageInSelectedColumns: 9.44,
          currentStageAgeDays: 2,
        },
        {
          item: 'DEMO-2',
          column: 'Review',
          ageInSelectedColumns: 12,
          currentStageAgeDays: 7.26,
        },
        {
          item: 'DEMO-3',
          column: 'In Progress',
          ageInSelectedColumns: 3,
          currentStageAgeDays: 3,
        },
      ],
    })
    expect(context.workInProgressByStage).toEqual([
      {
        stage: 'In Progress',
        count: 1,
        items: [{ key: 'DEMO-3', ageDays: 3, daysInStage: 3 }],
      },
      {
        stage: 'Review',
        count: 2,
        items: [
          { key: 'DEMO-2', ageDays: 12, daysInStage: 7.3 },
          { key: 'DEMO-1', ageDays: 9.4, daysInStage: 2 },
        ],
      },
    ])
  })
  it('says where finished work’s time went and what happened to last week’s flagged items', () => {
    const base = {
      generatedAt: '2026-09-18T09:00:00Z',
      sourceLabel: 'DEMO · Fictional board',
      boardName: 'Fictional board',
      filters: {
        ticketTypes: [],
        windowDays: 30,
        selectedColumnIds: ['progress', 'review'],
      },
      selectedColumnNames: ['In Progress', 'Review'],
      metrics,
      exitThroughputPerWeek: 0.7,
      focusSignals: [],
      weeklyCycleTimeTrend: [],
      delayedWorkInProgress: [],
      completedOutliers: [],
      reenteredWorkInProgress: [],
    }
    const context = buildAiReportContext({
      ...base,
      stageLoads: [
        { name: 'In Progress', timeShare: 0.604 },
        { name: 'Review', timeShare: 0.396 },
        // A stage with no finished work yet has no share to give.
        { name: 'Testing' },
      ],
      flagged: {
        flaggedAt: '2026-09-11T09:00:00.000Z',
        daysAgo: 7,
        movedQuickly: 1,
        limitThen: 7.04,
        limitNow: null,
        items: [
          {
            item: 'FICT-4',
            title: 'A fictional title that must stay out',
            browseUrl: 'https://jira.example.test/browse/FICT-4',
            reason: 'late',
            flaggedAs: '12 days in progress',
            outcome: 'waiting',
            detail: 'Still in Review.',
            movedAfterDays: null,
          },
          {
            item: 'FICT-9',
            reason: 'reentered',
            flaggedAs: 'came back',
            outcome: 'moved',
            detail: 'Moved after a day.',
            movedAfterDays: 1.26,
          },
        ],
      },
    })
    expect(context.stageTime).toEqual([
      { stage: 'In Progress', sharePercent: 60 },
      { stage: 'Review', sharePercent: 40 },
    ])
    expect(context.flaggedLastWeek).toEqual({
      daysAgo: 7,
      movedQuickly: 1,
      quickDays: 2,
      limitThenDays: 7,
      items: [
        { key: 'FICT-4', reason: 'late', outcome: 'waiting' },
        {
          key: 'FICT-9',
          reason: 'came back',
          outcome: 'moved',
          movedAfterDays: 1.3,
        },
      ],
    })
    // Keys and numbers only: no titles, links or sentences.
    expect(JSON.stringify(context)).not.toMatch(/fictional title|jira\.example/)
    // Nothing to say: nothing is sent.
    const quiet = buildAiReportContext({ ...base, flagged: null })
    expect(quiet).not.toHaveProperty('stageTime')
    expect(quiet).not.toHaveProperty('flaggedLastWeek')
  })
})
