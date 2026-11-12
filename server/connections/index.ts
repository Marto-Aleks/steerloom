import type { Dispatcher } from 'undici'
import type { AiJiraScope } from '../../src/lib/ai/jira-evidence'
import { parseJiraConnectionUrl } from '../../src/lib/workspace/jira-url'
import type { JiraServerConnection } from '../jira/config'
import { JiraClient } from '../jira/jira-client'
import { publicJiraUrl } from '../hosted/public-network'
import { TrelloClient } from '../trello/client'
import { AzureDevOpsClient } from '../azure-devops/client'
import { parseAzureDevOpsUrl } from '../../src/lib/workspace/azure-devops-url'
import type { BoardReader } from '../ai/board-reader'
import { azureReader, jiraReader, trelloReader } from '../ai/board-readers'
import type { ConnectionSecret } from '../workspace/store'
import type { ProgressReporter } from '../http/progress'
import { BOARD_PROGRESS } from '../../src/lib/workspace/board-progress'

/**
 * How one server reaches providers. Local and hosted servers differ only in
 * these settings; validation, clients and board reads are shared.
 */
export interface ConnectionRuntime {
  proxyUrl: string
  trelloProxy?: string
  /** Hosted only: dispatcher that refuses private network addresses. */
  dispatcher?: Dispatcher
  /** Hosted only: Data Center URLs must be public HTTPS hosts. */
  requirePublicJira?: boolean
  /**
   * Local only, when no Atlassian OAuth app is configured: Jira Cloud may be
   * connected with an Atlassian account email and API token (Basic auth).
   */
  jiraCloudToken?: boolean
  /** Returns a fresh OAuth access token (Jira Cloud, Trello OAuth). */
  accessToken: (connectionId: string) => Promise<string>
}

const projectKeyPattern = /^[A-Z][A-Z0-9_]{1,29}$/
const emailPattern = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/
const apiTokenPattern = /^[\x21-\x7e]{1,512}$/

function isCloudSite(baseUrl: string): boolean {
  const url = new URL(baseUrl)
  return (
    url.protocol === 'https:' &&
    !url.port &&
    (url.hostname.endsWith('.atlassian.net') ||
      url.hostname.endsWith('.jira.com'))
  )
}

export function requiredField(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Complete the required connection fields.')
  return value.trim()
}

/**
 * Validates a manually entered Trello or Jira Data Center connection and
 * proves read access before anything is saved. Jira Cloud uses OAuth, or an
 * account email and API token where the runtime allows it (local installs
 * without an Atlassian OAuth app).
 */
export async function verifyNewConnection(
  input: Record<string, unknown>,
  runtime: ConnectionRuntime,
  signal?: AbortSignal,
): Promise<ConnectionSecret> {
  if (input.localId) throw new Error('Connect with a Jira link and token.')
  const name = requiredField(input.name, 100)
  if (input.provider === 'trello') {
    const apiKey = requiredField(input.apiKey, 128)
    const token = requiredField(input.token, 256)
    if (!/^[a-zA-Z0-9]+$/.test(apiKey + token))
      throw new Error('Check your Trello API key and read token.')
    await new TrelloClient(apiKey, token, runtime.trelloProxy).boards(signal)
    return { provider: 'trello', name, apiKey, token }
  }
  if (input.provider === 'azure-devops') {
    const link = parseAzureDevOpsUrl(requiredField(input.baseUrl, 500))
    const project =
      link.project ??
      (typeof input.project === 'string' && input.project.trim()
        ? requiredField(input.project, 128)
        : undefined)
    if (!project)
      throw new Error(
        'Paste a link that includes the project, like https://dev.azure.com/your-org/your-project',
      )
    if (link.edition === 'server' && runtime.requirePublicJira)
      publicJiraUrl(link.orgUrl)
    const token = requiredField(input.token, 512)
    if (/\s/.test(token)) throw new Error('Check your Azure DevOps token.')
    const secret: ConnectionSecret = {
      provider: 'azure-devops',
      name,
      baseUrl: link.orgUrl,
      project,
      token,
    }
    secret.project = await azureClient(secret, runtime).verify(signal)
    return secret
  }
  if (input.provider !== 'jira')
    throw new Error('Choose Jira, Trello or Azure DevOps.')
  const parsed = parseJiraConnectionUrl(requiredField(input.baseUrl, 300))
  if (parsed.edition === 'cloud' && !runtime.jiraCloudToken)
    throw new Error(
      'This is Jira Cloud. Use Connect with Atlassian instead of entering a token. No credentials were sent to Jira.',
    )
  const projectKey =
    parsed.projectKey ?? requiredField(input.projectKey, 30).toUpperCase()
  if (!projectKeyPattern.test(projectKey))
    throw new Error('Enter a valid Jira project key.')
  if (parsed.edition === 'cloud') {
    if (!isCloudSite(parsed.baseUrl))
      throw new Error('Use your https://<site>.atlassian.net Jira Cloud link.')
    const email = requiredField(input.email, 254)
    if (!emailPattern.test(email))
      throw new Error('Enter the email address of your Atlassian account.')
    const apiToken = typeof input.token === 'string' ? input.token.trim() : ''
    if (!apiTokenPattern.test(apiToken))
      throw new Error('Check your Atlassian API token.')
    const secret: ConnectionSecret = {
      provider: 'jira',
      jiraEdition: 'cloud',
      name,
      baseUrl: parsed.baseUrl,
      projectKey,
      email,
      token: apiToken,
    }
    await new JiraClient(jiraConnection('', secret, runtime)).listBoards(
      projectKey,
      signal,
    )
    return secret
  }
  const token = requiredField(input.token, 512)
  const apiKey =
    typeof input.apiKey === 'string' && input.apiKey.trim()
      ? requiredField(input.apiKey, 512)
      : undefined
  if (/[\r\n]/.test(token + (apiKey ?? '')))
    throw new Error('Invalid Jira credentials.')
  const secret: ConnectionSecret = {
    provider: 'jira',
    jiraEdition: 'data-center',
    name,
    baseUrl: parsed.baseUrl,
    projectKey,
    token,
    ...(apiKey ? { apiKey } : {}),
  }
  await new JiraClient(jiraConnection('', secret, runtime)).listBoards(
    projectKey,
    signal,
  )
  return secret
}

/** Builds the Jira client settings for a saved (or about-to-be-saved) connection. */
export function jiraConnection(
  id: string,
  secret: ConnectionSecret,
  runtime: ConnectionRuntime,
): JiraServerConnection {
  if (secret.provider !== 'jira') throw new Error('Choose a Jira connection.')
  if (secret.localId)
    throw new Error(
      'This Jira connection used the removed machine configuration. Disconnect it and connect again with a Jira link and token.',
    )
  if (!secret.projectKey) throw new Error('Reconnect this Jira project.')
  const cloud = secret.jiraEdition === 'cloud'
  if (cloud && secret.email) {
    // Account email + API token: Basic auth straight to the Cloud site.
    if (!secret.baseUrl || !isCloudSite(secret.baseUrl) || !secret.token)
      throw new Error('Reconnect Jira Cloud.')
    return {
      id,
      instance: secret.name,
      dispatcher: runtime.dispatcher,
      baseUrl: secret.baseUrl,
      pat: secret.token,
      email: secret.email,
      apiKey: '',
      proxyUrl: runtime.proxyUrl,
      defaultProjectKey: secret.projectKey,
      projectKeys: [secret.projectKey],
      missing: [],
      cloud: true,
      siteUrl: secret.baseUrl,
    }
  }
  if (
    cloud &&
    (!secret.cloudId || !/^[a-zA-Z0-9-]{1,100}$/.test(secret.cloudId))
  )
    throw new Error('Reconnect Jira Cloud.')
  if (!cloud && runtime.requirePublicJira) publicJiraUrl(secret.baseUrl ?? '')
  return {
    id,
    instance: secret.name,
    dispatcher: runtime.dispatcher,
    baseUrl: cloud
      ? `https://api.atlassian.com/ex/jira/${secret.cloudId}`
      : secret.baseUrl,
    pat: cloud ? '' : (secret.token ?? ''),
    apiKey: secret.apiKey ?? '',
    proxyUrl: runtime.proxyUrl,
    defaultProjectKey: secret.projectKey,
    projectKeys: [secret.projectKey],
    missing: [],
    ...(!cloud && runtime.requirePublicJira ? { hosted: true } : {}),
    ...(cloud
      ? {
          cloud: true,
          siteUrl: secret.baseUrl,
          accessToken: () => runtime.accessToken(id),
        }
      : {}),
  }
}

function azureClient(secret: ConnectionSecret, runtime: ConnectionRuntime) {
  if (secret.provider !== 'azure-devops' || !secret.baseUrl || !secret.project)
    throw new Error('Reconnect Azure DevOps.')
  const link = parseAzureDevOpsUrl(secret.baseUrl)
  return new AzureDevOpsClient({
    orgUrl: link.orgUrl,
    project: secret.project,
    token: secret.token ?? '',
    proxyUrl: runtime.proxyUrl,
    dispatcher: runtime.dispatcher,
    hosted: Boolean(runtime.requirePublicJira),
  })
}

function trelloClient(
  id: string,
  secret: ConnectionSecret,
  runtime: ConnectionRuntime,
) {
  return new TrelloClient(
    secret.apiKey ?? '',
    secret.token ?? '',
    runtime.trelloProxy,
    secret.refreshToken ? () => runtime.accessToken(id) : undefined,
  )
}

/**
 * Lists boards, or loads one board's history when `boardId` is given.
 * `onProgress` hears the board load's steps (counts and stage names only).
 */
export async function readBoards(
  id: string,
  secret: ConnectionSecret,
  runtime: ConnectionRuntime,
  boardId: string | undefined,
  signal: AbortSignal,
  onProgress?: ProgressReporter,
  /** Skip a recent copy of this board (an explicit refresh). */
  fresh = false,
) {
  if (!boardId) return listBoards(id, secret, runtime, signal)
  const key = `${id}:${boardId}`
  const cached = fresh ? undefined : recentBoards.get(key)
  if (cached && cached.at > Date.now() - BOARD_CACHE_MS) {
    onProgress?.(BOARD_PROGRESS.done)
    return { provider: secret.provider, payload: cached.payload }
  }
  const loaded = await loadBoard(
    id,
    secret,
    runtime,
    boardId,
    signal,
    onProgress,
  )
  recentBoards.delete(key)
  recentBoards.set(key, { payload: loaded.payload, at: Date.now() })
  while (recentBoards.size > BOARD_CACHE_ENTRIES)
    recentBoards.delete(recentBoards.keys().next().value!)
  return loaded
}

/**
 * Boards loaded in the last few minutes, by connection and board. Opening a
 * dashboard twice, or two people opening the same board, costs one load.
 * Refresh bypasses it. Payloads only: no credentials.
 */
const BOARD_CACHE_MS = 10 * 60_000
const BOARD_CACHE_ENTRIES = 20
const recentBoards = new Map<string, { payload: unknown; at: number }>()

/** Drops cached boards of a connection, e.g. when it is disconnected. */
export function forgetBoards(connectionId: string) {
  for (const key of [...recentBoards.keys()])
    if (key.startsWith(`${connectionId}:`)) recentBoards.delete(key)
}

async function listBoards(
  id: string,
  secret: ConnectionSecret,
  runtime: ConnectionRuntime,
  signal: AbortSignal,
) {
  if (secret.provider === 'trello')
    return { boards: await trelloClient(id, secret, runtime).boards(signal) }
  if (secret.provider === 'azure-devops')
    return { boards: await azureClient(secret, runtime).boards(signal) }
  const client = new JiraClient(jiraConnection(id, secret, runtime))
  return { boards: await client.listBoards(secret.projectKey!, signal) }
}

async function loadBoard(
  id: string,
  secret: ConnectionSecret,
  runtime: ConnectionRuntime,
  boardId: string,
  signal: AbortSignal,
  onProgress?: ProgressReporter,
) {
  if (secret.provider === 'trello')
    return {
      provider: secret.provider,
      payload: await trelloClient(id, secret, runtime).history(
        boardId,
        signal,
        onProgress,
      ),
    }
  if (secret.provider === 'azure-devops')
    return {
      provider: secret.provider,
      payload: await azureClient(secret, runtime).history(
        boardId,
        signal,
        onProgress,
      ),
    }
  const client = new JiraClient(jiraConnection(id, secret, runtime))
  return {
    provider: secret.provider,
    payload: await client.loadBoard(
      secret.projectKey!,
      boardId,
      signal,
      onProgress,
    ),
  }
}

/** Bounded, read-only evidence for the AI agent, scoped to one connection. */
/**
 * The assistant's read-only window into one board (see server/ai/board-reader.ts),
 * built from a saved connection and the board the report came from.
 */
export function boardReader(
  connectionId: string,
  secret: ConnectionSecret,
  scope: AiJiraScope,
  runtime: ConnectionRuntime,
): BoardReader {
  if (scope.provider === 'trello') {
    if (secret.provider !== 'trello' || !scope.boardId)
      throw new Error('Invalid Trello investigation scope.')
    return trelloReader(
      trelloClient(connectionId, secret, runtime),
      scope.boardId,
    )
  }
  if (scope.provider === 'azure-devops') {
    if (secret.provider !== 'azure-devops')
      throw new Error('Invalid Azure DevOps investigation scope.')
    return azureReader(azureClient(secret, runtime))
  }
  if (secret.provider !== 'jira' || secret.projectKey !== scope.projectKey)
    throw new Error('Project is outside this connection’s scope.')
  return jiraReader(
    new JiraClient(jiraConnection(connectionId, secret, runtime)),
    scope.projectKey,
  )
}
