import { describe, expect, it } from 'vitest'
import {
  FORECAST_HORIZON_DAYS,
  FORECAST_MAX_DAYS,
  FORECAST_TRIALS,
  forecastThroughput,
  mulberry32,
} from './forecast'

const asOf = '2026-06-01T10:00:00Z'
const dayMs = 86_400_000

/** Fictional exits: `perDay[i]` items on the i-th day before 2026-06-01. */
function exitsFromDaily(perDay: number[]): string[] {
  const end = Date.parse('2026-06-01T00:00:00Z')
  return perDay.flatMap((count, index) =>
    Array.from({ length: count }, (_, item) =>
      new Date(
        end - (index + 1) * dayMs + (item + 1) * 3_600_000,
      ).toISOString(),
    ),
  )
}

const variedHistory = exitsFromDaily(
  Array.from({ length: 70 }, (_, index) => [0, 2, 1, 0, 3, 0, 1][index % 7]!),
)

function available(result: ReturnType<typeof forecastThroughput>) {
  if (!('forecast' in result)) throw new Error(result.unavailable)
  return result
}

describe('Monte Carlo throughput forecast', () => {
  it('is deterministic for the same input', () => {
    const input = {
      completedExits: variedHistory,
      asOf,
      currentWorkInProgress: 12,
    }
    expect(forecastThroughput(input)).toEqual(forecastThroughput(input))
  })

  it('samples the last eight calendar weeks before the as-of day', () => {
    const { forecast } = available(
      forecastThroughput({
        completedExits: variedHistory,
        asOf,
        currentWorkInProgress: 5,
      }),
    )
    expect(forecast.basis).toEqual({
      sampleStart: '2026-04-06',
      sampleEndExclusive: '2026-06-01',
      sampledDays: 56,
      completedItems: 56,
    })
  })

  it('never samples before the observed history start', () => {
    const exits = exitsFromDaily(Array.from({ length: 20 }, () => 1))
    const { forecast } = available(
      forecastThroughput({
        completedExits: exits,
        asOf,
        currentWorkInProgress: 3,
        historyStart: '2026-05-08T12:00:00Z',
      }),
    )
    expect(forecast.basis.sampleStart).toBe('2026-05-08')
    expect(forecast.basis.sampledDays).toBe(24)
    expect(forecast.basis.completedItems).toBe(20)
  })

  it('keeps percentiles monotonic', () => {
    const { forecast } = available(
      forecastThroughput({
        completedExits: variedHistory,
        asOf,
        currentWorkInProgress: 20,
      }),
    )
    const finish = forecast.finishCurrentWork!
    const dates = [finish.p50, finish.p70, finish.p85, finish.p95]
    expect(dates.every((date) => date !== null)).toBe(true)
    expect([...dates].sort()).toEqual(dates)
    expect(forecast.nextTwoWeeks.atLeastItemsP85).toBeLessThanOrEqual(
      forecast.nextTwoWeeks.itemsP50,
    )
  })

  it('finishes N items in N days for a constant one-per-day history', () => {
    const { forecast } = available(
      forecastThroughput({
        completedExits: exitsFromDaily(Array.from({ length: 56 }, () => 1)),
        asOf,
        currentWorkInProgress: 7,
      }),
    )
    expect(forecast.finishCurrentWork).toEqual({
      items: 7,
      p50: '2026-06-08',
      p70: '2026-06-08',
      p85: '2026-06-08',
      p95: '2026-06-08',
      beyondYear: false,
      withinTwoWeeksPercent: 100,
    })
    expect(forecast.nextTwoWeeks).toEqual({
      atLeastItemsP85: 14,
      itemsP50: 14,
    })
  })

  it('reports beyond a year when the work cannot finish within the cap', () => {
    const { forecast } = available(
      forecastThroughput({
        completedExits: exitsFromDaily(Array.from({ length: 56 }, () => 1)),
        asOf,
        currentWorkInProgress: 400,
      }),
    )
    expect(forecast.finishCurrentWork).toMatchObject({
      p50: null,
      p95: null,
      beyondYear: true,
      withinTwoWeeksPercent: 0,
    })
  })

  it('is unavailable for a zero-throughput history', () => {
    const result = forecastThroughput({
      completedExits: [],
      asOf,
      currentWorkInProgress: 4,
    })
    expect(result).toMatchObject({ basis: null })
    expect('unavailable' in result).toBe(true)
  })

  it('is unavailable with too few completed items or too short a window', () => {
    const fewItems = forecastThroughput({
      completedExits: exitsFromDaily(
        Array.from({ length: 56 }, (_, index) => (index % 7 === 0 ? 1 : 0)),
      ),
      asOf,
      currentWorkInProgress: 4,
    })
    expect(fewItems).toMatchObject({
      unavailable: expect.stringContaining('at least 10'),
      basis: { completedItems: 8, sampledDays: 50 },
    })

    const shortWindow = forecastThroughput({
      completedExits: exitsFromDaily(Array.from({ length: 10 }, () => 3)),
      asOf,
      currentWorkInProgress: 4,
    })
    expect(shortWindow).toMatchObject({
      unavailable: expect.stringContaining('at least 14'),
      basis: { sampledDays: 10, completedItems: 30 },
    })
  })

  it('ignores relative day numbers that carry no calendar date', () => {
    const result = forecastThroughput({
      completedExits: Array.from({ length: 30 }, (_, index) => String(index)),
      asOf,
      currentWorkInProgress: 4,
    })
    expect('unavailable' in result).toBe(true)
  })

  it('omits the finish question when there is no current work', () => {
    const { forecast } = available(
      forecastThroughput({
        completedExits: variedHistory,
        asOf,
        currentWorkInProgress: 0,
      }),
    )
    expect(forecast.finishCurrentWork).toBeNull()
  })

  it('bounds the simulation work regardless of how large WIP is', () => {
    const result = available(
      forecastThroughput({
        completedExits: exitsFromDaily(
          Array.from({ length: 56 }, (_, index) => (index % 5 === 0 ? 1 : 0)),
        ),
        asOf,
        currentWorkInProgress: 10_000,
      }),
    )
    expect(result.simulatedDays).toBeLessThanOrEqual(
      FORECAST_TRIALS * (FORECAST_MAX_DAYS + FORECAST_HORIZON_DAYS),
    )
    const typical = available(
      forecastThroughput({
        completedExits: variedHistory,
        asOf,
        currentWorkInProgress: 15,
      }),
    )
    // A typical board needs only a few weeks per trial.
    expect(typical.simulatedDays).toBeLessThan(FORECAST_TRIALS * 60)
  })

  it('uses a uniform seeded generator in [0, 1)', () => {
    const random = mulberry32(42)
    const values = Array.from({ length: 1000 }, random)
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
    expect(mulberry32(42)()).toBe(values[0])
  })
})
