import type { CycleTimePoint, ThroughputPoint } from '../../types'
import type { ExitPeriod } from './snapshot-filter'

const WEEK = 7 * 86_400_000
function monday(time: number): number {
  const date = new Date(time)
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )
  return midnight - ((date.getUTCDay() + 6) % 7) * 86_400_000
}

// A fixed report window includes every intersecting UTC week, even when empty.
// Without a window, show only the observed first-to-last completion span.
export function weeklyThroughputForPeriod(
  completed: CycleTimePoint[],
  period: ExitPeriod | null,
): ThroughputPoint[] {
  const start = period ? Date.parse(period.start) : Number.NEGATIVE_INFINITY
  const end = period ? Date.parse(period.end) : Number.POSITIVE_INFINITY
  const exits = completed
    .map((point) => Date.parse(point.cycleEnd))
    .filter((time) => Number.isFinite(time) && time >= start && time < end)
  if (
    period &&
    (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
  )
    return []
  if (!period && !exits.length) return []
  const first = monday(period ? start : Math.min(...exits))
  const last = monday(period ? end - 1 : Math.max(...exits))
  const counts = new Map<number, number>()
  for (const exit of exits) {
    const week = monday(exit)
    counts.set(week, (counts.get(week) ?? 0) + 1)
  }
  const result: ThroughputPoint[] = []
  for (let week = first; week <= last; week += WEEK)
    result.push({
      week: new Date(week).toISOString().slice(0, 10),
      items: counts.get(week) ?? 0,
    })
  return result
}
