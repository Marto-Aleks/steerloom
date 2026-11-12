import { workspaceRequestPath } from '../workspace/request-path'
import type { FlowBoardSnapshot, JiraBoardOption } from '../../types'
import {
  JiraBoardDataSource,
  type JiraBoardGateway,
  type JiraBoardRecord,
  type JiraIssueRecord,
  type JiraStatusChangeRecord,
} from './jira-gateway'

export interface JiraConnectionOption {
  id: string
  instance: string
  configured: boolean
  missing: string[]
  projectKeys: string[]
}

export interface JiraConnectionInfo {
  defaultConnectionId: string
  connections: JiraConnectionOption[]
}

interface JiraBoardPayload {
  board: JiraBoardRecord
  issues: JiraIssueRecord[]
  changes: JiraStatusChangeRecord[]
  historyWarnings?: string[]
}

interface JiraBoardsResponse {
  projectKey: string
  boards: JiraBoardOption[]
}

export async function getJiraConnection(
  signal?: AbortSignal,
): Promise<JiraConnectionInfo> {
  return requestJson<JiraConnectionInfo>('/api/jira/connection', signal)
}

export async function listJiraBoards(
  connectionId: string,
  projectKey: string,
  signal?: AbortSignal,
): Promise<JiraBoardOption[]> {
  const response = await requestJson<JiraBoardsResponse>(
    jiraProjectPath(connectionId, projectKey, 'boards'),
    signal,
  )
  return response.boards
}

export async function loadJiraBoard(
  connectionId: string,
  projectKey: string,
  boardId: string,
  signal?: AbortSignal,
): Promise<FlowBoardSnapshot> {
  const payload = await requestJson<JiraBoardPayload>(
    jiraProjectPath(
      connectionId,
      projectKey,
      `boards/${encodeURIComponent(boardId)}/snapshot`,
    ),
    signal,
  )
  const gateway: JiraBoardGateway = {
    getBoard: async () => payload.board,
    getBoardIssues: async () => payload.issues,
    getStatusChanges: async () => payload.changes,
  }
  const snapshot = await new JiraBoardDataSource(gateway).loadBoard(
    boardId,
    signal,
  )
  return {
    ...snapshot,
    ...(payload.historyWarnings?.length
      ? { historyWarnings: payload.historyWarnings.slice(0, 3) }
      : {}),
    source: {
      ...snapshot.source,
      connectionId,
      projectKey,
    },
  }
}

function jiraProjectPath(
  connectionId: string,
  projectKey: string,
  suffix: string,
): string {
  return `/api/jira/connections/${encodeURIComponent(connectionId)}/projects/${encodeURIComponent(projectKey)}/${suffix}`
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(workspaceRequestPath(path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown
  }
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string'
        ? body.error
        : 'The Jira request could not be completed.',
    )
  }
  return body as T
}
