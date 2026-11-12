import type { FlowBoardSnapshot, FlowStatus } from '../../types'

/** Azure Boards state categories (each process maps its states to these). */
export type AzureStateCategory =
  | 'Proposed'
  | 'InProgress'
  | 'Resolved'
  | 'Completed'
  | 'Removed'

export interface AzureBoardColumn {
  id: string
  name: string
  columnType: 'incoming' | 'inProgress' | 'outgoing'
  /** Split columns have a Doing and a Done part. */
  isSplit: boolean
  /** Work item type → the state items of that type have in this column. */
  stateMappings: Record<string, string>
}

/** One change of state or board column, oldest first. */
export interface AzureItemRevision {
  at: string
  state: string
  /** The board column name, when the item was on this board. */
  column?: string
  /** In the Done part of a split column. */
  done?: boolean
}

export interface AzureBoardItem {
  id: number
  type: string
  title?: string
  createdAt: string
  /** Assigned To now; absent when nobody is. */
  assignee?: string
  revisions: AzureItemRevision[]
}

export interface AzureBoardHistory {
  board: { id: string; name: string }
  /** Links to items: `${orgUrl}/${project}/_workitems/edit/{id}` */
  itemUrlPrefix: string
  columns: AzureBoardColumn[]
  /** Work item type → state → category */
  stateCategories: Record<string, Record<string, AzureStateCategory>>
  items: AzureBoardItem[]
  historyWarnings?: string[]
}

const COLUMN_CATEGORY: Record<
  AzureBoardColumn['columnType'],
  FlowStatus['category']
> = { incoming: 'todo', inProgress: 'in-progress', outgoing: 'done' }

const STATE_CATEGORY: Record<AzureStateCategory, FlowStatus['category']> = {
  Proposed: 'todo',
  InProgress: 'in-progress',
  Resolved: 'in-progress',
  Completed: 'done',
  Removed: 'done',
}

const doneId = (columnId: string) => `${columnId}:done`
const stateId = (state: string) => `state:${state}`

/**
 * Board columns become the stages, the way the team sees its board. A split
 * column becomes two statuses (Doing, Done) in one stage, so waiting time
 * inside a column stays visible. Where an item has no column (before the
 * board existed, or in a state the board does not show), its state places
 * it: through the board's state mappings, else as a status of its own.
 */
export function normalizeAzureBoard(
  payload: AzureBoardHistory,
  loadedAt: string,
): FlowBoardSnapshot {
  const columnsByName = new Map(
    payload.columns.map((column) => [column.name.toLowerCase(), column]),
  )
  const statuses: FlowStatus[] = []
  for (const column of payload.columns) {
    const category = COLUMN_CATEGORY[column.columnType]
    statuses.push({ id: column.id, name: column.name, category })
    if (column.isSplit)
      statuses.push({
        id: doneId(column.id),
        name: `${column.name} (done)`,
        category,
      })
  }
  const extraStates = new Map<string, FlowStatus>()
  const removedStateIds = new Set<string>()
  const categoryOf = (type: string, state: string) =>
    payload.stateCategories[type]?.[state]

  const statusOf = (type: string, revision: AzureItemRevision): string => {
    const removed = categoryOf(type, revision.state) === 'Removed'
    const onBoard = revision.column
      ? columnsByName.get(revision.column.toLowerCase())
      : undefined
    // The column value can be stale (the state changed outside the board):
    // trust it only while it agrees with the state.
    const mapping = onBoard?.stateMappings[type]
    if (onBoard && !removed && (!mapping || mapping === revision.state))
      return onBoard.isSplit && revision.done ? doneId(onBoard.id) : onBoard.id
    // Removed work leaves the board; keep it out of every stage.
    if (!removed) {
      const mapped = payload.columns.find(
        (column) => column.stateMappings[type] === revision.state,
      )
      if (mapped) return mapped.id
    }
    const id = stateId(revision.state)
    if (removed) removedStateIds.add(id)
    if (!extraStates.has(id)) {
      const category = categoryOf(type, revision.state)
      extraStates.set(id, {
        id,
        name: revision.state,
        ...(category ? { category: STATE_CATEGORY[category] } : {}),
      })
    }
    return id
  }

  const issues: FlowBoardSnapshot['issues'] = []
  const transitions: FlowBoardSnapshot['transitions'] = []
  let omitted = 0
  for (const item of payload.items) {
    const revisions = item.revisions.filter((revision) =>
      Number.isFinite(Date.parse(revision.at)),
    )
    if (!revisions.length || !Number.isFinite(Date.parse(item.createdAt))) {
      omitted++
      continue
    }
    const id = String(item.id)
    let previous = ''
    revisions.forEach((revision, index) => {
      const status = statusOf(item.type, revision)
      if (status === previous) return
      transitions.push({
        issueId: id,
        statusId: status,
        enteredAt: index === 0 ? item.createdAt : revision.at,
      })
      previous = status
    })
    const current = revisions.at(-1)!
    issues.push({
      id,
      key: `#${item.id}`,
      issueTypeId: item.type,
      issueTypeName: item.type,
      createdAt: item.createdAt,
      browseUrl: `${payload.itemUrlPrefix}${item.id}`,
      ...(item.title ? { title: item.title.slice(0, 140) } : {}),
      ...(item.assignee ? { assignee: item.assignee } : {}),
      ownerKnown: true,
      ...(categoryOf(item.type, current.state) === 'Removed'
        ? { resolution: 'Removed' }
        : {}),
    })
  }
  const finalColumn = [...payload.columns]
    .reverse()
    .find((column) => column.columnType === 'outgoing')
  const removedStates = [...extraStates.keys()].filter((id) =>
    removedStateIds.has(id),
  )
  return {
    source: { kind: 'azure-devops', label: payload.board.name },
    board: {
      ...payload.board,
      statuses: [...statuses, ...extraStates.values()],
      columns: payload.columns.map((column) => ({
        id: column.id,
        name: column.name,
        statusIds: [
          column.id,
          ...(column.isSplit ? [doneId(column.id)] : []),
          // Removed work never shows on an Azure board: it has left the flow
          // like closed work, and its resolution marks it as cancelled.
          ...(column === finalColumn ? removedStates : []),
        ],
      })),
    },
    issues,
    transitions,
    loadedAt,
    historyWarnings: [
      ...(payload.historyWarnings ?? []),
      ...(omitted
        ? [
            omitted === 1
              ? '1 work item was excluded because its history could not be read.'
              : `${omitted} work items were excluded because their history could not be read.`,
          ]
        : []),
    ].slice(0, 3),
  }
}
