import { describe, expect, it } from 'vitest'
import type { FlowBoardSnapshot } from '../../types'
import {
  calculateBoardMetrics,
  cycleTimeDistribution,
  cycleTimeDays,
  findDelayedWorkInProgress,
  median,
  percentile,
  rollingCycleTimeTrend,
  summarizeBoardSelection,
  throughputRateForWindow,
} from '.'

const base = Date.parse('2026-01-01T00:00:00Z')
const at = (day: number) => new Date(base + day * 86_400_000).toISOString()

const snapshot: FlowBoardSnapshot = {
  source: { kind: 'jira-data-center', label: 'Delivery board' },
  board: {
    id: 'board-1',
    name: 'Delivery board',
    statuses: [
      { id: 'todo', name: 'To Do' },
      { id: 'ip', name: 'In Progress' },
      { id: 'review', name: 'Code Review' },
      { id: 'blocked', name: 'Blocked' },
      { id: 'done', name: 'Done' },
    ],
    columns: [
      { id: 'todo-col', name: 'To Do', statusIds: ['todo'] },
      { id: 'ip-col', name: 'In Progress', statusIds: ['ip'] },
      { id: 'review-col', name: 'Code Review', statusIds: ['review'] },
      { id: 'done-col', name: 'Done', statusIds: ['done'] },
    ],
  },
  issues: Array.from({ length: 6 }, (_, index) => ({
    id: `ITEM-${index + 1}`,
    key: `ITEM-${index + 1}`,
    issueTypeId: 'story',
    issueTypeName: 'Story',
    createdAt: at(0),
    browseUrl: `https://jira.example.invalid/browse/ITEM-${index + 1}`,
  })),
  transitions: [
    { issueId: 'ITEM-1', statusId: 'todo', enteredAt: at(0) },
    { issueId: 'ITEM-1', statusId: 'ip', enteredAt: at(1) },
    { issueId: 'ITEM-1', statusId: 'review', enteredAt: at(3) },
    { issueId: 'ITEM-1', statusId: 'done', enteredAt: at(5) },
    { issueId: 'ITEM-2', statusId: 'ip', enteredAt: at(1) },
    { issueId: 'ITEM-2', statusId: 'done', enteredAt: at(3) },
    { issueId: 'ITEM-2', statusId: 'ip', enteredAt: at(5) },
    { issueId: 'ITEM-2', statusId: 'review', enteredAt: at(6) },
    { issueId: 'ITEM-2', statusId: 'done', enteredAt: at(10) },
    { issueId: 'ITEM-3', statusId: 'ip', enteredAt: at(1) },
    { issueId: 'ITEM-3', statusId: 'blocked', enteredAt: at(4) },
    { issueId: 'ITEM-3', statusId: 'review', enteredAt: at(8) },
    { issueId: 'ITEM-3', statusId: 'done', enteredAt: at(10) },
    { issueId: 'ITEM-4', statusId: 'ip', enteredAt: at(1) },
    { issueId: 'ITEM-4', statusId: 'done', enteredAt: at(4) },
    { issueId: 'ITEM-5', statusId: 'ip', enteredAt: at(1) },
    { issueId: 'ITEM-5', statusId: 'done', enteredAt: at(4) },
    { issueId: 'ITEM-5', statusId: 'ip', enteredAt: at(7) },
    { issueId: 'ITEM-6', statusId: 'todo', enteredAt: at(0) },
    { issueId: 'ITEM-6', statusId: 'done', enteredAt: at(4) },
  ],
  loadedAt: at(12),
}

describe('flow statistics', () => {
  it('calculates medians and interpolated percentiles', () => {
    expect(median([9, 1, 5])).toBe(5)
    expect(median([1, 3, 5, 9])).toBe(4)
    expect(percentile([1, 2, 3, 4, 5], 85)).toBeCloseTo(4.4)
  })

  it('preserves fractional cycle days', () => {
    expect(cycleTimeDays('2026-01-03', '2026-01-10')).toBe(7)
    expect(cycleTimeDays('2026-01-03T00:00:00Z', '2026-01-03T12:00:00Z')).toBe(
      0.5,
    )
  })

  it('uses stable operational cycle-time ranges despite long-tail values', () => {
    const distribution = cycleTimeDistribution([
      1, 7.9, 8, 14.9, 15, 30.9, 31, 60.9, 61, 90.9, 91, 120.9, 121, 180.9, 181,
      365.9, 366,
    ])

    expect(distribution.map(({ range, items }) => ({ range, items }))).toEqual([
      { range: '0–7d', items: 2 },
      { range: '8–14d', items: 2 },
      { range: '15–30d', items: 2 },
      { range: '31–60d', items: 2 },
      { range: '61–90d', items: 2 },
      { range: '91–120d', items: 2 },
      { range: '121–180d', items: 2 },
      { range: '181–365d', items: 2 },
      { range: '366d+', items: 1 },
    ])
    expect(distribution.reduce((sum, point) => sum + point.items, 0)).toBe(17)
    expect(distribution.at(-1)?.cumulativeShare).toBe(100)
  })

  it('identifies the operational range containing the interpolated P85', () => {
    const values = [
      ...Array<number>(70).fill(20),
      ...Array<number>(15).fill(80),
      ...Array<number>(9).fill(128),
      ...Array<number>(13).fill(250),
    ]
    const distribution = cycleTimeDistribution(values)

    expect(percentile(values, 85)).toBe(128)
    expect(
      distribution.filter(({ containsPercentile85 }) => containsPercentile85),
    ).toEqual([
      expect.objectContaining({
        range: '121–180d',
        items: 9,
      }),
    ])
    expect(
      distribution.find(({ range }) => range === '61–90d')?.cumulativeShare,
    ).toBeCloseTo((85 / 107) * 100)
  })

  it('calculates throughput across the full selected calendar window', () => {
    expect(throughputRateForWindow(12, 60)).toBeCloseTo(1.4)
    expect(throughputRateForWindow(6, 90)).toBeCloseTo(0.4667)
    expect(throughputRateForWindow(12, null)).toBeNull()
  })

  it('builds a rolling weekly cycle-time trend without connecting individual tickets', () => {
    const trend = rollingCycleTimeTrend(
      [
        cyclePoint('DEMO-1', 2, '2026-01-06T09:00:00Z'),
        cyclePoint('DEMO-2', 4, '2026-01-08T09:00:00Z'),
        cyclePoint('DEMO-3', 6, '2026-01-13T09:00:00Z'),
        cyclePoint('DEMO-4', 20, '2026-01-27T09:00:00Z'),
      ],
      2,
    )

    expect(trend).toEqual([
      expect.objectContaining({
        week: '2026-01-05',
        completedItemCount: 2,
        rollingItemCount: 2,
        rollingMedianCycleTime: 3,
      }),
      expect.objectContaining({
        week: '2026-01-12',
        completedItemCount: 1,
        rollingItemCount: 3,
        rollingMedianCycleTime: 4,
      }),
      expect.objectContaining({
        week: '2026-01-19',
        completedItemCount: 0,
        rollingItemCount: 1,
        rollingMedianCycleTime: 6,
        rollingPercentile85CycleTime: 6,
      }),
      expect.objectContaining({
        week: '2026-01-26',
        completedItemCount: 1,
        rollingItemCount: 1,
        rollingMedianCycleTime: 20,
        rollingPercentile85CycleTime: 20,
      }),
    ])
    expect(trend[0]?.rollingPercentile85CycleTime).toBeCloseTo(3.7)
    expect(trend[1]?.rollingPercentile85CycleTime).toBeCloseTo(5.4)
  })

  it('sums selected-column visits, includes re-entry, and excludes current WIP', () => {
    const metrics = calculateBoardMetrics(snapshot, ['ip-col', 'review-col'])

    expect(metrics?.uniqueItemCount).toBe(6)
    expect(metrics?.workItemCount).toBe(4)
    expect(metrics?.cycleTimeItemCount).toBe(4)
    expect(metrics?.medianCycleTime).toBe(4.5)
    expect(metrics?.percentile85CycleTime).toBeCloseTo(6.1)
    expect(
      metrics?.cycleTimes.map(({ item, browseUrl, cycleTime }) => ({
        item,
        browseUrl,
        cycleTime,
      })),
    ).toEqual([
      {
        item: 'ITEM-4',
        browseUrl: 'https://jira.example.invalid/browse/ITEM-4',
        cycleTime: 3,
      },
      {
        item: 'ITEM-1',
        browseUrl: 'https://jira.example.invalid/browse/ITEM-1',
        cycleTime: 4,
      },
      {
        item: 'ITEM-2',
        browseUrl: 'https://jira.example.invalid/browse/ITEM-2',
        cycleTime: 7,
      },
      {
        item: 'ITEM-3',
        browseUrl: 'https://jira.example.invalid/browse/ITEM-3',
        cycleTime: 5,
      },
    ])
  })

  it('finds only current work in progress older than the completed-ticket P85', () => {
    const metrics = calculateBoardMetrics(snapshot, ['ip-col', 'review-col'])
    const delayed = findDelayedWorkInProgress(
      snapshot,
      ['ip-col', 'review-col'],
      metrics?.percentile85CycleTime ?? Number.POSITIVE_INFINITY,
    )

    expect(delayed).toEqual([
      {
        item: 'ITEM-5',
        browseUrl: 'https://jira.example.invalid/browse/ITEM-5',
        ageInSelectedColumns: 8,
        currentStatus: 'In Progress',
      },
    ])
    expect(delayed.some(({ item }) => item === 'ITEM-2')).toBe(false)
  })

  it('counts each ticket once in the week of its latest exit', () => {
    const metrics = calculateBoardMetrics(snapshot, ['ip-col', 'review-col'])
    expect(metrics?.weeklyThroughput).toEqual([
      { week: '2026-01-05', items: 4 },
    ])
  })

  it('emits one observation per immutable issue id', () => {
    const duplicateIssueSnapshot: FlowBoardSnapshot = {
      ...snapshot,
      issues: [...snapshot.issues, { ...snapshot.issues[0]! }],
    }

    const metrics = calculateBoardMetrics(duplicateIssueSnapshot, [
      'ip-col',
      'review-col',
    ])

    expect(metrics?.workItemCount).toBe(4)
    expect(
      metrics?.cycleTimes.filter(({ item }) => item === 'ITEM-1'),
    ).toHaveLength(1)
    expect(metrics?.weeklyThroughput).toEqual([
      { week: '2026-01-05', items: 4 },
    ])
  })

  it('does not repeat a Jira key received under conflicting internal ids', () => {
    const duplicateIssueSnapshot: FlowBoardSnapshot = {
      ...snapshot,
      issues: [
        ...snapshot.issues,
        {
          ...snapshot.issues[0]!,
          id: 'SHADOW-ITEM-1',
          key: ' item-1 ',
        },
      ],
      transitions: [
        ...snapshot.transitions,
        ...snapshot.transitions
          .filter(({ issueId }) => issueId === 'ITEM-1')
          .map((transition) => ({
            ...transition,
            issueId: 'SHADOW-ITEM-1',
          })),
      ],
    }

    const metrics = calculateBoardMetrics(duplicateIssueSnapshot, [
      'ip-col',
      'review-col',
    ])

    expect(metrics?.uniqueItemCount).toBe(6)
    expect(metrics?.workItemCount).toBe(4)
    expect(
      metrics?.cycleTimes.filter(({ item }) => item === 'ITEM-1'),
    ).toHaveLength(1)
  })

  it('returns no completed analysis when every matching ticket is still selected', () => {
    const wipOnly: FlowBoardSnapshot = {
      ...snapshot,
      issues: [snapshot.issues[0]!],
      transitions: [
        { issueId: 'ITEM-1', statusId: 'todo', enteredAt: at(0) },
        { issueId: 'ITEM-1', statusId: 'ip', enteredAt: at(1) },
      ],
    }
    expect(calculateBoardMetrics(wipOnly, ['ip-col'])).toBeNull()
  })

  it('summarizes ticket activity for the selected board columns', () => {
    expect(summarizeBoardSelection(snapshot, ['ip-col'])).toEqual({
      enteredItemCount: 5,
      workInProgressItemCount: 1,
      selectedTransitionCount: 7,
    })
    expect(summarizeBoardSelection(snapshot, ['review-col'])).toEqual({
      enteredItemCount: 3,
      workInProgressItemCount: 0,
      selectedTransitionCount: 3,
    })
  })
})

function cyclePoint(item: string, cycleTime: number, cycleEnd: string) {
  return {
    item,
    cycleTime,
    sequence: Number(item.slice(-1)),
    cycleStart: '2026-01-01T09:00:00Z',
    cycleEnd,
    completedLabel: cycleEnd.slice(0, 10),
  }
}
