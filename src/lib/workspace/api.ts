import { workspaceRequestPath } from './request-path'
import {
  normalizeTrelloBoard,
  type TrelloBoardHistory,
} from '../data-source/trello'
import {
  normalizeAzureBoard,
  type AzureBoardHistory,
} from '../data-source/azure-devops'
import {
  JiraBoardDataSource,
  type JiraBoardGateway,
} from '../data-source/jira-gateway'
import type { FlowBoardSnapshot } from '../../types'
import {
  PROGRESS_CONTENT_TYPE,
  readJsonBody,
  readProgressResponse,
  type ProgressListener,
} from '../progress'
import type {
  SavedDashboard,
  WorkspaceBoard,
  WorkspaceConnection,
  WorkspaceSession,
} from './model'

/** A failed request, with the server's machine-readable reason when it gave one. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message)
  }
}

export async function workspaceRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(workspaceRequestPath(path), {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const value = await readJsonBody<{ error?: string; reason?: string }>(
    response,
  )
  return checked<T>(path, response.ok, response.status, value)
}
function checked<T>(
  path: string,
  ok: boolean,
  status: number,
  value: { error?: string; reason?: string },
): T {
  if (!ok) {
    if (status === 401 && !path.startsWith('/api/auth/'))
      window.dispatchEvent(new Event('flowlens-session-expired'))
    throw new RequestError(
      value.error ?? 'Could not complete this request.',
      typeof value.reason === 'string' ? value.reason : undefined,
    )
  }
  return value as T
}
export function getSession(signal?: AbortSignal) {
  return workspaceRequest<{ session: WorkspaceSession | null }>(
    '/api/auth/session',
    'GET',
    undefined,
    signal,
  )
}
export function authenticate(
  mode: 'login' | 'register',
  body: { username: string; password: string; workspaceName?: string },
) {
  return workspaceRequest<{ session: WorkspaceSession }>(
    `/api/auth/${mode}`,
    'POST',
    body,
  )
}
export function saveDashboard(dashboard: SavedDashboard) {
  return workspaceRequest<{ session: WorkspaceSession }>(
    '/api/workspace/dashboards',
    'PUT',
    dashboard,
  )
}
export function getBoards(connectionId: string, signal?: AbortSignal) {
  return workspaceRequest<{ boards: WorkspaceBoard[] }>(
    `/api/workspace/connections/${encodeURIComponent(connectionId)}/boards`,
    'GET',
    undefined,
    signal,
  )
}
export async function getBoardSnapshot(
  connection: WorkspaceConnection,
  boardId: string,
  signal?: AbortSignal,
  onProgress?: ProgressListener,
  /** Reload from the provider even if the server loaded this board recently. */
  fresh = false,
): Promise<FlowBoardSnapshot> {
  const path = `/api/workspace/connections/${encodeURIComponent(connection.id)}/boards/${encodeURIComponent(boardId)}/snapshot${fresh ? '?fresh=1' : ''}`
  // Ask for a live progress stream; plain JSON answers are still accepted.
  const reply = await fetch(workspaceRequestPath(path), {
    method: 'GET',
    credentials: 'same-origin',
    signal,
    headers: { Accept: `${PROGRESS_CONTENT_TYPE}, application/json` },
  })
  const read = await readProgressResponse<{
    payload?: unknown
    error?: string
  }>(reply, onProgress)
  const response = checked<{ payload: unknown }>(
    path,
    read.ok,
    read.status,
    read.value,
  )
  if (
    connection.provider === 'trello' ||
    connection.provider === 'azure-devops'
  ) {
    const snapshot =
      connection.provider === 'trello'
        ? normalizeTrelloBoard(
            response.payload as TrelloBoardHistory,
            new Date().toISOString(),
          )
        : normalizeAzureBoard(
            response.payload as AzureBoardHistory,
            new Date().toISOString(),
          )
    return {
      ...snapshot,
      source: { ...snapshot.source, connectionId: connection.id },
    }
  }
  const payload = response.payload as {
    board: Awaited<ReturnType<JiraBoardGateway['getBoard']>>
    issues: Awaited<ReturnType<JiraBoardGateway['getBoardIssues']>>
    changes: Awaited<ReturnType<JiraBoardGateway['getStatusChanges']>>
    historyWarnings?: unknown
  }
  const source = new JiraBoardDataSource({
    getBoard: async () => payload.board,
    getBoardIssues: async () => payload.issues,
    getStatusChanges: async () => payload.changes,
  })
  const snapshot = await source.loadBoard(boardId, signal)
  const historyWarnings = Array.isArray(payload.historyWarnings)
    ? payload.historyWarnings
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 3)
    : []
  return {
    ...snapshot,
    ...(historyWarnings.length ? { historyWarnings } : {}),
    source: {
      ...snapshot.source,
      kind:
        connection.jiraEdition === 'cloud' ? 'jira-cloud' : 'jira-data-center',
      connectionId: connection.id,
      projectKey: connection.projectKey,
    },
  }
}
