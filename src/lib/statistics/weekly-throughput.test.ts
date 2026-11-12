import { describe, expect, it } from 'vitest'
import type { CycleTimePoint } from '../../types'
import { weeklyThroughputForPeriod } from './weekly-throughput'

function point(cycleEnd: string): CycleTimePoint {
  return {
    item: 'DEMO-1',
    cycleEnd,
    cycleStart: '2026-09-01T00:00:00Z',
    cycleTime: 2,
    sequence: 1,
    completedLabel: cycleEnd,
  }
}
const period = {
  start: '2026-09-16T00:00:00Z',
  end: '2026-10-07T00:00:00Z',
  days: 21,
}

describe('weekly report throughput', () => {
  it('fills empty and partial boundary weeks and keeps the end exclusive', () => {
    const result = weeklyThroughputForPeriod(
      [
        point('2026-09-15T23:59:59Z'),
        point(period.start),
        point('2026-10-06T23:59:59Z'),
        point(period.end),
        point('invalid'),
      ],
      period,
    )
    expect(result).toEqual([
      { week: '2026-09-14', items: 1 },
      { week: '2026-09-21', items: 0 },
      { week: '2026-09-28', items: 0 },
      { week: '2026-10-05', items: 1 },
    ])
    expect(result.reduce((sum, week) => sum + week.items, 0)).toBe(2)
  })
  it('shows zero weeks without inventing a completed sample', () => {
    expect(
      weeklyThroughputForPeriod([], period).map((week) => week.items),
    ).toEqual([0, 0, 0, 0])
    expect(weeklyThroughputForPeriod([], null)).toEqual([])
  })
  it('uses observed all-history boundaries and UTC week membership', () => {
    expect(
      weeklyThroughputForPeriod(
        [point('2026-09-20T23:30:00-02:00'), point('2026-10-05T00:00:00Z')],
        null,
      ),
    ).toEqual([
      { week: '2026-09-21', items: 1 },
      { week: '2026-09-28', items: 0 },
      { week: '2026-10-05', items: 1 },
    ])
    expect(
      weeklyThroughputForPeriod([], { ...period, end: period.start }),
    ).toEqual([])
  })
})
