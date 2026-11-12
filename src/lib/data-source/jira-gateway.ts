import type {
  FlowBoardSnapshot,
  FlowIssue,
  FlowStatus,
  FlowTransition,
} from '../../types'
import type { BoardDataSource } from './types'

export interface JiraBoardRecord {
  id: string
  name: string
  columns: Array<{
    id: string
    name: string
    statuses: FlowStatus[]
  }>
}

export interface JiraIssueRecord extends FlowIssue {
  currentStatus: FlowStatus
}

export interface JiraStatusChangeRecord {
  issueId: string
  changedAt: string
  fromStatus: FlowStatus | null
  toStatus: FlowStatus
}

export interface JiraBoardGateway {
  getBoard(boardId: string, signal?: AbortSignal): Promise<JiraBoardRecord>
  getBoardIssues(
    boardId: string,
    signal?: AbortSignal,
  ): Promise<JiraIssueRecord[]>
  getStatusChanges(
    issueIds: string[],
    signal?: AbortSignal,
  ): Promise<JiraStatusChangeRecord[]>
}

export class JiraBoardDataSource implements BoardDataSource {
  readonly kind = 'jira-data-center' as const

  constructor(private readonly gateway: JiraBoardGateway) {}

  async loadBoard(
    boardId: string,
    signal?: AbortSignal,
  ): Promise<FlowBoardSnapshot> {
    const [board, loadedIssues] = await Promise.all([
      this.gateway.getBoard(boardId, signal),
      this.gateway.getBoardIssues(boardId, signal),
    ])
    const issues = uniqueIssuesById(loadedIssues)
    const changes = await this.gateway.getStatusChanges(
      issues.map((issue) => issue.id),
      signal,
    )
    const transitions = normaliseJiraTransitions(issues, changes)
    const statuses = new Map<string, FlowStatus>()
    board.columns.forEach((column) =>
      column.statuses.forEach((status) => statuses.set(status.id, status)),
    )
    // Statuses that are not on the board keep their category, which decides
    // whether moving there means finished, paused or returned.
    const keep = (status: FlowStatus | null) => {
      if (status && !statuses.has(status.id)) statuses.set(status.id, status)
    }
    issues.forEach((issue) => keep(issue.currentStatus))
    changes.forEach((change) => {
      keep(change.fromStatus)
      keep(change.toStatus)
    })

    return {
      source: { kind: 'jira-data-center', label: board.name },
      board: {
        id: board.id,
        name: board.name,
        statuses: [...statuses.values()],
        columns: board.columns.map((column) => ({
          id: column.id,
          name: column.name,
          statusIds: column.statuses.map((status) => status.id),
        })),
      },
      issues: issues.map((issue) => ({
        id: issue.id,
        key: issue.key,
        issueTypeId: issue.issueTypeId,
        issueTypeName: issue.issueTypeName,
        createdAt: issue.createdAt,
        browseUrl: issue.browseUrl,
        ...(issue.title ? { title: issue.title } : {}),
        ...(issue.resolution ? { resolution: issue.resolution } : {}),
        ...(issue.hierarchy ? { hierarchy: issue.hierarchy } : {}),
        ...(issue.assignee ? { assignee: issue.assignee } : {}),
        ...(issue.ownerKnown ? { ownerKnown: true } : {}),
      })),
      transitions,
      loadedAt: new Date().toISOString(),
    }
  }
}

function uniqueIssuesById(issues: JiraIssueRecord[]): JiraIssueRecord[] {
  const seenIssueIds = new Set<string>()
  return issues.filter((issue) => {
    if (seenIssueIds.has(issue.id)) return false
    seenIssueIds.add(issue.id)
    return true
  })
}

function normaliseJiraTransitions(
  issues: JiraIssueRecord[],
  changes: JiraStatusChangeRecord[],
): FlowTransition[] {
  const changesByIssue = new Map<string, JiraStatusChangeRecord[]>()
  changes.forEach((change) => {
    const issueChanges = changesByIssue.get(change.issueId) ?? []
    issueChanges.push(change)
    changesByIssue.set(change.issueId, issueChanges)
  })

  return issues.flatMap((issue) => {
    const issueChanges = [...(changesByIssue.get(issue.id) ?? [])].sort(
      (left, right) => Date.parse(left.changedAt) - Date.parse(right.changedAt),
    )
    if (!issueChanges.length) {
      return issue.createdAt
        ? [
            {
              issueId: issue.id,
              statusId: issue.currentStatus.id,
              enteredAt: issue.createdAt,
            },
          ]
        : []
    }

    const first = issueChanges[0]
    const initial =
      first?.fromStatus && issue.createdAt
        ? [
            {
              issueId: issue.id,
              statusId: first.fromStatus.id,
              enteredAt: issue.createdAt,
            },
          ]
        : []
    return [
      ...initial,
      ...issueChanges.map((change) => ({
        issueId: issue.id,
        statusId: change.toStatus.id,
        enteredAt: change.changedAt,
      })),
    ]
  })
}
