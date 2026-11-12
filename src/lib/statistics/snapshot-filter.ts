import type { AnalysisFilters, FlowBoardSnapshot, FlowIssue } from '../../types'
import { boardJourneys } from './journey'

export interface ExitPeriod {
  start: string
  end: string
  days: number
}

export function availableSnapshotIssueTypes(
  snapshot: FlowBoardSnapshot,
): string[] {
  const issueTypes = new Map<string, string>()
  snapshot.issues.forEach((issue) => {
    const label = issue.issueTypeName.trim()
    const key = normaliseIssueType(label)
    if (key && !issueTypes.has(key)) issueTypes.set(key, label)
  })
  return [...issueTypes.values()].sort((left, right) =>
    left.localeCompare(right),
  )
}

export function filterBoardSnapshot(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  now = new Date(),
): FlowBoardSnapshot {
  const period = resolveExitPeriod(filters.windowDays, now)
  return filterBoardSnapshotByExitPeriod(snapshot, filters, period)
}

export function resolveExitPeriod(
  windowDays: number | null,
  now = new Date(),
): ExitPeriod | null {
  if (windowDays === null) return null
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )
  return {
    start: new Date(end - windowDays * 86_400_000).toISOString(),
    end: new Date(end).toISOString(),
    days: windowDays,
  }
}

export function previousExitPeriod(period: ExitPeriod): ExitPeriod {
  const start = Date.parse(period.start)
  const duration = period.days * 86_400_000
  return {
    start: new Date(start - duration).toISOString(),
    end: period.start,
    days: period.days,
  }
}

export function snapshotAtTime(
  snapshot: FlowBoardSnapshot,
  endExclusive: string,
): FlowBoardSnapshot {
  const end = Date.parse(endExclusive)
  if (!Number.isFinite(end)) return snapshot
  const issues = snapshot.issues.filter((issue) => {
    const created = Date.parse(issue.createdAt)
    return !Number.isFinite(created) || created < end
  })
  const issueIds = new Set(issues.map((issue) => issue.id))
  return {
    ...snapshot,
    issues,
    transitions: snapshot.transitions.filter(
      (transition) =>
        issueIds.has(transition.issueId) &&
        Date.parse(transition.enteredAt) < end,
    ),
    loadedAt: endExclusive,
  }
}

export function filterBoardSnapshotByExitPeriod(
  snapshot: FlowBoardSnapshot,
  filters: AnalysisFilters,
  period: ExitPeriod | null,
): FlowBoardSnapshot {
  const start = period ? Date.parse(period.start) : Number.NEGATIVE_INFINITY
  const end = period ? Date.parse(period.end) : Number.POSITIVE_INFINITY
  const latestExitTimes =
    period === null
      ? null
      : latestCompletedExitTimes(snapshot, filters.selectedColumnIds)
  const issues = snapshot.issues.filter((issue) => {
    if (!inTypeScope(issue, filters.ticketTypes)) return false
    if (period === null) return true
    const latestExit = latestExitTimes?.get(issue.id)
    return latestExit !== undefined && latestExit >= start && latestExit < end
  })
  const issueIds = new Set(issues.map((issue) => issue.id))

  return {
    ...snapshot,
    issues,
    transitions: snapshot.transitions.filter((transition) =>
      issueIds.has(transition.issueId),
    ),
  }
}

function latestCompletedExitTimes(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): Map<string, number> {
  const latestExitTimes = new Map<string, number>()
  boardJourneys(snapshot, selectedColumnIds).forEach((journey, issueId) => {
    if (journey.outcome === 'finished')
      latestExitTimes.set(issueId, journey.finishedTime)
  })
  return latestExitTimes
}

/**
 * Whether an item is in the report's type scope. With no types chosen, every
 * type except sub-tasks and epics counts: they are parts or containers of
 * other work and would double-count it. Choosing their types includes them.
 */
export function inTypeScope(
  issue: Pick<FlowIssue, 'issueTypeName' | 'hierarchy'>,
  ticketTypes: string[],
): boolean {
  const selected = ticketTypes.map(normaliseIssueType).filter(Boolean)
  if (!selected.length) return !issue.hierarchy
  return selected.includes(normaliseIssueType(issue.issueTypeName))
}

function normaliseIssueType(value: string): string {
  return value.trim().toLowerCase()
}
