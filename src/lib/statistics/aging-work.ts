import type { FlowBoardSnapshot, WorkInProgressAgePoint } from '../../types'
import { uniqueIssuesByIdentity } from '../issue-identity'
import { issueJourney, orderedEventsByIssue, stageZoneLookup } from './journey'

export interface AgingWorkVisit {
  status: string
  enteredAt: string
  exitedAt: string | null
  durationDays: number
  measured: boolean
}
export interface AgingWorkItem extends WorkInProgressAgePoint {
  id: string
  columnId: string
  column: string
  currentStageAgeDays: number
  history: AgingWorkVisit[]
}

// Ages use observed status intervals, including previous measured visits, up to
// loadedAt. A reporting window filters completions, never the age of active work.
export function collectAgingWork(
  snapshot: FlowBoardSnapshot,
  selectedColumnIds: string[],
): AgingWorkItem[] {
  const asOf = Date.parse(snapshot.loadedAt)
  if (!Number.isFinite(asOf)) return []
  if (!selectedColumnIds.length) return []
  const zoneOf = stageZoneLookup(snapshot.board, selectedColumnIds)
  // Active work sits in a measured column or a paused one between them
  // (for example Blocked); only measured time adds to its age.
  const columnsByStatus = new Map<string, { id: string; name: string }>()
  for (const column of snapshot.board.columns) {
    for (const status of column.statusIds) {
      const zone = zoneOf(status)
      if (zone !== 'tracked' && zone !== 'paused') continue
      const selected = selectedColumnIds.includes(column.id)
      if (!columnsByStatus.has(status) || selected)
        columnsByStatus.set(status, column)
    }
  }
  const names = new Map(
    snapshot.board.statuses.map((status) => [status.id, status.name]),
  )
  const histories = orderedEventsByIssue(snapshot, asOf)
  return uniqueIssuesByIdentity(snapshot.issues)
    .flatMap((issue): AgingWorkItem[] => {
      const events = histories.get(issue.id) ?? []
      if (issueJourney(issue, events, zoneOf).outcome !== 'active') return []
      const ordered = events.filter(
        (event, index, all) =>
          index === 0 || event.statusId !== all[index - 1]!.statusId,
      )
      const current = ordered.at(-1)
      const column = current ? columnsByStatus.get(current.statusId) : undefined
      if (!current || !column) return []
      const history = ordered.map((event, index): AgingWorkVisit => {
        const next = ordered[index + 1]
        return {
          status: names.get(event.statusId) ?? event.statusId,
          enteredAt: new Date(event.time).toISOString(),
          exitedAt: next ? new Date(next.time).toISOString() : null,
          durationDays: ((next?.time ?? asOf) - event.time) / 86_400_000,
          measured: zoneOf(event.statusId) === 'tracked',
        }
      })
      let stageStart = current.time
      for (let index = ordered.length - 2; index >= 0; index--) {
        const event = ordered[index]!
        if (columnsByStatus.get(event.statusId)?.id !== column.id) break
        stageStart = event.time
      }
      return [
        {
          id: issue.id,
          item: issue.key,
          browseUrl: issue.browseUrl,
          ...(issue.title ? { title: issue.title } : {}),
          currentStatus: names.get(current.statusId) ?? current.statusId,
          columnId: column.id,
          column: column.name,
          ageInSelectedColumns: history.reduce(
            (age, visit) => age + (visit.measured ? visit.durationDays : 0),
            0,
          ),
          currentStageAgeDays: (asOf - stageStart) / 86_400_000,
          history,
        },
      ]
    })
    .sort(
      (a, b) =>
        b.ageInSelectedColumns - a.ageInSelectedColumns ||
        a.item.localeCompare(b.item),
    )
}

export function agingBaselineState(
  age: number,
  p85: number | null,
): 'beyond' | 'within' | 'unavailable' {
  if (p85 === null || !Number.isFinite(p85) || p85 < 0) return 'unavailable'
  return age > p85 ? 'beyond' : 'within'
}
