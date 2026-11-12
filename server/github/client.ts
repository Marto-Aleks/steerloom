import { fetch, ProxyAgent, type Dispatcher } from 'undici'
import { fetchWithRetry, isDropped } from '../http/fetch-retry'
import { bypassesProxy } from '../http/no-proxy'
import {
  pullRequestKeys,
  type BranchRecord,
  type PullRequestChecks,
  type PullRequestRecord,
} from '../../src/lib/data-source/github'

/** How long one attempt may wait for GitHub to start answering. */
const GITHUB_ATTEMPT_MS = 30_000
/** A pull request page; 50 keeps each answer well inside GitHub's limits. */
const PAGE_SIZE = 50
/** At most this many pull requests per repository and load. */
const PULL_REQUEST_LIMIT = 1000
/** Branches are read newest first, 100 a page, at most this many. */
const BRANCH_PAGE_SIZE = 100
const BRANCH_LIMIT = 1000

export type GithubFailureReason =
  | 'github-token-rejected'
  | 'github-repo-not-visible'
  | 'github-token-too-broad'
  | 'github-token-no-expiry'

export class GithubError extends Error {
  constructor(
    message: string,
    readonly reason?: GithubFailureReason,
  ) {
    super(message)
  }
}

export interface GithubConfig {
  /** https://github.com, or a GitHub Enterprise Server address. */
  baseUrl: string
  token: string
  proxyUrl?: string
  dispatcher?: Dispatcher
}

/*
 * The only queries Steerloom sends. GitHub's GraphQL API takes every query as
 * a POST; these documents only read, and nothing else is ever sent, so access
 * stays read-only. Only timing fields are asked for, plus the title and
 * branch to find item keys, the size of the change as counts, and the
 * combined check result of the latest commit. Author and reviewer logins are
 * compared here, so a reply by the author does not count as a review, and
 * never kept or sent.
 */
const VIEWER_QUERY = 'query { viewer { id } }'
const REPOSITORY_QUERY = `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { nameWithOwner }
}`
const PULL_REQUESTS_QUERY = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequests(first: ${PAGE_SIZE}, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number url title headRefName isDraft createdAt updatedAt mergedAt closedAt
        additions deletions changedFiles
        author { login }
        comments { totalCount }
        reviews(first: 50) { nodes { state submittedAt author { login } } }
        timelineItems(first: 20, itemTypes: [READY_FOR_REVIEW_EVENT]) {
          nodes { ... on ReadyForReviewEvent { createdAt } }
        }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`

/*
 * Branches, newest commit first: only the name (to find item keys, never
 * kept) and when the last commit was made. No code, no commit messages.
 */
const BRANCHES_QUERY = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    refs(refPrefix: "refs/heads/", first: ${BRANCH_PAGE_SIZE}, after: $after, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { name target { ... on Commit { committedDate } } }
    }
  }
}`

/** The only documents that may ever be sent: all four are read queries. */
const READ_QUERIES = new Set([
  VIEWER_QUERY,
  REPOSITORY_QUERY,
  PULL_REQUESTS_QUERY,
  BRANCHES_QUERY,
])

/** What GitHub says about the token itself, from the headers of a reply. */
export interface GithubTokenAccess {
  /** Classic and OAuth tokens list their scopes; fine-grained tokens do not. */
  scopes?: string[]
  /** When the token stops working, if it has an expiry. */
  expiresAt?: string
}

interface PullRequestNode {
  number?: number
  url?: string
  title?: string
  headRefName?: string
  isDraft?: boolean
  createdAt?: string
  updatedAt?: string
  mergedAt?: string | null
  closedAt?: string | null
  author?: { login?: string } | null
  comments?: { totalCount?: number }
  additions?: number
  deletions?: number
  changedFiles?: number
  commits?: {
    nodes?: Array<{
      commit?: { statusCheckRollup?: { state?: string } | null } | null
    } | null>
  }
  reviews?: {
    nodes?: Array<{
      state?: string
      submittedAt?: string | null
      author?: { login?: string } | null
    } | null>
  }
  timelineItems?: { nodes?: Array<{ createdAt?: string } | null> }
}

/**
 * Read-only pull request timing for chosen repositories, to show what
 * happens inside a Review stage the board itself does not split.
 */
export class GithubClient {
  private readonly endpoint: string
  private readonly dispatcher: Dispatcher | undefined

  constructor(private readonly config: GithubConfig) {
    this.endpoint = graphqlEndpoint(config.baseUrl)
    this.dispatcher =
      config.dispatcher ??
      (config.proxyUrl && !bypassesProxy(this.endpoint)
        ? new ProxyAgent(config.proxyUrl)
        : undefined)
  }

  /** Proves the token works and reports its scopes and expiry. */
  async verify(signal?: AbortSignal): Promise<GithubTokenAccess> {
    let access: GithubTokenAccess = {}
    await this.query(VIEWER_QUERY, {}, signal, (headers) => {
      access = tokenAccess(headers)
    })
    return access
  }

  /** The repository's canonical "owner/name", if this token can see it. */
  async repository(fullName: string, signal?: AbortSignal): Promise<string> {
    const data = await this.query<{
      repository?: { nameWithOwner?: string } | null
    }>(REPOSITORY_QUERY, splitRepository(fullName), signal)
    const name = data.repository?.nameWithOwner
    if (!name) throw notVisible(fullName)
    return name
  }

  /**
   * Pull requests updated since `since` that name an item key, newest first.
   * `tally.read` counts every pull request looked at, keyed or not.
   */
  async pullRequests(
    fullName: string,
    since: Date,
    signal?: AbortSignal,
    tally?: { read: number },
  ): Promise<PullRequestRecord[]> {
    const records: PullRequestRecord[] = []
    let after: string | null = null
    for (let read = 0; read < PULL_REQUEST_LIMIT; read += PAGE_SIZE) {
      const data: {
        repository?: {
          nameWithOwner?: string
          pullRequests?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
            nodes?: Array<PullRequestNode | null>
          }
        } | null
      } = await this.query(
        PULL_REQUESTS_QUERY,
        { ...splitRepository(fullName), after },
        signal,
      )
      const repository = data.repository
      if (!repository?.nameWithOwner) throw notVisible(fullName)
      const page = repository.pullRequests
      let older = false
      for (const node of page?.nodes ?? []) {
        if (!node) continue
        if (node.updatedAt && Date.parse(node.updatedAt) < since.getTime()) {
          older = true
          break
        }
        if (tally) tally.read += 1
        const record = toRecord(repository.nameWithOwner, node)
        if (record) records.push(record)
      }
      if (older || !page?.pageInfo?.hasNextPage) break
      after = page.pageInfo.endCursor ?? null
      if (!after) break
    }
    return records
  }

  /**
   * Branches whose name holds an item key and whose last commit is newer
   * than `since`: the keys and that date only, never the name itself.
   */
  async branches(
    fullName: string,
    since: Date,
    signal?: AbortSignal,
  ): Promise<BranchRecord[]> {
    const records: BranchRecord[] = []
    let after: string | null = null
    for (let read = 0; read < BRANCH_LIMIT; read += BRANCH_PAGE_SIZE) {
      const data: {
        repository?: {
          nameWithOwner?: string
          refs?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
            nodes?: Array<{
              name?: string
              target?: { committedDate?: string } | null
            } | null>
          }
        } | null
      } = await this.query(
        BRANCHES_QUERY,
        { ...splitRepository(fullName), after },
        signal,
      )
      const repository = data.repository
      if (!repository?.nameWithOwner) throw notVisible(fullName)
      const page = repository.refs
      // Sorting refs by date is not guaranteed for branches, so old ones are
      // skipped rather than taken as the end of the list.
      for (const node of page?.nodes ?? []) {
        const at = node?.target?.committedDate
        if (!node?.name || !at || Date.parse(at) < since.getTime()) continue
        const keys = pullRequestKeys('', node.name)
        if (keys.length)
          records.push({
            repo: repository.nameWithOwner,
            keys,
            lastCommitAt: at,
          })
      }
      if (!page?.pageInfo?.hasNextPage) break
      after = page.pageInfo.endCursor ?? null
      if (!after) break
    }
    return records
  }

  private async query<T>(
    document: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
    onHeaders?: (headers: Headers) => void,
  ): Promise<T> {
    // Read-only by construction: nothing but the fixed read queries leaves.
    if (!READ_QUERIES.has(document) || !/^\s*query\b/.test(document))
      throw new GithubError('Steerloom only sends read queries to GitHub.')
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      // Read-only, so a dropped or silent attempt is safe to try again.
      response = await fetchWithRetry(
        (attemptSignal) =>
          fetch(this.endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.token}`,
            },
            body: JSON.stringify({ query: document, variables }),
            dispatcher: this.dispatcher,
            signal: attemptSignal,
          }),
        { signal, retryDropped: true, attemptTimeoutMs: GITHUB_ATTEMPT_MS },
      )
    } catch (caught) {
      if (signal?.aborted || !isDropped(caught)) throw caught
      throw new GithubError(
        (caught as { name?: string }).name === 'TimeoutError'
          ? 'GitHub did not answer in time, three times. Check your VPN and reload to try again.'
          : 'GitHub could not be reached: the connection dropped three times. Reload to try again; if it keeps happening, the company proxy may be refusing it.',
      )
    }
    if (response.status === 401)
      throw new GithubError(
        'GitHub did not accept this token. Create a new one with read access to pull requests and connect again.',
        'github-token-rejected',
      )
    if (!response.ok)
      throw new GithubError(
        `GitHub answered ${response.status}. Check the address and try again.`,
      )
    onHeaders?.(response.headers as unknown as Headers)
    const text = await response.text()
    let body: {
      data?: T
      errors?: Array<{
        type?: string
        message?: string
        path?: Array<string | number>
      }>
    }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new GithubError(
        'This address answered with a web page instead of GitHub data. Check the GitHub address.',
      )
    }
    // A repository the token cannot see is "not found", not a failure; nor
    // are checks a token may not read: those pull requests have no checks.
    const errors = (body.errors ?? []).filter(
      (error) =>
        error.type !== 'NOT_FOUND' &&
        !error.path?.includes('statusCheckRollup'),
    )
    if (errors.length || !body.data)
      throw new GithubError(
        `GitHub refused the request: ${errors[0]?.message ?? 'no data'}`,
      )
    return body.data
  }
}

/** Scopes and expiry from GitHub's reply headers. */
export function tokenAccess(headers: Headers): GithubTokenAccess {
  const scopeHeader = headers.get('x-oauth-scopes')
  const scopes =
    scopeHeader === null
      ? undefined
      : scopeHeader
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean)
  // "2026-11-13 09:00:00 UTC" or "2026-11-13 09:00:00 +0100".
  const expiry = headers.get('github-authentication-token-expiration')
  const parsed = expiry
    ? Date.parse(
        expiry
          .trim()
          .replace(' ', 'T')
          .replace(/ UTC$/, 'Z')
          .replace(/ ([+-]\d\d)(\d\d)$/, '$1:$2'),
      )
    : NaN
  return {
    ...(scopes ? { scopes } : {}),
    ...(Number.isNaN(parsed)
      ? {}
      : { expiresAt: new Date(parsed).toISOString() }),
  }
}

/** github.com has its API on its own host; Enterprise Server under /api. */
export function graphqlEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:')
    throw new GithubError('Use the https:// address of GitHub.')
  const host = url.hostname.toLowerCase()
  if (host === 'github.com' || host === 'api.github.com')
    return 'https://api.github.com/graphql'
  return `${url.origin}/api/graphql`
}

function splitRepository(fullName: string): { owner: string; name: string } {
  const match = /^\s*([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/.exec(fullName)
  if (!match) throw new GithubError('Name the repository as owner/name.')
  return { owner: match[1]!, name: match[2]! }
}

function notVisible(fullName: string): GithubError {
  return new GithubError(
    `This token cannot see ${fullName}. Check the name, or ask an organization owner to approve the token.`,
    'github-repo-not-visible',
  )
}

function toRecord(
  repo: string,
  node: PullRequestNode,
): PullRequestRecord | undefined {
  if (!node.number || !node.url) return undefined
  const keys = pullRequestKeys(node.title ?? '', node.headRefName ?? '')
  if (!keys.length) return undefined
  const readyEvents = (node.timelineItems?.nodes ?? [])
    .map((event) => event?.createdAt)
    .filter((at): at is string => Boolean(at))
    .sort()
  // Opened as ready, or made ready later; a draft is not waiting for review.
  const readyAt = readyEvents[0] ?? (node.isDraft ? undefined : node.createdAt)
  const author = node.author?.login
  const reviews = (node.reviews?.nodes ?? []).filter(
    (review): review is { state: string; submittedAt: string } =>
      Boolean(
        review?.submittedAt &&
        review.state !== 'PENDING' &&
        (!author || review.author?.login !== author),
      ),
  )
  const firstReviewAt = reviews
    .map((review) => review.submittedAt)
    .filter((at) => !readyAt || at >= readyAt)
    .sort()[0]
  const approvedAt = reviews
    .filter((review) => review.state === 'APPROVED')
    .map((review) => review.submittedAt)
    .sort()
    .at(-1)
  const open = !node.mergedAt && !node.closedAt
  const checks = open
    ? checkResult(node.commits?.nodes?.at(-1)?.commit?.statusCheckRollup?.state)
    : undefined
  const size =
    typeof node.additions === 'number' && typeof node.deletions === 'number'
      ? node.additions + node.deletions
      : undefined
  return {
    repo,
    number: node.number,
    url: node.url,
    keys,
    changesRequested: reviews.filter(
      (review) => review.state === 'CHANGES_REQUESTED',
    ).length,
    comments: node.comments?.totalCount ?? 0,
    ...(node.updatedAt ? { lastActivityAt: node.updatedAt } : {}),
    ...(readyAt ? { readyAt } : {}),
    ...(firstReviewAt ? { firstReviewAt } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(node.mergedAt ? { mergedAt: node.mergedAt } : {}),
    ...(!node.mergedAt && node.closedAt ? { closedAt: node.closedAt } : {}),
    ...(size !== undefined ? { linesChanged: size } : {}),
    ...(typeof node.changedFiles === 'number'
      ? { filesChanged: node.changedFiles }
      : {}),
    ...(checks ? { checks } : {}),
  }
}

/** GitHub's combined status: failure and error fail, waiting runs. */
function checkResult(state?: string): PullRequestChecks | undefined {
  switch (state) {
    case 'SUCCESS':
      return 'passing'
    case 'FAILURE':
    case 'ERROR':
      return 'failing'
    case 'PENDING':
    case 'EXPECTED':
      return 'running'
    default:
      return undefined
  }
}
