import { describe, expect, it } from 'vitest'
import {
  isServiceExpectation,
  summarizeServiceExpectation,
} from './service-expectation'
import type { CycleTimePoint } from '../../types'
import type { AgingWorkItem } from './aging-work'

const completed = (days: number[]): CycleTimePoint[] =>
  days.map((cycleTime, sequence) => ({
    item: `DEMO-${sequence + 1}`,
    cycleTime,
    sequence,
    cycleStart: '2026-10-01T00:00:00Z',
    cycleEnd: '2026-10-12T00:00:00Z',
    completedLabel: 'Oct 12',
  }))
const active = (days: number[]): AgingWorkItem[] =>
  days.map((ageInSelectedColumns, index) => ({
    id: String(index),
    item: `DEMO-${index + 20}`,
    currentStatus: 'Doing',
    columnId: 'active',
    column: 'Development',
    currentStageAgeDays: 1,
    ageInSelectedColumns,
    history: [],
  }))

describe('team service expectations', () => {
  it('includes the threshold boundary and keeps active work outside completed attainment', () => {
    const summary = summarizeServiceExpectation(
      { days: 7, targetPercent: 75 },
      completed([0, 6, 7, 8]),
      active([7, 7.1, 12]),
    )
    expect(summary).toMatchObject({
      sampleCount: 4,
      within: 3,
      attainmentPercent: 75,
      meetsTarget: true,
    })
    expect(summary.beyond.map((item) => item.ageInSelectedColumns)).toEqual([
      7.1, 12,
    ])
    expect(
      summarizeServiceExpectation(
        { days: 7, targetPercent: 85 },
        completed([0, 6, 7, 8]),
        [],
      ).meetsTarget,
    ).toBe(false)
  })
  it('does not invent attainment without a valid completed sample', () => {
    expect(
      summarizeServiceExpectation(
        { days: 7, targetPercent: 85 },
        completed([NaN, Infinity, -1]),
        active([10]),
      ),
    ).toMatchObject({
      sampleCount: 0,
      within: 0,
      attainmentPercent: null,
      meetsTarget: null,
    })
  })
  it('validates bounded finite thresholds and percentages', () => {
    for (const days of [0, -1, Infinity, NaN, 3651, '7'])
      expect(isServiceExpectation({ days, targetPercent: 85 })).toBe(false)
    for (const targetPercent of [0, -1, Infinity, NaN, 101, '85'])
      expect(isServiceExpectation({ days: 7, targetPercent })).toBe(false)
    expect(isServiceExpectation({ days: 0.5, targetPercent: 99.5 })).toBe(true)
    expect(isServiceExpectation(null)).toBe(false)
  })
})
