import type { FlowBoardSnapshot } from '../../types'

export const EXIT_WINDOW_OPTIONS = [
  { value: null, label: 'All time' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 180 days' },
] as const

/**
 * How many live (non-archived) items currently sit in each board column,
 * judged by every item's most recent dated status entry. Items whose latest
 * status is not mapped to any column are not counted.
 */
export function countItemsByColumn(
  snapshot: FlowBoardSnapshot,
): Record<string, number> {
  const columnByStatus = new Map<string, string>()
  snapshot.board.columns.forEach((column) =>
    column.statusIds.forEach((statusId) =>
      columnByStatus.set(statusId, column.id),
    ),
  )
  const liveIssueIds = new Set(
    snapshot.issues.filter((issue) => !issue.archived).map((issue) => issue.id),
  )
  const latest = new Map<string, { statusId: string; enteredAt: number }>()
  snapshot.transitions.forEach((transition) => {
    if (!liveIssueIds.has(transition.issueId)) return
    const enteredAt = Date.parse(transition.enteredAt)
    if (!Number.isFinite(enteredAt)) return
    const current = latest.get(transition.issueId)
    if (!current || enteredAt >= current.enteredAt)
      latest.set(transition.issueId, {
        statusId: transition.statusId,
        enteredAt,
      })
  })
  const counts: Record<string, number> = {}
  snapshot.board.columns.forEach((column) => (counts[column.id] = 0))
  latest.forEach(({ statusId }) => {
    const columnId = columnByStatus.get(statusId)
    if (columnId !== undefined) counts[columnId] = (counts[columnId] ?? 0) + 1
  })
  return counts
}

/** Plain-language sentence for the selected stages, in board order. */
export function describeMeasuredStages(
  columns: FlowBoardSnapshot['board']['columns'],
  selectedColumnIds: string[],
): string {
  const names = columns
    .filter((column) => selectedColumnIds.includes(column.id))
    .map((column) => column.name)
  return names.length ? names.join(' → ') : 'Nothing selected yet'
}
