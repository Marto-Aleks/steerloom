import type { AnalysisFilters, DataRow } from '../../types'

export function availableTicketTypes(
  rows: DataRow[],
  itemTypeColumn: string,
): string[] {
  if (!itemTypeColumn) return []

  return [
    ...new Set(
      rows.map((row) => row[itemTypeColumn]?.trim() ?? '').filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right))
}

export function availableStatusValues(
  rows: DataRow[],
  statusColumn: string,
): string[] {
  if (!statusColumn) return []

  const values: string[] = []
  const seen = new Set<string>()
  rows.forEach((row) => {
    const status = row[statusColumn]?.trim() ?? ''
    if (status && !seen.has(status)) {
      seen.add(status)
      values.push(status)
    }
  })
  return values
}

export function analysisScopeLabel(filters: AnalysisFilters): string {
  const period =
    filters.windowDays === null
      ? 'All time'
      : `Exited in the last ${filters.windowDays} days`
  const types =
    filters.ticketTypes.length === 0
      ? 'All item types except sub-tasks and epics'
      : filters.ticketTypes.join(', ')
  return `${period} · ${types}`
}
