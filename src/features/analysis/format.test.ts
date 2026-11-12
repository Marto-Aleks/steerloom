import { describe, expect, it } from 'vitest'
import {
  describeTrend,
  formatWeekLabel,
  isPartialWeek,
  metricTitle,
  sparklinePath,
} from './format'

describe('describeTrend', () => {
  it('returns null when either period lacks a value', () => {
    expect(describeTrend(null, 3, 'count', 'higher', 30)).toBeNull()
    expect(describeTrend(3, null, 'count', 'higher', 30)).toBeNull()
  })

  it('treats tiny differences as unchanged', () => {
    expect(describeTrend(5, 5.04, 'days', 'lower', 30)).toMatchObject({
      direction: 'flat',
      tone: 'neutral',
      label: 'Unchanged vs previous 30 days',
    })
  })

  it('judges direction against what is better for the metric', () => {
    expect(describeTrend(20, 17, 'count', 'higher', 30)).toMatchObject({
      direction: 'up',
      tone: 'positive',
      label: '+3 vs previous 30 days',
    })
    expect(describeTrend(7, 6, 'days', 'lower', 30)).toMatchObject({
      direction: 'up',
      tone: 'negative',
      label: '+1d vs previous 30 days',
      description:
        'Up 1d compared with the previous 30 days; unfavourable movement',
    })
    expect(describeTrend(4, 4.5, 'throughput', 'higher', 90)).toMatchObject({
      direction: 'down',
      tone: 'negative',
      label: '−0.5/week vs previous 90 days',
    })
  })
})

describe('isPartialWeek', () => {
  const now = new Date('2026-10-21T10:00:00Z') // Wednesday
  const period = {
    start: '2026-09-22T00:00:00.000Z', // Tuesday
    end: '2026-10-22T00:00:00.000Z',
    days: 30,
  }

  it('marks the first week when the period starts mid-week', () => {
    expect(isPartialWeek('2026-09-21', period, now)).toBe(true)
    expect(isPartialWeek('2026-09-28', period, now)).toBe(false)
  })

  it('marks the running week, bounded by the report time', () => {
    expect(isPartialWeek('2026-10-12', period, now)).toBe(false)
    expect(isPartialWeek('2026-10-19', period, now)).toBe(true)
  })

  it('marks only the running week without a fixed period', () => {
    expect(isPartialWeek('2026-10-12', null, now)).toBe(false)
    expect(isPartialWeek('2026-10-19', null, now)).toBe(true)
    expect(isPartialWeek('not-a-week', null, now)).toBe(false)
  })
})

describe('sparklinePath', () => {
  it('needs two finite points and scales the range to the box', () => {
    expect(sparklinePath([])).toBeNull()
    expect(sparklinePath([4])).toBeNull()
    expect(sparklinePath([4, Number.NaN])).toBeNull()
    expect(sparklinePath([0, 10], 200, 44)).toBe('M3.0 41.0 L197.0 3.0')
    expect(sparklinePath([5, 5], 200, 44)).toBe('M3.0 41.0 L197.0 41.0')
  })
})

describe('labels', () => {
  it('formats week labels in UTC and uses plain metric names', () => {
    expect(formatWeekLabel('2026-10-19')).toBe('19 Oct')
    expect(formatWeekLabel('Days 0–6')).toBe('Days 0–6')
    expect(metricTitle('median-cycle-time')).toBe('Cycle time (median)')
    expect(metricTitle('exit-throughput')).toBe('Throughput (items per week)')
  })
})
