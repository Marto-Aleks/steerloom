import { describe, expect, it } from 'vitest'
import type { AnalysisFilters, FlowBoardSnapshot } from '../../types'
import { calculateBoardMetrics } from '.'
import {
  buildFlowPeriodComparison,
  buildMetricEvidence,
  explainMetric,
} from './flow-evidence'
import { filterBoardSnapshot, resolveExitPeriod } from './snapshot-filter'

const filters: AnalysisFilters = {
  ticketTypes: ['Story'],
  windowDays: 30,
  selectedColumnIds: ['progress-column'],
}

const snapshot: FlowBoardSnapshot = {
  source: { kind: 'jira-data-center', label: 'Example board' },
  board: {
    id: 'board-1',
    name: 'Example board',
    statuses: [
      { id: 'todo', name: 'To Do' },
      { id: 'progress', name: 'In Progress' },
      { id: 'done', name: 'Done' },
    ],
    columns: [
      { id: 'todo-column', name: 'To Do', statusIds: ['todo'] },
      {
        id: 'progress-column',
        name: 'In Progress',
        statusIds: ['progress'],
      },
      { id: 'done-column', name: 'Done', statusIds: ['done'] },
    ],
  },
  issues: [
    issue('DEMO-1', '2026-03-01T00:00:00Z'),
    issue('DEMO-2', '2026-03-01T00:00:00Z'),
    issue('DEMO-3', '2026-02-01T00:00:00Z'),
    issue('DEMO-4', '2026-02-01T00:00:00Z'),
    issue('DEMO-5', '2026-03-10T00:00:00Z'),
    issue('DEMO-6', '2026-01-10T00:00:00Z'),
    issue('DEMO-7', '2026-01-01T00:00:00Z'),
    issue('DEMO-8', '2026-01-01T00:00:00Z'),
  ],
  transitions: [
    transition('DEMO-1', 'progress', '2026-03-05T00:00:00Z'),
    transition('DEMO-1', 'done', '2026-03-10T00:00:00Z'),
    transition('DEMO-2', 'progress', '2026-03-05T00:00:00Z'),
    transition('DEMO-2', 'done', '2026-03-20T00:00:00Z'),
    transition('DEMO-3', 'progress', '2026-02-05T00:00:00Z'),
    transition('DEMO-3', 'done', '2026-02-10T00:00:00Z'),
    transition('DEMO-4', 'progress', '2026-02-01T00:00:00Z'),
    transition('DEMO-4', 'done', '2026-02-20T00:00:00Z'),
    transition('DEMO-5', 'progress', '2026-03-10T00:00:00Z'),
    transition('DEMO-6', 'progress', '2026-01-10T00:00:00Z'),
    transition('DEMO-6', 'done', '2026-02-05T00:00:00Z'),
    transition('DEMO-6', 'progress', '2026-02-20T00:00:00Z'),
    transition('DEMO-7', 'todo', '2026-01-01T00:00:00Z'),
    transition('DEMO-8', 'progress', '2026-01-02T00:00:00Z'),
    transition('DEMO-8', 'done', '2026-01-20T00:00:00Z'),
  ],
  loadedAt: '2026-03-31T12:00:00Z',
}

const now = new Date('2026-03-31T12:00:00Z')

describe('metric evidence and period comparison', () => {
  it('reconciles included ticket evidence with the current headline metrics', () => {
    const scoped = filterBoardSnapshot(snapshot, filters, now)
    const metrics = calculateBoardMetrics(scoped, filters.selectedColumnIds)
    const period = resolveExitPeriod(filters.windowDays, now)

    expect(metrics).not.toBeNull()
    const evidence = buildMetricEvidence(snapshot, filters, metrics!, period)

    expect(evidence.includedTickets.map(({ key }) => key)).toEqual([
      'DEMO-1',
      'DEMO-2',
    ])
    expect(evidence.includedTickets).toHaveLength(metrics?.workItemCount ?? 0)
    expect(
      evidence.includedTickets.map((ticket) =>
        ticket.visits.reduce((total, visit) => total + visit.durationDays, 0),
      ),
    ).toEqual(
      evidence.includedTickets.map(({ cycleTimeDays }) => cycleTimeDays),
    )
    expect(
      evidence.exclusions.find(({ id }) => id === 'current-wip')?.tickets,
    ).toEqual([
      expect.objectContaining({ key: 'DEMO-5' }),
      expect.objectContaining({ key: 'DEMO-6' }),
    ])
    expect(
      evidence.exclusions.find(({ id }) => id === 'never-entered')?.tickets,
    ).toEqual([expect.objectContaining({ key: 'DEMO-7' })])
    expect(
      evidence.exclusions
        .find(({ id }) => id === 'no-exit-in-period')
        ?.tickets.map(({ key }) => key),
    ).toEqual(['DEMO-3', 'DEMO-4', 'DEMO-8'])
  })

  it('compares equal adjacent periods and reconstructs WIP at each boundary', () => {
    const comparison = buildFlowPeriodComparison(snapshot, filters, now)

    expect(comparison?.current.period).toEqual({
      start: '2026-03-02T00:00:00.000Z',
      end: '2026-04-01T00:00:00.000Z',
      days: 30,
    })
    expect(comparison?.previous.period).toEqual({
      start: '2026-01-31T00:00:00.000Z',
      end: '2026-03-02T00:00:00.000Z',
      days: 30,
    })
    expect(comparison?.current).toEqual(
      expect.objectContaining({
        completedObservations: 2,
        medianCycleTimeDays: 10,
        percentile85CycleTimeDays: 13.5,
        delayedWorkInProgress: 2,
        reenteredWorkInProgress: 1,
        historyCoverage: 'complete',
      }),
    )
    expect(comparison?.current.exitThroughputPerWeek).toBeCloseTo(0.4667)
    expect(comparison?.previous).toEqual(
      expect.objectContaining({
        completedObservations: 2,
        medianCycleTimeDays: 12,
        percentile85CycleTimeDays: 16.9,
        delayedWorkInProgress: 1,
        reenteredWorkInProgress: 1,
        historyCoverage: 'complete',
      }),
    )
  })

  it('makes the displayed formulas reconcile with the completed sample', () => {
    const scoped = filterBoardSnapshot(snapshot, filters, now)
    const metrics = calculateBoardMetrics(scoped, filters.selectedColumnIds)!
    const period = resolveExitPeriod(filters.windowDays, now)

    const explain = (metric: Parameters<typeof explainMetric>[0]) =>
      explainMetric(metric, metrics, period, ['In progress'], '1 – 30 Jan')
    expect(explain('completed-observations').meaning).toBe(
      '2 items left In progress for good between 1 – 30 Jan.',
    )
    const median = explain('median-cycle-time')
    expect(median.meaning).toMatch(
      /^Half of the finished items took .* or less\.$/,
    )
    expect(median.how).toContain('the two in the middle took')
    expect(median.anchors.map(({ role }) => role)).toEqual(['middle', 'middle'])
    const limit = explain('percentile-85')
    expect(limit.meaning).toMatch(
      /^1 of 2 finished items took .* That is the 85% mark/,
    )
    expect(limit.how).toContain('falls between')
    expect(limit.anchors).toHaveLength(2)
    expect(explain('exit-throughput').meaning).toContain('about 0.5 a week')
  })

  it('counts an exit on an adjacent-period boundary exactly once', () => {
    const boundarySnapshot: FlowBoardSnapshot = {
      ...snapshot,
      issues: [...snapshot.issues, issue('DEMO-9', '2026-02-20T00:00:00Z')],
      transitions: [
        ...snapshot.transitions,
        transition('DEMO-9', 'progress', '2026-02-25T00:00:00Z'),
        transition('DEMO-9', 'done', '2026-03-02T00:00:00Z'),
      ],
    }

    const comparison = buildFlowPeriodComparison(boundarySnapshot, filters, now)

    expect(comparison?.current.completedObservations).toBe(3)
    expect(comparison?.previous.completedObservations).toBe(2)
  })

  it('does not create a comparison for an all-time report', () => {
    expect(
      buildFlowPeriodComparison(
        snapshot,
        { ...filters, windowDays: null },
        now,
      ),
    ).toBeNull()
  })
})

function issue(key: string, createdAt: string) {
  return {
    id: key,
    key,
    issueTypeId: 'story',
    issueTypeName: 'Story',
    createdAt,
    browseUrl: `https://jira.example.invalid/browse/${key}`,
  }
}

function transition(issueId: string, statusId: string, enteredAt: string) {
  return { issueId, statusId, enteredAt }
}
