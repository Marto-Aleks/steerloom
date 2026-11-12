/**
 * Monte Carlo throughput forecast.
 *
 * Resamples observed daily exit counts (calendar days, zero days included)
 * to answer two questions deterministically:
 *  - When will the current work in progress (N items) be finished?
 *  - How many items will exit the selected columns in the next 14 days?
 *
 * The PRNG is seeded from the input data, so the same board history always
 * produces the same forecast.
 */

const DAY_MS = 86_400_000

export const FORECAST_TRIALS = 10_000
export const FORECAST_DEFAULT_SAMPLE_DAYS = 56
export const FORECAST_HORIZON_DAYS = 14
export const FORECAST_MAX_DAYS = 365
export const FORECAST_MIN_COMPLETED_ITEMS = 10
export const FORECAST_MIN_SAMPLE_DAYS = 14

export interface ForecastInput {
  /** Exit timestamps of completed items (latest exit from the selected columns). */
  completedExits: string[]
  /** The moment the forecast is made; forecast days start the next UTC day. */
  asOf: string
  /** Number of items currently in the selected columns. */
  currentWorkInProgress: number
  /** Earliest observed board history; the sample never starts before it. */
  historyStart?: string
  /** Sample window length in calendar days (default 56 = 8 weeks). */
  sampleDays?: number
  trials?: number
}

export interface ForecastBasis {
  /** First sampled UTC day (yyyy-mm-dd). */
  sampleStart: string
  /** Day after the last sampled UTC day (yyyy-mm-dd); the as-of day is excluded. */
  sampleEndExclusive: string
  sampledDays: number
  completedItems: number
}

export interface ThroughputForecast {
  basis: ForecastBasis
  /** Null when there is no current work in progress to finish. */
  finishCurrentWork: {
    items: number
    /** Finish dates (yyyy-mm-dd); null means beyond a year. */
    p50: string | null
    p70: string | null
    p85: string | null
    p95: string | null
    beyondYear: boolean
    /** Share of trials (0–100) in which all current work finishes within FORECAST_HORIZON_DAYS. */
    withinTwoWeeksPercent: number
  } | null
  nextTwoWeeks: {
    atLeastItemsP85: number
    itemsP50: number
  }
}

export type ThroughputForecastResult =
  | { forecast: ThroughputForecast; simulatedDays: number }
  | { unavailable: string; basis: ForecastBasis | null }

export function forecastThroughput({
  completedExits,
  asOf,
  currentWorkInProgress,
  historyStart,
  sampleDays = FORECAST_DEFAULT_SAMPLE_DAYS,
  trials = FORECAST_TRIALS,
}: ForecastInput): ThroughputForecastResult {
  const asOfTime = parseInstant(asOf)
  if (asOfTime === null) {
    return { unavailable: 'The forecast date is not valid.', basis: null }
  }
  const sampleEnd = utcDayStart(asOfTime)
  const exits = completedExits
    .map(parseInstant)
    .filter((time): time is number => time !== null && time < sampleEnd)
  if (!exits.length) {
    return {
      unavailable: 'No completed items with usable exit dates before today.',
      basis: null,
    }
  }

  const firstExitDay = utcDayStart(Math.min(...exits))
  const historyStartTime =
    historyStart === undefined ? null : parseInstant(historyStart)
  const earliest =
    historyStartTime === null
      ? firstExitDay
      : Math.min(firstExitDay, utcDayStart(historyStartTime))
  const boundedSampleDays = Math.max(1, Math.floor(sampleDays))
  const sampleStart = Math.max(earliest, sampleEnd - boundedSampleDays * DAY_MS)
  const days = Math.round((sampleEnd - sampleStart) / DAY_MS)
  const daily = new Array<number>(days).fill(0)
  exits.forEach((time) => {
    if (time < sampleStart) return
    const index = Math.floor((time - sampleStart) / DAY_MS)
    daily[index] = (daily[index] ?? 0) + 1
  })
  const completedItems = daily.reduce((sum, value) => sum + value, 0)
  const basis: ForecastBasis = {
    sampleStart: isoDay(sampleStart),
    sampleEndExclusive: isoDay(sampleEnd),
    sampledDays: days,
    completedItems,
  }

  if (days < FORECAST_MIN_SAMPLE_DAYS) {
    return {
      unavailable: `Only ${days} days of history are available; at least ${FORECAST_MIN_SAMPLE_DAYS} are needed.`,
      basis,
    }
  }
  if (completedItems < FORECAST_MIN_COMPLETED_ITEMS) {
    return {
      unavailable: `Only ${completedItems} items were completed in the sampled ${days} days; at least ${FORECAST_MIN_COMPLETED_ITEMS} are needed.`,
      basis,
    }
  }

  const items = Math.max(0, Math.floor(currentWorkInProgress))
  const random = mulberry32(seedFrom(daily, items, sampleStart))
  const trialCount = Math.max(1, Math.floor(trials))
  const sample = Int32Array.from(daily)
  let simulatedDays = 0

  let finishCurrentWork: ThroughputForecast['finishCurrentWork'] = null
  if (items > 0) {
    // Days to finish per trial; FORECAST_MAX_DAYS + 1 marks "beyond a year".
    const finishDays = new Int32Array(trialCount)
    for (let trial = 0; trial < trialCount; trial += 1) {
      let finished = 0
      let day = 0
      while (finished < items && day < FORECAST_MAX_DAYS) {
        finished += sample[Math.floor(random() * days)] ?? 0
        day += 1
      }
      simulatedDays += day
      finishDays[trial] = finished >= items ? day : FORECAST_MAX_DAYS + 1
    }
    let withinHorizon = 0
    finishDays.forEach((value) => {
      if (value <= FORECAST_HORIZON_DAYS) withinHorizon += 1
    })
    finishDays.sort()
    const dateAt = (confidence: number) => {
      const value = finishDays[atMostIndex(trialCount, confidence)] ?? 0
      return value > FORECAST_MAX_DAYS
        ? null
        : isoDay(sampleEnd + value * DAY_MS)
    }
    const p50 = dateAt(0.5)
    const p70 = dateAt(0.7)
    const p85 = dateAt(0.85)
    const p95 = dateAt(0.95)
    finishCurrentWork = {
      items,
      p50,
      p70,
      p85,
      p95,
      beyondYear: p95 === null,
      withinTwoWeeksPercent: Math.round((withinHorizon / trialCount) * 100),
    }
  }

  const horizonCounts = new Int32Array(trialCount)
  for (let trial = 0; trial < trialCount; trial += 1) {
    let count = 0
    for (let day = 0; day < FORECAST_HORIZON_DAYS; day += 1) {
      count += sample[Math.floor(random() * days)] ?? 0
    }
    horizonCounts[trial] = count
  }
  simulatedDays += trialCount * FORECAST_HORIZON_DAYS
  horizonCounts.sort()

  return {
    forecast: {
      basis,
      finishCurrentWork,
      nextTwoWeeks: {
        atLeastItemsP85: horizonCounts[atLeastIndex(trialCount, 0.85)] ?? 0,
        itemsP50: horizonCounts[atLeastIndex(trialCount, 0.5)] ?? 0,
      },
    },
    simulatedDays,
  }
}

/** Index of the smallest value that at least `confidence` of trials reach or beat (ascending sort). */
function atMostIndex(trials: number, confidence: number): number {
  return Math.min(trials - 1, Math.max(0, Math.ceil(confidence * trials) - 1))
}

/** Index of the largest value that at least `confidence` of trials meet or exceed (ascending sort). */
function atLeastIndex(trials: number, confidence: number): number {
  return Math.min(
    trials - 1,
    Math.max(0, trials - Math.ceil(confidence * trials)),
  )
}

function parseInstant(value: string): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // Plain day numbers (relative CSV histories) have no calendar meaning.
  if (!trimmed || /^-?\d+(?:\.\d+)?$/.test(trimmed)) return null
  const time = Date.parse(trimmed)
  return Number.isFinite(time) ? time : null
}

function utcDayStart(time: number): number {
  return Math.floor(time / DAY_MS) * DAY_MS
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function seedFrom(daily: number[], items: number, sampleStart: number): number {
  // FNV-1a over the sampled history and the question asked.
  let hash = 0x811c9dc5
  const mix = (value: number) => {
    hash ^= value & 0xffff
    hash = Math.imul(hash, 0x01000193)
    hash ^= value >>> 16
    hash = Math.imul(hash, 0x01000193)
  }
  mix(Math.floor(sampleStart / DAY_MS))
  mix(items)
  daily.forEach(mix)
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}
