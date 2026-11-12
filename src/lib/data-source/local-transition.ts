import type {
  FlowBoardSnapshot,
  FlowColumnMapping,
  ImportedDataset,
} from '../../types'

export function localStatusId(status: string): string {
  return `local-status:${encodeURIComponent(status)}`
}

export function localColumnId(status: string): string {
  return `local-column:${encodeURIComponent(status)}`
}

export function buildLocalBoardSnapshot(
  dataset: ImportedDataset,
  mapping: FlowColumnMapping,
): FlowBoardSnapshot {
  const statusNames: string[] = []
  const seenStatuses = new Set<string>()
  const issues = new Map<
    string,
    {
      id: string
      key: string
      issueTypeId: string
      issueTypeName: string
      createdAt: string
    }
  >()
  const transitions: FlowBoardSnapshot['transitions'] = []

  dataset.rows.forEach((row) => {
    const issueKey = row[mapping.itemId]?.trim() ?? ''
    const statusName = row[mapping.status]?.trim() ?? ''
    const enteredAt = row[mapping.transitionDate]?.trim() ?? ''
    if (!issueKey) return

    if (!issues.has(issueKey)) {
      const issueTypeName = mapping.itemType
        ? (row[mapping.itemType]?.trim() ?? '')
        : ''
      issues.set(issueKey, {
        id: issueKey,
        key: issueKey,
        issueTypeId: issueTypeName
          ? `local-issue-type:${encodeURIComponent(issueTypeName)}`
          : '',
        issueTypeName,
        createdAt: mapping.createdDate
          ? (row[mapping.createdDate]?.trim() ?? '')
          : '',
      })
    }

    if (statusName && !seenStatuses.has(statusName)) {
      seenStatuses.add(statusName)
      statusNames.push(statusName)
    }
    if (statusName && enteredAt && Number.isFinite(Date.parse(enteredAt))) {
      transitions.push({
        issueId: issueKey,
        statusId: localStatusId(statusName),
        enteredAt,
      })
    }
  })

  return {
    source: {
      kind: 'local-transition-csv',
      label: dataset.filename,
    },
    board: {
      id: `local-board:${encodeURIComponent(dataset.filename)}`,
      name: 'Local workflow',
      statuses: statusNames.map((name) => ({
        id: localStatusId(name),
        name,
      })),
      columns: statusNames.map((name) => ({
        id: localColumnId(name),
        name,
        statusIds: [localStatusId(name)],
      })),
    },
    issues: [...issues.values()],
    transitions,
    loadedAt: dataset.importedAt,
  }
}

/**
 * The stages to measure when a board is first opened: the work under way.
 * The person can change them before the briefing is built.
 */
export function suggestLocalBoardColumns(
  snapshot: FlowBoardSnapshot,
): string[] {
  // Jira and Azure Boards say which statuses are in progress: the columns
  // that hold only those, whatever the team calls them.
  const category = new Map(
    snapshot.board.statuses.map((status) => [status.id, status.category]),
  )
  const active = snapshot.board.columns
    .filter(
      (column) =>
        column.statusIds.length > 0 &&
        column.statusIds.every((id) => category.get(id) === 'in-progress'),
    )
    .map((column) => column.id)
  if (active.length) return active
  const candidates = snapshot.board.columns.map((column) => ({
    id: column.id,
    value: column.name
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .trim(),
  }))
  const preferred = [
    'in progress',
    'doing',
    'development',
    'in development',
    'code review',
    'in code review',
    'review',
    'in review',
    'testing',
    'in testing',
    'qa',
    'in qa',
  ]
  const selected = candidates
    .filter(({ value }) => preferred.includes(value))
    .map(({ id }) => id)
  if (selected.length) return selected
  // Names Steerloom does not know (another language, a team's own words):
  // a board runs from waiting to finished, so the work under way sits
  // between its first and last column. Never the first column alone when
  // there is a choice: that is usually the backlog.
  const between = candidates.slice(1, -1)
  return (between.length ? between : candidates.slice(0, 1)).map(({ id }) => id)
}
