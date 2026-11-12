import type { FlowMetricId } from '../../lib/statistics/flow-evidence'
import type { ExitPeriod } from '../../lib/statistics/snapshot-filter'

export function externalHttpUrl(value?: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatDays(value: number | null): string {
  return value === null ? 'Not available' : `${formatNumber(value)} days`
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`
}

export function metricTitle(metric: FlowMetricId) {
  if (metric === 'completed-observations') return 'Items finished'
  if (metric === 'median-cycle-time') return 'Cycle time (median)'
  if (metric === 'percentile-85') return 'Usual limit (P85)'
  return 'Throughput (items per week)'
}

export function formatPeriod(period: ExitPeriod) {
  const endInclusive = new Date(Date.parse(period.end) - 1)
  return `${formatDateOnly(period.start)} – ${formatDateOnly(endInclusive.toISOString())}`
}

function formatDateOnly(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(parsed))
}

export function formatEvidenceDate(value: string) {
  return formatDateOnly(value)
}

export function formatCount(value: number | null) {
  return value === null ? 'Not available' : value.toLocaleString()
}

export function formatCompactDays(value: number | null) {
  return value === null ? 'Not available' : `${formatNumber(value)}d`
}

export function formatThroughput(value: number | null) {
  return value === null ? 'Not available' : `${formatNumber(value)}/week`
}

export function formatChangeMagnitude(
  value: number,
  format: 'count' | 'days' | 'throughput',
) {
  if (format === 'days') return `${formatNumber(value)}d`
  if (format === 'throughput') return `${formatNumber(value)}/week`
  return formatNumber(value)
}

export interface TrendDescriptor {
  direction: 'up' | 'down' | 'flat'
  tone: 'positive' | 'negative' | 'neutral'
  /** Short visible label, e.g. "+3 vs previous 30 days". */
  label: string
  /** Full spoken label for assistive technology. */
  description: string
}

// Compares a metric with the previous period. Differences under 0.05 count as
// no change, matching the period-comparison table.
export function describeTrend(
  current: number | null,
  previous: number | null,
  format: 'count' | 'days' | 'throughput',
  betterWhen: 'higher' | 'lower',
  periodDays: number,
): TrendDescriptor | null {
  if (current === null || previous === null) return null
  const difference = current - previous
  const period = `previous ${periodDays} days`
  if (Math.abs(difference) < 0.05) {
    return {
      direction: 'flat',
      tone: 'neutral',
      label: `Unchanged vs ${period}`,
      description: `Unchanged compared with the ${period}`,
    }
  }
  const increased = difference > 0
  const favorable = increased ? betterWhen === 'higher' : betterWhen === 'lower'
  const magnitude = formatChangeMagnitude(Math.abs(difference), format)
  return {
    direction: increased ? 'up' : 'down',
    tone: favorable ? 'positive' : 'negative',
    label: `${increased ? '+' : '−'}${magnitude} vs ${period}`,
    description: `${increased ? 'Up' : 'Down'} ${magnitude} compared with the ${period}; ${favorable ? 'favourable' : 'unfavourable'} movement`,
  }
}

const WEEK_MS = 7 * 86_400_000

// A UTC week (Monday ISO date) is partial when the reporting period or the
// report time cuts into it. Without a fixed period only the running week is
// marked, because earlier coverage is unknown rather than partial.
export function isPartialWeek(
  week: string,
  period: ExitPeriod | null,
  now: Date,
): boolean {
  const start = Date.parse(`${week}T00:00:00.000Z`)
  if (!Number.isFinite(start)) return false
  const end = start + WEEK_MS
  const nowTime = now.getTime()
  if (period) {
    const periodStart = Date.parse(period.start)
    const periodEnd = Math.min(Date.parse(period.end), nowTime)
    return start < periodStart || end > periodEnd
  }
  return end > nowTime
}

// Builds a path for a small self-drawing line; needs at least two points.
export function sparklinePath(
  values: number[],
  width = 200,
  height = 44,
  inset = 3,
): string | null {
  const usable = values.filter((value) => Number.isFinite(value))
  if (usable.length < 2) return null
  const min = Math.min(...usable)
  const max = Math.max(...usable)
  const span = max - min || 1
  const step = (width - inset * 2) / (usable.length - 1)
  return usable
    .map((value, index) => {
      const x = inset + index * step
      const y = inset + (1 - (value - min) / span) * (height - inset * 2)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function formatWeekLabel(week: string): string {
  const parsed = Date.parse(`${week}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return week
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(parsed))
}
