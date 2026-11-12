import { fetch, ProxyAgent, type Dispatcher } from 'undici'
import { fetchWithRetry } from '../http/fetch-retry'
import { bypassesProxy } from '../http/no-proxy'
import type {
  AzureBoardColumn,
  AzureBoardHistory,
  AzureBoardItem,
  AzureStateCategory,
} from '../../src/lib/data-source/azure-devops'
import type { ProgressReporter } from '../http/progress'
import {
  BOARD_PROGRESS,
  foundDetail,
  historyDetail,
  LARGE_BOARD_DETAIL,
} from '../../src/lib/workspace/board-progress'

/** Supported by Azure DevOps Services and Azure DevOps Server 2020 and later. */
const API_VERSION = '6.0'
const ITEM_LIMIT = 5000
/** Above this many items, load those changed in the last 12 months (as for Jira). */
const FULL_HISTORY_LIMIT = 2000
const REVISION_PAGE_LIMIT = 500

export type AzureFailureReason =
  | 'azure-token-rejected'
  | 'azure-not-reachable-hosted'

export class AzureDevOpsError extends Error {
  constructor(
    message: string,
    readonly reason?: AzureFailureReason,
  ) {
    super(message)
  }
}

export interface AzureDevOpsConfig {
  orgUrl: string
  project: string
  token: string
  proxyUrl?: string
  /** Hosted: refuses private network addresses. */
  dispatcher?: Dispatcher
  hosted?: boolean
}

interface RevisionPage {
  values?: Array<{
    id?: number
    rev?: number
    fields?: Record<string, unknown>
  }>
  continuationToken?: string
  isLastBatch?: boolean
}

const STATE_CATEGORIES = new Set<AzureStateCategory>([
  'Proposed',
  'InProgress',
  'Resolved',
  'Completed',
  'Removed',
])

export const AZURE_AI_OVERVIEW_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AssignedTo',
  'System.CreatedDate',
  'System.ChangedDate',
  'System.Tags',
  'System.Parent',
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Scheduling.TargetDate',
]

export interface AzureAiWorkItem {
  id: number
  fields?: Record<string, unknown>
  relations?: Array<{
    rel?: string
    url?: string
    attributes?: { name?: string }
  }>
}

export interface AzureAiComment {
  text?: string
  createdBy?: { displayName?: string }
  createdDate?: string
  modifiedDate?: string
}

export interface AzureAiUpdate {
  revisedBy?: { displayName?: string }
  revisedDate?: string
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>
}

/** WIQL string literal. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

/**
 * Read-only Azure Boards access for one project. Teams are the boards; a
 * board is the team's requirement backlog board (Stories, Product Backlog
 * Items or Requirements, depending on the process).
 */
export class AzureDevOpsClient {
  private readonly dispatcher?: Dispatcher
  private readonly headers: Record<string, string>
  constructor(private readonly config: AzureDevOpsConfig) {
    this.dispatcher =
      config.dispatcher ??
      (config.proxyUrl && !bypassesProxy(config.orgUrl)
        ? new ProxyAgent(config.proxyUrl)
        : undefined)
    this.headers = {
      Accept: 'application/json',
      // A personal access token is sent as the password with an empty user name.
      Authorization: `Basic ${Buffer.from(`:${config.token}`).toString('base64')}`,
    }
  }

  private get project() {
    return encodeURIComponent(this.config.project)
  }

  /** Proves the token can read the project. Returns its canonical name. */
  async verify(signal?: AbortSignal): Promise<string> {
    const project = await this.request<{ name?: string }>(
      `/_apis/projects/${this.project}`,
      {},
      signal,
    )
    if (!project.name)
      throw new AzureDevOpsError('Azure DevOps project not found.')
    return project.name
  }

  /** Each team's board. */
  async boards(
    signal?: AbortSignal,
  ): Promise<Array<{ id: string; name: string }>> {
    const teams: Array<{ id: string; name: string }> = []
    for (let skip = 0; skip < 2000; skip += 200) {
      const page = await this.request<{
        value?: Array<{ id?: string; name?: string }>
      }>(
        `/_apis/projects/${this.project}/teams`,
        { $top: '200', $skip: String(skip) },
        signal,
      )
      const values = page.value ?? []
      values.forEach(({ id, name }) => {
        if (id && name) teams.push({ id, name })
      })
      if (values.length < 200) break
    }
    return teams.sort((a, b) => a.name.localeCompare(b.name))
  }

  async history(
    teamId: string,
    signal?: AbortSignal,
    onProgress?: ProgressReporter,
  ): Promise<AzureBoardHistory> {
    if (!/^[0-9a-f-]{36}$/i.test(teamId))
      throw new AzureDevOpsError('Choose a team board.')
    onProgress?.(BOARD_PROGRESS.board)
    const team = `${this.project}/${encodeURIComponent(teamId)}`
    const [teamInfo, backlogs, teamFields] = await Promise.all([
      this.request<{ name?: string }>(
        `/_apis/projects/${this.project}/teams/${encodeURIComponent(teamId)}`,
        {},
        signal,
      ),
      this.request<{
        value?: Array<{
          id?: string
          name?: string
          type?: string
          workItemTypes?: Array<{ name?: string }>
        }>
      }>(`/${team}/_apis/work/backlogs`, {}, signal),
      this.request<{
        field?: { referenceName?: string }
        values?: Array<{ value?: string; includeChildren?: boolean }>
      }>(`/${team}/_apis/work/teamsettings/teamfieldvalues`, {}, signal),
    ])
    const backlog = backlogs.value?.find(
      (item) => item.type?.toLowerCase() === 'requirement',
    )
    const types = (backlog?.workItemTypes ?? [])
      .map((item) => item.name)
      .filter((name): name is string => Boolean(name))
    if (!backlog?.name || !types.length)
      throw new AzureDevOpsError(
        'This team has no backlog board to read. Choose another team.',
      )
    const board = await this.request<{
      id?: string
      columns?: Array<{
        id?: string
        name?: string
        columnType?: string
        isSplit?: boolean
        stateMappings?: Record<string, string>
      }>
      fields?: {
        columnField?: { referenceName?: string }
        doneField?: { referenceName?: string }
      }
    }>(
      `/${team}/_apis/work/boards/${encodeURIComponent(backlog.name)}`,
      {},
      signal,
    )
    const columns: AzureBoardColumn[] = (board.columns ?? []).flatMap(
      (column) =>
        column.id &&
        column.name &&
        ['incoming', 'inProgress', 'outgoing'].includes(column.columnType ?? '')
          ? [
              {
                id: column.id,
                name: column.name,
                columnType: column.columnType as AzureBoardColumn['columnType'],
                isSplit: Boolean(column.isSplit),
                stateMappings: column.stateMappings ?? {},
              },
            ]
          : [],
    )
    if (!columns.length)
      throw new AzureDevOpsError('This board has no columns to read.')
    const columnField = board.fields?.columnField?.referenceName
    const doneField = board.fields?.doneField?.referenceName

    const stateCategories = Object.fromEntries(
      await Promise.all(
        types.map(async (type) => {
          const states = await this.request<{
            value?: Array<{ name?: string; category?: string }>
          }>(
            `/${this.project}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`,
            {},
            signal,
          )
          return [
            type,
            Object.fromEntries(
              (states.value ?? []).flatMap((state) =>
                state.name &&
                STATE_CATEGORIES.has(state.category as AzureStateCategory)
                  ? [[state.name, state.category as AzureStateCategory]]
                  : [],
              ),
            ),
          ] as const
        }),
      ),
    )

    onProgress?.(BOARD_PROGRESS.items)
    const teamField = teamFields.field?.referenceName ?? 'System.AreaPath'
    const scope = (teamFields.values ?? [])
      .filter((item) => item.value)
      .map((item) =>
        item.includeChildren
          ? `[${teamField}] UNDER ${literal(item.value!)}`
          : `[${teamField}] = ${literal(item.value!)}`,
      )
    if (!scope.length)
      throw new AzureDevOpsError('This team has no area paths to read.')
    const baseQuery = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN (${types.map(literal).join(', ')}) AND (${scope.join(' OR ')})`
    let ids = await this.query(team, baseQuery, signal)
    const warnings: string[] = []
    // Large boards read history from this date on, not the project's whole
    // past: two years covers items that started well before the 12-month
    // window and are still moving.
    let since: string | undefined
    if (ids.length > FULL_HISTORY_LIMIT) {
      since = new Date(Date.now() - 730 * 86_400_000).toISOString()
      onProgress?.({ ...BOARD_PROGRESS.items, detail: LARGE_BOARD_DETAIL })
      ids = await this.query(
        team,
        `${baseQuery} AND [System.ChangedDate] >= @Today - 365`,
        signal,
      )
      warnings.push(
        'This is a large board, so items not changed in the last 12 months were left out.',
      )
    }
    if (ids.length > ITEM_LIMIT)
      throw new AzureDevOpsError(
        'This board has more than 5,000 work items changed in the last 12 months. Choose a smaller team board.',
      )
    onProgress?.({ ...BOARD_PROGRESS.items, detail: foundDetail(ids.length) })

    const items = await this.revisions(
      new Set(ids),
      types,
      columnField,
      doneField,
      signal,
      onProgress,
      since,
    )
    if (since) {
      const partial = items.filter((item) => item.createdAt < since).length
      if (partial)
        warnings.push(
          `${partial.toLocaleString('en')} ${partial === 1 ? 'item' : 'items'} created before ${since.slice(0, 10)} may have partial history.`,
        )
    }
    onProgress?.(BOARD_PROGRESS.done)
    return {
      board: { id: teamId, name: teamInfo.name ?? backlog.name },
      itemUrlPrefix: `${this.config.orgUrl}/${this.project}/_workitems/edit/`,
      columns,
      stateCategories,
      items,
      ...(warnings.length ? { historyWarnings: warnings } : {}),
    }
  }

  private async query(
    team: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const result = await this.request<{
      workItems?: Array<{ id?: number }>
    }>(`/${team}/_apis/wit/wiql`, { $top: String(ITEM_LIMIT + 1) }, signal, {
      query,
    })
    return (result.workItems ?? [])
      .map((item) => item.id)
      .filter((id): id is number => Number.isInteger(id))
  }

  /**
   * Every revision of the project's work items of these types, in pages,
   * kept for the board's items and reduced to the changes that matter:
   * state, board column and the Done part of split columns.
   */
  private async revisions(
    ids: Set<number>,
    types: string[],
    columnField: string | undefined,
    doneField: string | undefined,
    signal?: AbortSignal,
    onProgress?: ProgressReporter,
    /** Read revisions from this time on (ISO), not the project's whole past. */
    since?: string,
  ): Promise<AzureBoardItem[]> {
    const fields = [
      'System.Id',
      'System.Rev',
      'System.WorkItemType',
      'System.Title',
      'System.State',
      'System.CreatedDate',
      'System.ChangedDate',
      'System.AssignedTo',
      ...(columnField ? [columnField] : []),
      ...(doneField ? [doneField] : []),
    ]
    const byId = new Map<
      number,
      {
        type: string
        title: string
        createdAt: string
        /** Assigned To at the latest revision read so far; '' is nobody. */
        owner: { rev: number; name: string }
        revisions: Array<{ rev: number } & AzureBoardItem['revisions'][number]>
      }
    >()
    let continuationToken = ''
    for (let page = 0; page < REVISION_PAGE_LIMIT; page++) {
      if (page)
        onProgress?.({
          ...BOARD_PROGRESS.history,
          detail: historyDetail(byId.size, ids.size),
        })
      else onProgress?.(BOARD_PROGRESS.history)
      const batch = await this.request<RevisionPage>(
        `/${this.project}/_apis/wit/reporting/workitemrevisions`,
        {
          fields: fields.join(','),
          types: types.join(','),
          $maxPageSize: '1000',
          ...(since ? { startDateTime: since } : {}),
          ...(continuationToken ? { continuationToken } : {}),
        },
        signal,
      )
      for (const value of batch.values ?? []) {
        const id = value.id ?? Number(value.fields?.['System.Id'])
        if (!ids.has(id) || !value.fields) continue
        const f = value.fields
        const text = (key: string) => (typeof f[key] === 'string' ? f[key] : '')
        const at = text('System.ChangedDate')
        const state = text('System.State')
        if (!at || !state) continue
        const entry = byId.get(id) ?? {
          type: '',
          title: '',
          createdAt: text('System.CreatedDate') || at,
          owner: { rev: -1, name: '' },
          revisions: [],
        }
        // The latest type and title win: both can change over an item's life.
        entry.type = text('System.WorkItemType') || entry.type
        entry.title = text('System.Title').trim() || entry.title
        const column = columnField ? f[columnField] : undefined
        const rev = value.rev ?? Number(f['System.Rev'] ?? 0)
        if (rev > entry.owner.rev)
          entry.owner = { rev, name: identityName(f['System.AssignedTo']) }
        entry.revisions.push({
          rev,
          at,
          state,
          ...(typeof column === 'string' && column ? { column } : {}),
          ...(doneField && f[doneField] === true ? { done: true } : {}),
        })
        byId.set(id, entry)
      }
      if (batch.isLastBatch || !batch.continuationToken) {
        return [...byId].map(([id, entry]) => {
          const ordered = entry.revisions.sort((a, b) => a.rev - b.rev)
          // Keep the first revision and every change of place on the board.
          const revisions = ordered
            .filter(
              (revision, index) =>
                index === 0 ||
                revision.state !== ordered[index - 1]!.state ||
                revision.column !== ordered[index - 1]!.column ||
                revision.done !== ordered[index - 1]!.done,
            )
            .map(({ at, state, column, done }) => ({
              at,
              state,
              ...(column ? { column } : {}),
              ...(done ? { done } : {}),
            }))
          return {
            id,
            type: entry.type,
            ...(entry.title ? { title: entry.title } : {}),
            createdAt: entry.createdAt,
            ...(entry.owner.name ? { assignee: entry.owner.name } : {}),
            revisions,
          }
        })
      }
      if (batch.continuationToken === continuationToken)
        throw new AzureDevOpsError(
          'Azure DevOps history paging did not advance. Please retry.',
        )
      continuationToken = batch.continuationToken
    }
    throw new AzureDevOpsError(
      'This project has too much history to read in one go. Choose a smaller team board.',
    )
  }

  /** The assistant's search: work item ids from a WIQL query, newest change first. */
  async aiQuery(
    wiql: string,
    top: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const result = await this.request<{ workItems?: Array<{ id?: number }> }>(
      `/${this.project}/_apis/wit/wiql`,
      { $top: String(top) },
      signal,
      { query: wiql },
    )
    return (result.workItems ?? [])
      .map((item) => item.id)
      .filter((id): id is number => Number.isInteger(id))
  }

  /**
   * Work items by id. With relations, every field comes back (the API does
   * not combine a field list with relations); otherwise the overview fields.
   * Ids the token cannot see are left out.
   */
  async aiWorkItems(
    ids: number[],
    relations: boolean,
    signal?: AbortSignal,
  ): Promise<AzureAiWorkItem[]> {
    if (!ids.length) return []
    const result = await this.request<{
      value?: Array<AzureAiWorkItem | null>
    }>(
      `/${this.project}/_apis/wit/workitems`,
      {
        ids: ids.slice(0, 200).join(','),
        errorPolicy: 'omit',
        ...(relations
          ? { $expand: 'relations' }
          : { fields: AZURE_AI_OVERVIEW_FIELDS.join(',') }),
      },
      signal,
    )
    return (result.value ?? []).filter(
      (item): item is AzureAiWorkItem => !!item && Number.isInteger(item.id),
    )
  }

  /** The latest comments on a work item, newest first. */
  async aiComments(
    id: number,
    signal?: AbortSignal,
  ): Promise<AzureAiComment[]> {
    const result = await this.request<{ comments?: AzureAiComment[] }>(
      `/${this.project}/_apis/wit/workItems/${id}/comments`,
      { $top: '8', order: 'desc', 'api-version': '6.0-preview.3' },
      signal,
    )
    return result.comments ?? []
  }

  /** A work item's changes, oldest first. */
  async aiUpdates(id: number, signal?: AbortSignal): Promise<AzureAiUpdate[]> {
    const result = await this.request<{ value?: AzureAiUpdate[] }>(
      `/${this.project}/_apis/wit/workItems/${id}/updates`,
      { $top: '200' },
      signal,
    )
    return result.value ?? []
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.config.orgUrl}${path}`)
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    )
    if (!params['api-version']) url.searchParams.set('api-version', API_VERSION)
    let response
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000)
    try {
      response = await fetchWithRetry(
        () =>
          fetch(url, {
            // Reads only. WIQL queries are sent with POST but change nothing.
            method: body === undefined ? 'GET' : 'POST',
            redirect: 'manual',
            dispatcher: this.dispatcher,
            headers: {
              ...this.headers,
              ...(body === undefined
                ? {}
                : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: combined,
          }),
        { signal: combined },
      )
    } catch (error) {
      if (signal?.aborted) throw error
      throw azureNetworkError(error, this.config)
    }
    const text = await response.text()
    // A rejected token gets a sign-in page (203 or a redirect), not an error code.
    const signIn =
      response.status === 203 ||
      (response.status >= 300 && response.status < 400) ||
      /^\s*</.test(text)
    if (response.status === 401 || (signIn && response.status < 400))
      throw new AzureDevOpsError(
        'Azure DevOps did not accept the token. Check that it has not expired and has Work Items (Read) and Project and Team (Read), then connect again.',
        'azure-token-rejected',
      )
    if (!response.ok)
      throw new AzureDevOpsError(
        response.status === 403
          ? 'The token cannot read this project. Give it Work Items (Read) and Project and Team (Read), or ask for access to the project.'
          : response.status === 404
            ? 'Azure DevOps could not find this project or team. Check the link.'
            : response.status === 429
              ? 'Azure DevOps is limiting requests. Wait a minute and retry.'
              : `Azure DevOps could not load this (status ${response.status}).`,
      )
    try {
      return JSON.parse(text) as T
    } catch {
      throw new AzureDevOpsError(
        'Azure DevOps sent an answer Steerloom could not read.',
      )
    }
  }
}

function azureNetworkError(
  error: unknown,
  config: AzureDevOpsConfig,
): AzureDevOpsError {
  const codes = new Set<string>()
  let current = error
  for (
    let depth = 0;
    depth < 5 && current && typeof current === 'object';
    depth++
  ) {
    if ('code' in current && typeof current.code === 'string')
      codes.add(current.code)
    if ('name' in current && typeof current.name === 'string')
      codes.add(current.name)
    current = 'cause' in current ? current.cause : undefined
  }
  const host = new URL(config.orgUrl).hostname
  if (
    config.hosted &&
    !/(^|\.)(dev\.azure\.com|visualstudio\.com)$/i.test(host)
  )
    return new AzureDevOpsError(
      `steerloom.app cannot reach ${host}. Company Azure DevOps Server runs inside your network, so connect it from Steerloom on your own computer.`,
      'azure-not-reachable-hosted',
    )
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN'))
    return new AzureDevOpsError(
      `Could not find ${host}. Check the link, your network or VPN.`,
    )
  if (
    [
      'TimeoutError',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
    ].some((code) => codes.has(code))
  )
    return new AzureDevOpsError(
      'Azure DevOps took too long to answer. Check your network, VPN or proxy, then retry.',
    )
  if ([...codes].some((code) => /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)))
    return new AzureDevOpsError(
      `The certificate of ${host} could not be verified. Ask your network administrator for the approved certificate setup.`,
    )
  return new AzureDevOpsError(
    `Could not reach ${host}. Check your network, VPN or proxy.`,
  )
}

/**
 * Assigned To arrives as an identity ({ displayName }) or, in reporting
 * revisions, as "Name <email>". Only the name is kept.
 */
export function identityName(value: unknown): string {
  if (value && typeof value === 'object' && 'displayName' in value) {
    const name = (value as { displayName?: unknown }).displayName
    return typeof name === 'string' ? name.trim().slice(0, 160) : ''
  }
  if (typeof value !== 'string') return ''
  return value
    .replace(/\s*<[^>]*>\s*$/, '')
    .trim()
    .slice(0, 160)
}
