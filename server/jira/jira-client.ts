import { fetch, ProxyAgent, type Dispatcher } from 'undici'
import { fetchWithRetry } from '../http/fetch-retry'
import { bypassesProxy } from '../http/no-proxy'
import type {
  AiJiraEvidenceBundle,
  AiJiraIssueEvidence,
  AiJiraLookup,
  AiJiraLookupSource,
  AiJiraRelatedIssue,
} from '../../src/lib/ai/jira-evidence'
import { extractProjectTicketKeys } from '../../src/lib/ai/jira-evidence'
import type {
  JiraBoardRecord,
  JiraIssueRecord,
  JiraStatusChangeRecord,
} from '../../src/lib/data-source/jira-gateway'
import type { FlowStatus, JiraBoardOption } from '../../src/types'
import type { JiraServerConfig } from './config'
import {
  filterItems,
  isUnassigned,
  jiraSearchJql,
  type BoardItemsResult,
  type BoardSearch,
  type BoardSearchResult,
} from '../ai/board-reader'
import type { ProgressReporter } from '../http/progress'
import {
  BOARD_RESPONSE_BYTES,
  cappedText,
  ERROR_RESPONSE_BYTES,
  ResponseTooLargeError,
} from '../http/capped-body'
import {
  BOARD_PROGRESS,
  LARGE_BOARD_DETAIL,
  foundDetail,
  historyDetail,
  progressInterval,
} from '../../src/lib/workspace/board-progress'

interface JiraBoardPage {
  startAt?: number
  maxResults?: number
  total?: number
  isLast?: boolean
  values?: Array<{
    id?: number
    name?: string
    type?: string
  }>
}

interface JiraBoardConfiguration {
  id?: number
  name?: string
  columnConfig?: {
    columns?: Array<{
      name?: string
      statuses?: Array<{ id?: string }>
    }>
  }
}

interface JiraStatusRecord {
  id?: string
  name?: string
  statusCategory?: { key?: string }
}

interface JiraIssuePage {
  startAt?: number
  maxResults?: number
  total?: number
  issues?: JiraIssueResponse[]
}

interface JiraAssigneeResponse {
  key?: string
  name?: string
  displayName?: string
  active?: boolean
}

interface JiraRelatedIssueResponse {
  key?: string
  fields?: {
    summary?: string
    status?: { name?: string }
    issuetype?: { name?: string }
  }
}

interface JiraIssueLinkResponse {
  type?: { name?: string; inward?: string; outward?: string }
  inwardIssue?: JiraRelatedIssueResponse
  outwardIssue?: JiraRelatedIssueResponse
}

interface JiraCommentResponse {
  author?: JiraAssigneeResponse
  created?: string
  updated?: string
  body?: unknown
}

interface JiraCommentPage {
  startAt?: number
  maxResults?: number
  total?: number
  comments?: JiraCommentResponse[]
}

interface JiraIssueResponse {
  id?: string
  key?: string
  fields?: {
    issuetype?: {
      id?: string
      name?: string
      subtask?: boolean
      hierarchyLevel?: number
    }
    created?: string
    resolution?: { name?: string } | null
    status?: {
      id?: string
      name?: string
      statusCategory?: { key?: string; name?: string }
    }
    summary?: string
    description?: unknown
    assignee?: JiraAssigneeResponse | null
    components?: Array<{ id?: string; name?: string }>
    labels?: string[]
    fixVersions?: Array<{ name?: string }>
    priority?: { id?: string; name?: string }
    updated?: string
    duedate?: string | null
    parent?: JiraRelatedIssueResponse
    subtasks?: JiraRelatedIssueResponse[]
    issuelinks?: JiraIssueLinkResponse[]
    comment?: JiraCommentPage
  }
  changelog?: JiraChangelog
}

interface JiraChangelog {
  startAt?: number
  maxResults?: number
  total?: number
  histories?: Array<{
    /** Text from search and per-issue changelogs; an epoch number from Cloud's bulk changelog. */
    created?: string | number
    author?: JiraAssigneeResponse
    items?: Array<{
      field?: string
      fieldId?: string
      from?: string | null
      fromString?: string | null
      to?: string | null
      toString?: string | null
    }>
  }>
}

export interface JiraBoardPayload {
  board: JiraBoardRecord
  issues: JiraIssueRecord[]
  changes: JiraStatusChangeRecord[]
  /** Set when a large board was limited to recent activity. */
  historyWarnings?: string[]
}

/**
 * Boards above this size load only work that is in progress or changed in the
 * last 12 months: enough for every report window (up to 180 days plus the
 * previous period) without fetching years of finished history item by item.
 */
export const FULL_HISTORY_LIMIT = 2_000
// Parallel Jira requests per board load; low enough to stay clear of rate limits.
const HISTORY_CONCURRENCY = 4
/** How long one attempt may wait for Jira to start answering. */
const JIRA_ATTEMPT_MS = 25_000
/** All attempts of one request together, back-off included. */
const JIRA_REQUEST_MS = 90_000
/** Issue fields a board snapshot needs: type, dates, status and resolution. */
/** Item titles shown on hover in the briefing. */
const TITLE_LIMIT = 140
const SNAPSHOT_FIELDS = 'issuetype,created,status,resolution,summary,assignee'
const RECENT_HISTORY_JQL =
  '(statusCategory = "In Progress" OR updated >= -365d)'

const AI_INVESTIGATION_FIELDS = [
  'summary',
  'description',
  'assignee',
  'components',
  'labels',
  'fixVersions',
  'status',
  'issuetype',
  'priority',
  'created',
  'updated',
  'duedate',
  'parent',
  'subtasks',
  'issuelinks',
  'comment',
].join(',')
const AI_OVERVIEW_FIELDS = [
  'summary',
  'assignee',
  'components',
  'status',
  'issuetype',
  'priority',
  'updated',
  'duedate',
  'parent',
].join(',')
const AI_SEARCH_FIELDS = AI_OVERVIEW_FIELDS

/**
 * Why a Jira request failed, when the person can fix it in the connect form:
 * a company API gateway in front of Jira wants its own key (or refused the
 * one given), or Jira itself refused the personal access token.
 */
export type JiraFailureReason =
  | 'gateway-key-required'
  | 'gateway-key-rejected'
  | 'jira-token-rejected'
  | 'jira-not-reachable-hosted'

export class JiraUpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: JiraFailureReason,
  ) {
    super(message)
  }
}

/** Headers Jira Data Center sets on its own responses, including refusals. */
export const JIRA_HEADERS = [
  'x-arequestid',
  'x-ausername',
  'x-asessionid',
  'x-seraph-loginreason',
  'x-anodeid',
]

export const GATEWAY_KEY_REQUIRED =
  'Your company’s API gateway turned this connection away before it reached Jira. It needs a gateway key, which is separate from your Jira token. Add it in the API gateway key field and connect again.'
export const GATEWAY_KEY_REJECTED =
  'The API gateway in front of Jira did not accept this gateway key. Check it, or ask the team that runs Jira access for a new one.'
export const NOT_JIRA_DATA =
  'Your company network answered with a web page instead of Jira data, and this computer sends no traffic through a company proxy. If colleagues reach this Jira, check that your company’s proxy tool is installed and running on this computer (IT can install it), or use the company VPN. Some companies instead give an API gateway key: add it if you have one.'
export const PROXY_NOT_JIRA_DATA =
  'Your computer’s proxy answered with a web page instead of Jira data. If Jira opens in your browser, add its address to NO_PROXY in .env.local (for example NO_PROXY=jira.example.com) and restart Steerloom.'
export const HOSTED_CANNOT_REACH =
  'steerloom.app can’t reach this Jira: it only works inside your company network. Run Steerloom on your own computer instead. Your data then stays on your computer.'
export const JIRA_TOKEN_REJECTED =
  'Jira did not accept this personal access token. In Jira, open your profile picture → Profile → Personal access tokens, create a new token and paste it again.'

class JiraTooManyItemsError extends JiraUpstreamError {}

/** Far more pages than any real board needs; a guard, not a product limit. */
const MAX_PAGES = 500
const tooManyPages = () =>
  new JiraTooManyItemsError(
    502,
    'Jira kept sending pages without an end. Narrow the project scope.',
  )

export class JiraClient {
  private readonly root: string
  private readonly headers: Record<string, string>
  private readonly dispatcher: Dispatcher | undefined
  /** Requests go through a proxy, which may answer in Jira's place. */
  private readonly viaProxy: boolean

  constructor(private readonly config: JiraServerConfig) {
    if (!config.baseUrl)
      throw new Error('Jira connection address is missing. Reconnect Jira.')
    this.root = config.baseUrl
    this.headers = {
      Accept: 'application/json',
      Authorization: config.email
        ? `Basic ${Buffer.from(`${config.email}:${config.pat}`).toString('base64')}`
        : `Bearer ${config.pat}`,
      ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
    }
    this.viaProxy = Boolean(config.proxyUrl) && !bypassesProxy(config.baseUrl)
    this.dispatcher =
      config.dispatcher ??
      (this.viaProxy ? new ProxyAgent(config.proxyUrl) : undefined)
  }

  async listBoards(
    projectKey: string,
    signal?: AbortSignal,
  ): Promise<JiraBoardOption[]> {
    const boards: JiraBoardOption[] = []
    let startAt = 0

    // A server that never says "last page" must not keep this running.
    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES) throw tooManyPages()
      const page = await this.get<JiraBoardPage>(
        `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&startAt=${startAt}&maxResults=50`,
        signal,
      )
      const values = page.values ?? []
      values.forEach((board) => {
        if (board.id === undefined || !board.name) return
        boards.push({
          id: String(board.id),
          name: board.name,
          type: board.type ?? '',
        })
      })
      const pageSize = page.maxResults ?? values.length
      const nextStart = (page.startAt ?? startAt) + pageSize
      const finished =
        page.isLast === true ||
        values.length === 0 ||
        (page.total !== undefined && nextStart >= page.total)
      if (finished) return boards
      startAt = nextStart
    }
  }

  async loadBoard(
    projectKey: string,
    boardId: string,
    signal?: AbortSignal,
    onProgress?: ProgressReporter,
  ): Promise<JiraBoardPayload> {
    onProgress?.(BOARD_PROGRESS.board)
    const availableBoards = await this.listBoards(projectKey, signal)
    const selectedBoard = availableBoards.find((board) => board.id === boardId)
    if (!selectedBoard) {
      throw new JiraUpstreamError(
        404,
        'That board is not available for this project.',
      )
    }

    const [configuration, statuses, issueKeys] = await Promise.all([
      this.get<JiraBoardConfiguration>(
        `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`,
        signal,
      ),
      this.get<JiraStatusRecord[]>('/rest/api/2/status', signal),
      this.getBoardKeysWithinLimit(projectKey, boardId, signal, onProgress),
    ])
    const statusLookup = new Map<string, FlowStatus>()
    statuses.forEach((status) => {
      if (status.id && status.name) {
        const category = statusCategory(status.statusCategory?.key)
        statusLookup.set(status.id, {
          id: status.id,
          name: status.name,
          ...(category ? { category } : {}),
        })
      }
    })
    const issueResponses = await this.getIssuesWithHistory(
      issueKeys.keys,
      signal,
      onProgress,
    )
    onProgress?.(BOARD_PROGRESS.done)
    const board = normaliseBoard(
      configuration,
      selectedBoard,
      statusLookup,
      boardId,
    )
    const { issues, changes } = normaliseIssues(
      issueResponses,
      statusLookup,
      projectKey,
    )
    const linkedIssues = issues.map((issue) => ({
      ...issue,
      browseUrl: `${this.config.siteUrl ?? this.root}/browse/${encodeURIComponent(issue.key)}`,
    }))

    return {
      board,
      issues: linkedIssues,
      changes,
      ...(issueKeys.recentOnly
        ? {
            historyWarnings: [
              `This board is large, so Steerloom loaded the ${issueKeys.keys.length.toLocaleString('en')} items that are in progress or changed in the last 12 months. Older finished work is not included; reports up to 180 days are unaffected.`,
            ],
          }
        : {}),
    }
  }

  private async getBoardKeysWithinLimit(
    projectKey: string,
    boardId: string,
    signal?: AbortSignal,
    onProgress?: ProgressReporter,
  ): Promise<{ keys: string[]; recentOnly: boolean }> {
    try {
      const keys = await this.getBoardIssueKeys(
        projectKey,
        boardId,
        signal,
        undefined,
        onProgress,
        FULL_HISTORY_LIMIT,
      )
      if (keys.length <= FULL_HISTORY_LIMIT) return { keys, recentOnly: false }
    } catch (caught) {
      if (!(caught instanceof JiraTooManyItemsError)) throw caught
    }
    onProgress?.({ ...BOARD_PROGRESS.items, detail: LARGE_BOARD_DETAIL })
    const keys = await this.getBoardIssueKeys(
      projectKey,
      boardId,
      signal,
      RECENT_HISTORY_JQL,
    )
    onProgress?.({
      ...BOARD_PROGRESS.items,
      detail: `${LARGE_BOARD_DETAIL} · ${foundDetail(keys.length)}`,
    })
    if (keys.length > 5_000)
      throw new JiraUpstreamError(
        502,
        `This board has ${keys.length.toLocaleString('en')} items active in the last 12 months, more than one report can load. Choose a board with a narrower filter.`,
      )
    return { keys, recentOnly: true }
  }

  /** Data Center and Cloud differ in search and in how epics link. */
  get cloud(): boolean {
    return !!this.config.cloud
  }

  /**
   * The assistant's search: one page of overview fields inside the project,
   * newest change first. Assignee names are matched here, since JQL wants
   * account ids or user names.
   */
  async aiSearch(
    projectKey: string,
    query: BoardSearch,
    signal?: AbortSignal,
  ): Promise<BoardSearchResult> {
    const want = query.limit ?? 15
    const byName = !!query.assignee && !isUnassigned(query.assignee)
    const count = byName ? 100 : want
    const run = async (jql: string) => {
      if (this.config.cloud) {
        const page = await this.request<{
          issues?: JiraIssueResponse[]
          isLast?: boolean
        }>(
          `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${count}&fields=${AI_SEARCH_FIELDS}`,
          signal,
        )
        return {
          issues: page.issues ?? [],
          total: null as number | null,
          more: page.isLast === false,
        }
      }
      const page = await this.request<JiraIssuePage>(
        `/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=0&maxResults=${count}&fields=${AI_SEARCH_FIELDS}`,
        signal,
      )
      const issues = page.issues ?? []
      return {
        issues,
        total: page.total ?? null,
        more: (page.total ?? issues.length) > issues.length,
      }
    }
    let found: Awaited<ReturnType<typeof run>>
    try {
      found = await run(jiraSearchJql(projectKey, query, this.cloud))
    } catch (caught) {
      // Data Center without Jira Software's Epic Link field: parent only.
      if (
        !this.cloud &&
        query.parent &&
        caught instanceof JiraUpstreamError &&
        caught.status === 400
      )
        found = await run(jiraSearchJql(projectKey, query, true))
      else throw caught
    }
    const keys = found.issues.flatMap((issue) =>
      issue.key ? [issue.key.trim().toUpperCase()] : [],
    )
    const all = normaliseJiraOverview(
      found.issues,
      keys,
      'agent-selected report tickets',
    ).issues
    const matching = filterItems(all, query)
    return {
      items: matching.slice(0, want),
      total: byName ? null : found.total,
      more: matching.length > want || found.more,
    }
  }

  /** The assistant's item read: overview fields, or everything with detail. */
  async aiItems(
    projectKey: string,
    keys: string[],
    detail: boolean,
    signal?: AbortSignal,
  ): Promise<BoardItemsResult> {
    const bundle = await this.lookupIssues(
      projectKey,
      {
        mode: detail ? 'detail' : 'overview',
        source: 'agent-selected report tickets',
        keys,
        availableCount: keys.length,
        omittedCount: 0,
      },
      signal,
    )
    return { items: bundle.issues, unavailable: bundle.unavailableKeys }
  }

  async investigateIssues(
    projectKey: string,
    issueKeys: string[],
    signal?: AbortSignal,
  ): Promise<AiJiraEvidenceBundle> {
    const requestedKeys = extractProjectTicketKeys(
      issueKeys.join(' '),
      projectKey,
    )
    if (!requestedKeys.length) {
      return {
        mode: 'detail',
        source: 'named tickets',
        requestedKeys: [],
        issues: [],
        unavailableKeys: [],
        omittedCount: 0,
      }
    }
    const quotedKeys = requestedKeys
      .map((key) => `"${escapeJql(key)}"`)
      .join(',')
    const page = await this.get<JiraIssuePage>(
      `/rest/api/2/search?jql=${encodeURIComponent(`project = "${escapeJql(projectKey)}" AND key in (${quotedKeys}) ORDER BY key`)}&startAt=0&maxResults=${requestedKeys.length}&fields=${AI_INVESTIGATION_FIELDS}&expand=changelog`,
      signal,
    )
    const completeIssues: JiraIssueResponse[] = []
    for (const issue of page.issues ?? []) {
      const withHistory = await this.ensureCompleteHistory(
        issue,
        signal,
        AI_INVESTIGATION_FIELDS,
      )
      completeIssues.push(await this.ensureRecentComments(withHistory, signal))
    }
    return normaliseJiraInvestigation(completeIssues, requestedKeys)
  }

  async lookupIssues(
    projectKey: string,
    lookup: AiJiraLookup,
    signal?: AbortSignal,
  ): Promise<AiJiraEvidenceBundle> {
    if (lookup.mode === 'detail') {
      const evidence = await this.investigateIssues(
        projectKey,
        lookup.keys,
        signal,
      )
      return {
        ...evidence,
        source: lookup.source,
        omittedCount: lookup.omittedCount,
      }
    }

    const requestedKeys = extractProjectTicketKeys(
      lookup.keys.join(' '),
      projectKey,
      25,
    )
    if (!requestedKeys.length) {
      return {
        mode: 'overview',
        source: lookup.source,
        requestedKeys: [],
        issues: [],
        unavailableKeys: [],
        omittedCount: lookup.omittedCount,
      }
    }
    const quotedKeys = requestedKeys
      .map((key) => `"${escapeJql(key)}"`)
      .join(',')
    const page = await this.get<JiraIssuePage>(
      `/rest/api/2/search?jql=${encodeURIComponent(`project = "${escapeJql(projectKey)}" AND key in (${quotedKeys}) ORDER BY key`)}&startAt=0&maxResults=${requestedKeys.length}&fields=${AI_OVERVIEW_FIELDS}`,
      signal,
    )
    return normaliseJiraOverview(
      page.issues ?? [],
      requestedKeys,
      lookup.source,
      lookup.omittedCount,
    )
  }

  private async getBoardIssueKeys(
    projectKey: string,
    boardId: string,
    signal?: AbortSignal,
    restriction?: string,
    onProgress?: ProgressReporter,
    /** Stop, with JiraTooManyItemsError, once more keys than this are seen. */
    maxKeys = 5000,
  ): Promise<string[]> {
    const keys = new Set<string>()
    let startAt = 0
    let reported = 0
    onProgress?.(BOARD_PROGRESS.items)

    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES) throw tooManyPages()
      const jql = `project = "${escapeJql(projectKey)}"${restriction ? ` AND ${restriction}` : ''}`
      const page = await this.get<JiraIssuePage>(
        `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/issue?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=100&fields=issuetype,created,status`,
        signal,
        maxKeys,
      )
      const issues = page.issues ?? []
      issues.forEach((issue) => {
        if (issue.key) keys.add(issue.key)
      })
      // Past the limit: stop here rather than reading every key first.
      if (keys.size > maxKeys)
        throw new JiraTooManyItemsError(
          502,
          'Jira returned more items than this report can safely load. Narrow the project scope.',
        )
      const pageSize = page.maxResults ?? issues.length
      const nextStart = (page.startAt ?? startAt) + pageSize
      const finished =
        issues.length === 0 ||
        (page.total !== undefined && nextStart >= page.total)
      // One update per ~500 keys keeps the stream small on huge boards.
      if (onProgress && (finished || keys.size - reported >= 500)) {
        reported = keys.size
        onProgress({ ...BOARD_PROGRESS.items, detail: foundDetail(keys.size) })
      }
      if (finished) return [...keys]
      startAt = nextStart
    }
  }

  private async getIssuesWithHistory(
    issueKeys: string[],
    signal?: AbortSignal,
    onProgress?: ProgressReporter,
  ): Promise<JiraIssueResponse[]> {
    const issues: JiraIssueResponse[] = []
    const total = issueKeys.length
    const every = progressInterval(total)
    let reported = 0
    const report = (force = false, count = issues.length) => {
      const done = Math.min(count, total)
      if (!onProgress || (!force && done - reported < every)) return
      reported = done
      onProgress({
        ...BOARD_PROGRESS.history,
        detail: historyDetail(done, total),
        done,
        total,
      })
    }
    report(true)
    if (this.config.cloud) {
      // Cloud: plain fields first, then status history in bulk (1,000 items per call).
      const pages = await mapWithLimit(
        chunk(issueKeys, 100),
        HISTORY_CONCURRENCY,
        (keys) =>
          this.get<JiraIssuePage>(
            `/rest/api/2/search?jql=${encodeURIComponent(`key in (${quoteKeys(keys)}) ORDER BY key`)}&maxResults=100&fields=${SNAPSHOT_FIELDS}`,
            signal,
          ),
      )
      const found = pages.flatMap((page) => page.issues ?? [])
      const histories = await this.bulkStatusHistory(found, signal, (count) =>
        report(false, count),
      )
      if (histories) {
        issues.push(
          ...found.map((issue) => {
            const entries = histories.get(issue.id ?? '') ?? []
            return {
              ...issue,
              changelog: {
                startAt: 0,
                maxResults: entries.length,
                total: entries.length,
                histories: entries,
              },
            }
          }),
        )
      } else {
        await mapWithLimit(found, 8, async (issue) => {
          issues.push(await this.ensureCompleteHistory(issue, signal))
          report()
        })
      }
    } else {
      // Data Center: 40-item pages with history embedded, a few at a time.
      await mapWithLimit(
        chunk(issueKeys, 40),
        HISTORY_CONCURRENCY,
        async (keys) => {
          let startAt = 0
          for (let pages = 0; ; pages++) {
            if (pages >= MAX_PAGES) throw tooManyPages()
            const page = await this.get<JiraIssuePage>(
              `/rest/api/2/search?jql=${encodeURIComponent(`key in (${quoteKeys(keys)}) ORDER BY key`)}&startAt=${startAt}&maxResults=40&fields=${SNAPSHOT_FIELDS}&expand=changelog`,
              signal,
            )
            const pageIssues = page.issues ?? []
            for (const issue of pageIssues) {
              issues.push(await this.ensureCompleteHistory(issue, signal))
              report()
            }
            const pageSize = page.maxResults ?? pageIssues.length
            const nextStart = (page.startAt ?? startAt) + pageSize
            if (
              pageIssues.length === 0 ||
              (page.total !== undefined && nextStart >= page.total)
            )
              return
            startAt = nextStart
          }
        },
      )
    }
    if (reported < Math.min(issues.length, total)) report(true)
    return issues
  }

  /**
   * Status changes for many Cloud issues at once. Returns null when the site
   * does not offer the bulk endpoint, so the caller can fall back per issue.
   */
  private async bulkStatusHistory(
    issues: JiraIssueResponse[],
    signal: AbortSignal | undefined,
    onIssuesDone: (count: number) => void,
  ): Promise<Map<string, NonNullable<JiraChangelog['histories']>> | null> {
    const byIssue = new Map<string, NonNullable<JiraChangelog['histories']>>()
    const ids = issues.flatMap((issue) => (issue.id ? [issue.id] : []))
    let done = 0
    for (const batch of chunk(ids, 1000)) {
      let nextPageToken: string | undefined
      for (let pageCount = 0; ; pageCount += 1) {
        if (pageCount >= 500)
          throw new JiraUpstreamError(502, 'Jira pagination did not complete.')
        let page: {
          issueChangeLogs?: Array<{
            issueId?: string
            changeHistories?: NonNullable<JiraChangelog['histories']>
          }>
          nextPageToken?: string | null
        }
        try {
          page = await this.request('/rest/api/3/changelog/bulkfetch', signal, {
            issueIdsOrKeys: batch,
            fieldIds: ['status'],
            maxResults: 10000,
            ...(nextPageToken ? { nextPageToken } : {}),
          })
        } catch (caught) {
          if (
            done === 0 &&
            caught instanceof JiraUpstreamError &&
            [400, 403, 404, 405].includes(caught.status)
          )
            return null
          throw caught
        }
        if (!Array.isArray(page.issueChangeLogs))
          throw new JiraUpstreamError(
            502,
            'Jira returned invalid status history.',
          )
        for (const log of page.issueChangeLogs) {
          if (!log.issueId) continue
          const entries = byIssue.get(log.issueId) ?? []
          entries.push(...(log.changeHistories ?? []))
          byIssue.set(log.issueId, entries)
        }
        if (!page.nextPageToken || page.nextPageToken === nextPageToken) break
        nextPageToken = page.nextPageToken
      }
      done += batch.length
      onIssuesDone(done)
    }
    return byIssue
  }

  private async ensureCompleteHistory(
    issue: JiraIssueResponse,
    signal?: AbortSignal,
    fields = SNAPSHOT_FIELDS,
  ): Promise<JiraIssueResponse> {
    if (this.config.cloud) {
      if (!issue.key)
        throw new JiraUpstreamError(
          502,
          'Jira returned an issue without a key.',
        )
      const histories: NonNullable<JiraChangelog['histories']> = []
      let startAt = 0
      for (;;) {
        const page = await this.request<{
          startAt?: number
          maxResults?: number
          total?: number
          isLast?: boolean
          values?: NonNullable<JiraChangelog['histories']>
        }>(
          `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog?startAt=${startAt}&maxResults=100`,
          signal,
        )
        if (!Array.isArray(page.values))
          throw new JiraUpstreamError(
            502,
            'Jira returned invalid status history.',
          )
        histories.push(...page.values)
        if (histories.length > 20000)
          throw new JiraUpstreamError(
            502,
            'Jira status history exceeds the supported limit. Narrow the report scope.',
          )
        const next = (page.startAt ?? startAt) + page.values.length
        if (
          page.isLast === true ||
          (page.total !== undefined && next >= page.total)
        )
          break
        if (!page.values.length || next <= startAt)
          throw new JiraUpstreamError(
            502,
            'Jira returned incomplete status history.',
          )
        startAt = next
      }
      return {
        ...issue,
        changelog: {
          startAt: 0,
          maxResults: histories.length,
          total: histories.length,
          histories,
        },
      }
    }
    if (!isTruncated(issue.changelog)) return issue
    if (!issue.key) {
      throw new JiraUpstreamError(502, 'Jira returned an issue without a key.')
    }
    const complete = await this.get<JiraIssueResponse>(
      `/rest/api/2/issue/${encodeURIComponent(issue.key)}?fields=${encodeURIComponent(fields)}&expand=changelog`,
      signal,
    )
    if (isTruncated(complete.changelog)) {
      throw new JiraUpstreamError(
        502,
        'Jira returned incomplete status history for this board.',
      )
    }
    return complete
  }

  private async ensureRecentComments(
    issue: JiraIssueResponse,
    signal?: AbortSignal,
  ): Promise<JiraIssueResponse> {
    const embedded = issue.fields?.comment
    const comments = embedded?.comments ?? []
    const total = embedded?.total
    if (!issue.key || total === undefined || total <= comments.length) {
      return issue
    }
    const page = await this.get<JiraCommentPage>(
      `/rest/api/2/issue/${encodeURIComponent(issue.key)}/comment?startAt=${Math.max(0, total - 8)}&maxResults=8&orderBy=created`,
      signal,
    )
    return {
      ...issue,
      fields: issue.fields ? { ...issue.fields, comment: page } : issue.fields,
    }
  }

  private async get<T>(
    path: string,
    signal?: AbortSignal,
    /** Board item pages: stop with an error past this many issues. */
    maxIssues?: number,
  ): Promise<T> {
    if (
      this.config.cloud &&
      (/^\/rest\/api\/2\/search\?/.test(path) ||
        /^\/rest\/agile\/1.0\/board\/[^/]+\/issue\?/.test(path))
    ) {
      const url = new URL(path, 'https://placeholder.invalid')
      url.pathname = url.pathname.startsWith('/rest/api/')
        ? '/rest/api/3/search/jql'
        : url.pathname.replace('/rest/agile/', '/rest/software/')
      url.searchParams.delete('startAt')
      // Preserve callers' small evidence limits; the board history loader is bounded at 5,000.
      const limit = url.pathname.endsWith('/search/jql')
        ? 100
        : (maxIssues ?? 5000)
      url.searchParams.set('maxResults', '100')
      const issues: JiraIssueResponse[] = []
      const seen = new Set<string>()
      for (;;) {
        const page = await this.request<{
          issues?: JiraIssueResponse[]
          isLast?: boolean
          nextPageToken?: string
        }>(url.pathname + url.search, signal)
        if (!Array.isArray(page.issues))
          throw new JiraUpstreamError(
            502,
            'Jira returned an invalid issue page.',
          )
        issues.push(...page.issues)
        if (issues.length > limit)
          throw new JiraTooManyItemsError(
            502,
            'Jira returned more items than this report can safely load. Narrow the project scope.',
          )
        if (page.isLast === true) break
        if (!page.nextPageToken) {
          if (page.isLast === false)
            throw new JiraUpstreamError(
              502,
              'Jira returned incomplete pagination.',
            )
          break
        }
        if (seen.has(page.nextPageToken) || seen.size >= 200)
          throw new JiraUpstreamError(502, 'Jira pagination did not complete.')
        seen.add(page.nextPageToken)
        url.searchParams.set('nextPageToken', page.nextPageToken)
      }
      return {
        issues,
        startAt: 0,
        maxResults: issues.length,
        total: issues.length,
      } as T
    }
    return this.request<T>(path, signal)
  }

  /** A body turns the call into a read-only POST (used for bulk history). */
  private async request<T>(
    path: string,
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    if (!path.startsWith('/rest/')) {
      throw new Error('Only Jira REST paths are allowed.')
    }
    if (this.config.cloud) path = path.replace('/rest/api/2/', '/rest/api/3/')
    // Each attempt may wait JIRA_ATTEMPT_MS for the reply to start; a silent
    // one (VPNs drop some) is tried again. The overall limit covers them all.
    const timeout = AbortSignal.timeout(JIRA_REQUEST_MS)
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Awaited<ReturnType<typeof fetch>>
    const headers = this.config.accessToken
      ? {
          ...this.headers,
          Authorization: `Bearer ${await this.config.accessToken(combinedSignal)}`,
        }
      : this.headers
    try {
      // Reads, and the read-only bulk-history POST: safe to repeat when
      // Jira throttles or briefly fails.
      response = await fetchWithRetry(
        (attemptSignal) =>
          fetch(`${this.root}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            redirect: 'manual',
            headers:
              body === undefined
                ? headers
                : { ...headers, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            dispatcher: this.dispatcher,
            signal: attemptSignal,
          }),
        {
          signal: combinedSignal,
          retryDropped: true,
          attemptTimeoutMs: JIRA_ATTEMPT_MS,
        },
      )
    } catch (caught) {
      // The caller gave up: that is not a Jira failure.
      if (signal?.aborted) throw caught
      const error =
        caught && typeof caught === 'object'
          ? (caught as { name?: string; cause?: { code?: string } })
          : {}
      const code = error.cause?.code
      const timedOut =
        error.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT'
      // On the hosted site a failed connection gets one answer whatever the
      // cause, so the wording cannot be used to learn which names exist on
      // the server's own network.
      if (this.config.hosted && !timedOut)
        throw new JiraUpstreamError(
          502,
          HOSTED_CANNOT_REACH,
          'jira-not-reachable-hosted',
        )
      const message =
        code === 'ENOTFOUND'
          ? 'The server could not resolve Jira. Check the installation’s network or proxy settings.'
          : code === 'ECONNREFUSED'
            ? 'The Jira connection was refused. Check that the installation’s proxy or VPN is running.'
            : timedOut
              ? 'Jira did not respond in time. Check your VPN and try again.'
              : 'The server could not connect to Jira. Check the installation’s VPN, proxy, and certificate settings.'
      throw new JiraUpstreamError(502, message)
    }

    // Jira marks its own answers; a gateway or sign-in page does not.
    const fromJira = JIRA_HEADERS.some((name) => response.headers.has(name))
    if (this.config.hosted && !fromJira && !response.ok)
      throw new JiraUpstreamError(
        502,
        HOSTED_CANNOT_REACH,
        'jira-not-reachable-hosted',
      )
    if (response.status >= 300 && response.status < 400)
      throw new JiraUpstreamError(
        502,
        this.config.apiKey || this.config.cloud
          ? 'Jira redirected the API request to another page. Check the Jira link.'
          : 'Jira redirected the API request to a sign-in page. Check the Jira link. If your company puts Jira behind an API gateway, add its key in the API gateway key field.',
        this.config.apiKey || this.config.cloud
          ? undefined
          : 'gateway-key-required',
      )
    if (!response.ok && !this.config.cloud) {
      if ((response.status === 401 || response.status === 403) && !fromJira)
        throw this.config.apiKey
          ? new JiraUpstreamError(
              response.status,
              GATEWAY_KEY_REJECTED,
              'gateway-key-rejected',
            )
          : new JiraUpstreamError(
              response.status,
              GATEWAY_KEY_REQUIRED,
              'gateway-key-required',
            )
      if (response.status === 401)
        throw new JiraUpstreamError(
          401,
          JIRA_TOKEN_REJECTED,
          'jira-token-rejected',
        )
    }
    if (!response.ok) {
      // A query Jira cannot run says why (an unknown status or field): pass
      // that on, so the assistant can correct its search.
      const reason =
        response.status === 400
          ? jiraErrorReason(
              await cappedText(response, ERROR_RESPONSE_BYTES).catch(() => ''),
            )
          : ''
      if (reason)
        throw new JiraUpstreamError(400, `Jira could not run this: ${reason}`)
      throw new JiraUpstreamError(
        response.status,
        this.config.cloud && response.status === 401
          ? this.config.email
            ? 'Jira Cloud did not accept this email and API token. Check both and reconnect.'
            : 'Jira Cloud access expired or was revoked. Reconnect with Atlassian from Workspace.'
          : upstreamMessage(response.status),
      )
    }
    const text = await cappedText(response, BOARD_RESPONSE_BYTES).catch(
      (error: unknown) => {
        if (error instanceof ResponseTooLargeError)
          throw new JiraTooManyItemsError(
            502,
            'Jira sent more data than this report can safely load. Narrow the project scope.',
          )
        throw error
      },
    )
    try {
      return JSON.parse(text) as T
    } catch {
      // A sign-in page or portal answered instead of Jira's API.
      if (this.config.hosted)
        throw new JiraUpstreamError(
          502,
          HOSTED_CANNOT_REACH,
          'jira-not-reachable-hosted',
        )
      if (this.viaProxy && !this.config.cloud && !this.config.dispatcher)
        throw new JiraUpstreamError(502, PROXY_NOT_JIRA_DATA)
      throw new JiraUpstreamError(
        502,
        this.config.cloud
          ? 'Jira Cloud answered with a web page instead of data. Check the Jira link and try again.'
          : NOT_JIRA_DATA,
        this.config.cloud || this.config.apiKey
          ? undefined
          : 'gateway-key-required',
      )
    }
  }
}

/** Jira's own errorMessages from a 400 answer, short and on one line. */
export function jiraErrorReason(text: string): string {
  try {
    const body = JSON.parse(text) as {
      errorMessages?: unknown
      errors?: unknown
    }
    const messages = [
      ...(Array.isArray(body.errorMessages)
        ? (body.errorMessages as unknown[])
        : []),
      ...(body.errors && typeof body.errors === 'object'
        ? Object.values(body.errors as Record<string, unknown>)
        : []),
    ].filter((item): item is string => typeof item === 'string')
    return messages.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  } catch {
    return ''
  }
}

function normaliseBoard(
  configuration: JiraBoardConfiguration,
  selectedBoard: JiraBoardOption,
  statusLookup: Map<string, FlowStatus>,
  boardId: string,
): JiraBoardRecord {
  const columns = configuration.columnConfig?.columns ?? []
  return {
    id: boardId,
    name: configuration.name || selectedBoard.name,
    columns: columns.map((column, index) => ({
      id: `jira-column:${boardId}:${index}`,
      name: column.name || `Column ${index + 1}`,
      statuses: (column.statuses ?? []).flatMap((status) => {
        if (!status.id) return []
        return [
          statusLookup.get(status.id) ?? {
            id: status.id,
            name: `Status ${status.id}`,
          },
        ]
      }),
    })),
  }
}

export function normaliseIssues(
  rawIssues: JiraIssueResponse[],
  statusLookup = new Map<string, FlowStatus>(),
  projectKey?: string,
): {
  issues: JiraIssueRecord[]
  changes: JiraStatusChangeRecord[]
} {
  const issues: JiraIssueRecord[] = []
  const changes: JiraStatusChangeRecord[] = []
  const seenIssueIds = new Set<string>()

  rawIssues.forEach((issue) => {
    const fields = issue.fields
    const currentStatusId = fields?.status?.id
    if (!issue.id || !issue.key || !fields?.created || !currentStatusId) return
    if (
      projectKey &&
      !issue.key.trim().toUpperCase().startsWith(`${projectKey}-`)
    ) {
      return
    }
    if (seenIssueIds.has(issue.id)) return
    seenIssueIds.add(issue.id)
    const currentStatus = resolveStatus(
      currentStatusId,
      fields.status?.name,
      statusLookup,
    )
    issues.push({
      id: issue.id,
      key: issue.key,
      issueTypeId: fields.issuetype?.id ?? '',
      issueTypeName: fields.issuetype?.name?.trim() || 'Unknown',
      createdAt: normaliseTimestamp(fields.created),
      currentStatus,
      ...(boundedText(fields.summary, TITLE_LIMIT)
        ? { title: boundedText(fields.summary, TITLE_LIMIT) }
        : {}),
      ...(fields.resolution?.name?.trim()
        ? { resolution: fields.resolution.name.trim() }
        : {}),
      ...issueHierarchy(fields.issuetype),
      ...snapshotOwner(fields),
    })

    const histories = [...(issue.changelog?.histories ?? [])].sort(
      (left, right) =>
        Date.parse(normaliseTimestamp(left.created)) -
        Date.parse(normaliseTimestamp(right.created)),
    )
    histories.forEach((history) => {
      if (!normaliseTimestamp(history.created)) return
      history.items?.forEach((item) => {
        if (
          item.field?.toLowerCase() !== 'status' &&
          item.fieldId?.toLowerCase() !== 'status'
        ) {
          return
        }
        if (!item.to) return
        changes.push({
          issueId: issue.id!,
          changedAt: normaliseTimestamp(history.created),
          fromStatus: item.from
            ? resolveStatus(item.from, item.fromString, statusLookup)
            : null,
          toStatus: resolveStatus(item.to, item.toString, statusLookup),
        })
      })
    })
  })

  return { issues, changes }
}

export function normaliseJiraInvestigation(
  rawIssues: JiraIssueResponse[],
  requestedKeys: string[],
): AiJiraEvidenceBundle {
  const issueLookup = new Map<string, AiJiraIssueEvidence>()
  const requested = new Set(requestedKeys)

  rawIssues.forEach((issue) => {
    const key = issue.key?.trim().toUpperCase() ?? ''
    const fields = issue.fields
    if (!key || !requested.has(key) || !fields || issueLookup.has(key)) return
    const comments = [...(fields.comment?.comments ?? [])]
      .sort(
        (left, right) =>
          Date.parse(left.created ?? '') - Date.parse(right.created ?? ''),
      )
      .slice(-8)
      .flatMap((comment) => {
        const body = boundedText(comment.body, 800)
        const createdAt = safeTimestamp(comment.created)
        if (!body || !createdAt) return []
        const updatedAt = safeTimestamp(comment.updated)
        return [
          {
            author: displayName(comment.author),
            createdAt,
            ...(updatedAt && updatedAt !== createdAt ? { updatedAt } : {}),
            body,
          },
        ]
      })
    const history = (issue.changelog?.histories ?? [])
      .flatMap((entry) => {
        const changedAt = safeTimestamp(entry.created)
        if (!changedAt) return []
        return (entry.items ?? []).flatMap((item) => {
          const field = allowedHistoryField(item.field, item.fieldId)
          if (!field) return []
          return [
            {
              changedAt,
              changedBy: displayName(entry.author),
              field,
              fromValue: nullableBoundedText(item.fromString, 240),
              toValue: nullableBoundedText(item.toString, 240),
            },
          ]
        })
      })
      .sort(
        (left, right) =>
          Date.parse(left.changedAt) - Date.parse(right.changedAt),
      )
      .slice(-25)
    const parent = normaliseRelatedIssue(fields.parent)

    issueLookup.set(key, {
      key,
      summary: boundedText(fields.summary, 500) || key,
      description: boundedText(fields.description, 2_000),
      issueType: boundedText(fields.issuetype?.name, 120) || 'Unknown',
      status: boundedText(fields.status?.name, 120) || 'Unknown',
      statusCategory:
        boundedText(fields.status?.statusCategory?.name, 120) || 'Unknown',
      priority: boundedText(fields.priority?.name, 120) || 'Unspecified',
      assignee: fields.assignee ? displayName(fields.assignee) : null,
      components: uniqueBoundedTexts(
        (fields.components ?? []).map((component) => component.name),
        10,
        120,
      ),
      labels: uniqueBoundedTexts(fields.labels ?? [], 15, 120),
      fixVersions: uniqueBoundedTexts(
        (fields.fixVersions ?? []).map((version) => version.name),
        10,
        120,
      ),
      ...(safeTimestamp(fields.created)
        ? { createdAt: safeTimestamp(fields.created) }
        : {}),
      ...(safeTimestamp(fields.updated)
        ? { updatedAt: safeTimestamp(fields.updated) }
        : {}),
      ...(boundedText(fields.duedate, 40)
        ? { dueDate: boundedText(fields.duedate, 40) }
        : {}),
      ...(parent ? { parent } : {}),
      subtasks: (fields.subtasks ?? [])
        .flatMap((subtask) => {
          const normalized = normaliseRelatedIssue(subtask)
          return normalized ? [normalized] : []
        })
        .slice(0, 15),
      links: (fields.issuelinks ?? [])
        .flatMap((link) => {
          const inward = normaliseIssueLink(
            link.inwardIssue,
            'inward',
            link.type?.inward || link.type?.name,
          )
          const outward = normaliseIssueLink(
            link.outwardIssue,
            'outward',
            link.type?.outward || link.type?.name,
          )
          return [inward, outward].filter(
            (candidate): candidate is NonNullable<typeof candidate> =>
              candidate !== null,
          )
        })
        .slice(0, 15),
      comments,
      history,
    })
  })

  return {
    mode: 'detail',
    source: 'named tickets',
    requestedKeys,
    issues: requestedKeys.flatMap((key) => {
      const issue = issueLookup.get(key)
      return issue ? [issue] : []
    }),
    unavailableKeys: requestedKeys.filter((key) => !issueLookup.has(key)),
    omittedCount: 0,
  }
}

export function normaliseJiraOverview(
  rawIssues: JiraIssueResponse[],
  requestedKeys: string[],
  source: AiJiraLookupSource,
  omittedCount = 0,
): AiJiraEvidenceBundle {
  const requested = new Set(requestedKeys)
  const issueLookup = new Map<string, AiJiraIssueEvidence>()

  rawIssues.forEach((issue) => {
    const key = issue.key?.trim().toUpperCase() ?? ''
    const fields = issue.fields
    if (!key || !requested.has(key) || !fields || issueLookup.has(key)) return
    issueLookup.set(key, {
      key,
      summary: boundedText(fields.summary, 500) || key,
      issueType: boundedText(fields.issuetype?.name, 120) || 'Unknown',
      status: boundedText(fields.status?.name, 120) || 'Unknown',
      statusCategory:
        boundedText(fields.status?.statusCategory?.name, 120) || 'Unknown',
      priority: boundedText(fields.priority?.name, 120) || 'Unspecified',
      assignee: fields.assignee ? displayName(fields.assignee) : null,
      components: uniqueBoundedTexts(
        (fields.components ?? []).map((component) => component.name),
        10,
        120,
      ),
      ...(safeTimestamp(fields.updated)
        ? { updatedAt: safeTimestamp(fields.updated) }
        : {}),
      ...(boundedText(fields.duedate, 40)
        ? { dueDate: boundedText(fields.duedate, 40) }
        : {}),
      ...(normaliseRelatedIssue(fields.parent)
        ? { parent: normaliseRelatedIssue(fields.parent)! }
        : {}),
    })
  })

  return {
    mode: 'overview',
    source,
    requestedKeys,
    issues: requestedKeys.flatMap((key) => {
      const issue = issueLookup.get(key)
      return issue ? [issue] : []
    }),
    unavailableKeys: requestedKeys.filter((key) => !issueLookup.has(key)),
    omittedCount,
  }
}

function normaliseRelatedIssue(
  value: JiraRelatedIssueResponse | undefined,
): AiJiraRelatedIssue | null {
  const key = value?.key?.trim().toUpperCase() ?? ''
  if (!/^[A-Z][A-Z0-9_]{1,29}-\d+$/.test(key)) return null
  return {
    key,
    summary: boundedText(value?.fields?.summary, 300) || key,
    status: boundedText(value?.fields?.status?.name, 120) || 'Unknown',
    issueType: boundedText(value?.fields?.issuetype?.name, 120) || 'Unknown',
  }
}

function normaliseIssueLink(
  issue: JiraRelatedIssueResponse | undefined,
  direction: 'inward' | 'outward',
  relationship: string | undefined,
) {
  const related = normaliseRelatedIssue(issue)
  if (!related) return null
  return {
    direction,
    relationship: boundedText(relationship, 160) || 'is linked to',
    key: related.key,
    summary: related.summary,
    issueType: related.issueType,
    status: related.status,
  }
}

function allowedHistoryField(
  field: string | undefined,
  fieldId: string | undefined,
): string {
  const value = (field || fieldId || '').trim().toLowerCase()
  const allowed = new Map([
    ['status', 'Status'],
    ['assignee', 'Assignee'],
    ['priority', 'Priority'],
    ['resolution', 'Resolution'],
    ['labels', 'Labels'],
    ['fix version', 'Fix version'],
    ['fixversion', 'Fix version'],
    ['sprint', 'Sprint'],
    ['link', 'Issue link'],
  ])
  return allowed.get(value) ?? ''
}

/**
 * The assignee for flow signals. Jira omits the field when it was not
 * requested, and sends null when nobody holds the item.
 */
function snapshotOwner(fields: NonNullable<JiraIssueResponse['fields']>): {
  assignee?: string
  ownerKnown?: boolean
} {
  if (!('assignee' in fields)) return {}
  return fields.assignee
    ? { assignee: displayName(fields.assignee), ownerKnown: true }
    : { ownerKnown: true }
}

function displayName(value: JiraAssigneeResponse | undefined): string {
  return (
    boundedText(value?.displayName, 160) ||
    boundedText(value?.name, 160) ||
    boundedText(value?.key, 160) ||
    'Unknown'
  )
}

function uniqueBoundedTexts(
  values: Array<string | undefined>,
  limit: number,
  maxLength: number,
): string[] {
  return [
    ...new Set(
      values.map((value) => boundedText(value, maxLength)).filter(Boolean),
    ),
  ].slice(0, limit)
}

function boundedText(value: unknown, maxLength: number): string {
  if (typeof value === 'string') return value.trim().slice(0, maxLength)
  // Jira Cloud returns Atlassian Document Format; extract text nodes only.
  const parts: string[] = []
  let size = 0,
    nodes = 0
  function visit(node: unknown, depth: number) {
    if (
      !node ||
      typeof node !== 'object' ||
      depth > 12 ||
      nodes++ > 500 ||
      size >= maxLength
    )
      return
    const item = node as Record<string, unknown>
    if (item.type === 'text' && typeof item.text === 'string') {
      const text = item.text.slice(0, maxLength - size)
      parts.push(text)
      size += text.length + 1
    }
    if (Array.isArray(item.content))
      for (const child of item.content) visit(child, depth + 1)
  }
  visit(value, 0)
  return parts.join(' ').trim().slice(0, maxLength)
}

function nullableBoundedText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  return boundedText(value, maxLength) || null
}

function safeTimestamp(value: unknown): string {
  return normaliseTimestamp(value)
}

/**
 * Jira sends dates as text ("2026-10-25T09:12:00.000+0200"), but Cloud's bulk
 * changelog sends epoch numbers. Both become ISO text; anything unreadable
 * becomes '' so it is dropped as invalid, never passed on as a number.
 */
export function normaliseTimestamp(value: unknown): string {
  const parsed =
    typeof value === 'number'
      ? epochMs(value)
      : typeof value === 'string' && /^\d{9,}$/.test(value.trim())
        ? epochMs(Number(value.trim()))
        : typeof value === 'string'
          ? Date.parse(value)
          : Number.NaN
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

/** Epoch seconds or milliseconds, told apart by size. */
function epochMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return Number.NaN
  return value < 1e11 ? value * 1000 : value
}

function statusCategory(key: string | undefined): FlowStatus['category'] {
  return key === 'new'
    ? 'todo'
    : key === 'indeterminate'
      ? 'in-progress'
      : key === 'done'
        ? 'done'
        : undefined
}

/** Sub-tasks and epics are parts or containers of other work. */
function issueHierarchy(
  type:
    | { name?: string; subtask?: boolean; hierarchyLevel?: number }
    | undefined,
): { hierarchy?: 'subtask' | 'epic' } {
  if (type?.subtask || (type?.hierarchyLevel ?? 0) < 0)
    return { hierarchy: 'subtask' }
  if (
    (type?.hierarchyLevel ?? 0) >= 1 ||
    type?.name?.trim().toLowerCase() === 'epic'
  )
    return { hierarchy: 'epic' }
  return {}
}

function resolveStatus(
  id: string,
  name: string | null | undefined,
  lookup: Map<string, FlowStatus>,
): FlowStatus {
  return lookup.get(id) ?? { id, name: name || `Status ${id}` }
}

function isTruncated(changelog: JiraChangelog | undefined): boolean {
  if (!changelog || changelog.total === undefined) return false
  return changelog.total > (changelog.histories?.length ?? 0)
}

function escapeJql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function upstreamMessage(status: number): string {
  if (status === 401)
    return 'Jira rejected the credentials. Check the personal access token and any required gateway key.'
  if (status === 403)
    return 'Your Jira account cannot access this project or board.'
  if (status === 404) return 'The Jira project or board was not found.'
  if (status === 429) return 'Jira is busy. Wait briefly and try again.'
  return 'Jira returned an unexpected response.'
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += size)
    chunks.push(items.slice(offset, offset + size))
  return chunks
}

function quoteKeys(keys: string[]): string {
  return keys.map((key) => `"${escapeJql(key)}"`).join(',')
}

/** Runs `task` over `items` with at most `limit` in flight; results keep input order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  let failed = false
  // One failure stops the other workers starting more requests.
  const worker = async () => {
    while (next < items.length && !failed) {
      const index = next++
      try {
        results[index] = await task(items[index] as T)
      } catch (caught) {
        failed = true
        throw caught
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}
