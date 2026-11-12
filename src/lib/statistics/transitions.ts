import type { DataRow, FlowColumnMapping } from '../../types'

export interface TransitionHistoryAssessment {
  detected: boolean
  uniqueItemCount: number
  distinctStatusCount: number
  itemsWithMultipleStatuses: number
}

export function assessTransitionHistory(
  rows: DataRow[],
  mapping: FlowColumnMapping,
): TransitionHistoryAssessment {
  if (!mapping.itemId || !mapping.status) {
    return {
      detected: false,
      uniqueItemCount: 0,
      distinctStatusCount: 0,
      itemsWithMultipleStatuses: 0,
    }
  }

  const statusesByItem = new Map<string, Set<string>>()
  const allStatuses = new Set<string>()

  rows.forEach((row) => {
    const item = row[mapping.itemId]?.trim() ?? ''
    const status = row[mapping.status]?.trim() ?? ''
    if (!item || !status) return

    const statuses = statusesByItem.get(item) ?? new Set<string>()
    statuses.add(status)
    statusesByItem.set(item, statuses)
    allStatuses.add(status)
  })

  const itemsWithMultipleStatuses = [...statusesByItem.values()].filter(
    (statuses) => statuses.size > 1,
  ).length

  return {
    detected: allStatuses.size > 1 && itemsWithMultipleStatuses > 0,
    uniqueItemCount: statusesByItem.size,
    distinctStatusCount: allStatuses.size,
    itemsWithMultipleStatuses,
  }
}

export function dateLikeColumns(rows: DataRow[], columns: string[]): string[] {
  return columns.filter((column) => {
    const values = rows
      .map((row) => row[column]?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 200)
    if (!values.length) return false

    const usable = values.filter((value) => {
      const recognisableDateShape =
        /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value) ||
        /^\d{1,2}[/.-](?:\d{1,2}|[A-Za-z]{3,})[/.-]\d{2,4}/.test(value)
      return recognisableDateShape && Number.isFinite(Date.parse(value))
    }).length
    return usable / values.length >= 0.8
  })
}

export function transitionTimestampColumns(
  rows: DataRow[],
  mapping: FlowColumnMapping,
  columns: string[],
): string[] {
  if (!mapping.itemId) return []

  return dateLikeColumns(rows, columns).filter((column) => {
    const valuesByItem = new Map<string, Set<string>>()
    rows.forEach((row) => {
      const item = row[mapping.itemId]?.trim() ?? ''
      const value = row[column]?.trim() ?? ''
      if (!item || !value) return
      const values = valuesByItem.get(item) ?? new Set<string>()
      values.add(value)
      valuesByItem.set(item, values)
    })
    return [...valuesByItem.values()].some((values) => values.size > 1)
  })
}
