import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { connectMiddleware } from '../http/middleware'
import type { JiraServerConnection } from './config'
import { JiraUpstreamError, JiraClient } from './jira-client'

const projectKeyPattern = /^[A-Z][A-Z0-9_]{1,29}$/
const localHostPattern = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i

export function jiraApiPlugin(
  resolveConnections: (request: IncomingMessage) => JiraServerConnection[],
): Plugin {
  const handle = createJiraHandler(resolveConnections)
  return {
    name: 'flowlens-jira-api',
    configureServer(server) {
      server.middlewares.use(connectMiddleware(handle))
    },
    configurePreviewServer(server) {
      server.middlewares.use(connectMiddleware(handle))
    },
  }
}

/** The Jira API handler on its own, for the packaged local server. */
export function createJiraHandler(
  resolveConnections: (request: IncomingMessage) => JiraServerConnection[],
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const requestUrl = request.url ?? ''
    if (!requestUrl.startsWith('/api/jira/')) {
      next()
      return
    }
    const connections = resolveConnections(request)
    setApiHeaders(response)
    if (!isLocalRequest(request)) {
      sendJson(response, 403, { error: 'Local requests only.' })
      return
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Read-only endpoint.' })
      return
    }

    const url = new URL(requestUrl, 'http://127.0.0.1')
    if (url.pathname === '/api/jira/connection') {
      sendJson(response, 200, {
        defaultConnectionId: connections[0]?.id ?? '',
        connections: connections.map((connection) => ({
          id: connection.id,
          instance: connection.instance,
          configured: connection.missing.length === 0,
          missing: connection.missing,
          projectKeys: connection.projectKeys,
        })),
      })
      return
    }

    const boardsMatch =
      /^\/api\/jira\/connections\/([^/]+)\/projects\/([^/]+)\/boards$/.exec(
        url.pathname,
      )
    const snapshotMatch =
      /^\/api\/jira\/connections\/([^/]+)\/projects\/([^/]+)\/boards\/(\d+)\/snapshot$/.exec(
        url.pathname,
      )
    const connectionId = decodeURIComponent(
      snapshotMatch?.[1] ?? boardsMatch?.[1] ?? '',
    )
    const config = connections.find(
      (connection) => connection.id === connectionId,
    )
    if (!config) {
      sendJson(response, 404, { error: 'Jira connection not found.' })
      return
    }
    if (config.missing.length) {
      sendJson(response, 503, {
        error: `Jira connection is incomplete: ${config.missing.join(', ')}`,
      })
      return
    }
    const projectKey = decodeURIComponent(
      snapshotMatch?.[2] ?? boardsMatch?.[2] ?? '',
    ).toUpperCase()
    if (!projectKeyPattern.test(projectKey)) {
      sendJson(response, 400, { error: 'Enter a valid Jira project key.' })
      return
    }
    if (!config.projectKeys.includes(projectKey)) {
      sendJson(response, 403, {
        error: 'Project is outside this connection’s scope.',
      })
      return
    }

    const controller = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) controller.abort()
    })
    const client = new JiraClient(config)

    try {
      if (boardsMatch) {
        const boards = await client.listBoards(projectKey, controller.signal)
        sendJson(response, 200, { projectKey, boards })
        return
      }
      if (snapshotMatch) {
        const boardId = snapshotMatch[3]
        if (!boardId) {
          sendJson(response, 400, { error: 'Enter a valid Jira board.' })
          return
        }
        const payload = await client.loadBoard(
          projectKey,
          boardId,
          controller.signal,
        )
        sendJson(response, 200, payload)
        return
      }
      sendJson(response, 404, { error: 'Jira endpoint not found.' })
    } catch (caught) {
      if (controller.signal.aborted) return
      if (caught instanceof JiraUpstreamError) {
        const status =
          caught.status >= 400 && caught.status < 600 ? caught.status : 502
        sendJson(response, status, { error: caught.message })
        return
      }
      sendJson(response, 500, {
        error: 'Steerloom could not complete the Jira request.',
      })
    }
  }
}

function isLocalRequest(request: IncomingMessage): boolean {
  const host = request.headers.host ?? ''
  if (!localHostPattern.test(host)) return false
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return localHostPattern.test(new URL(origin).host)
  } catch {
    return false
  }
}

function setApiHeaders(response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  if (response.writableEnded) return
  response.statusCode = status
  response.end(JSON.stringify(payload))
}
