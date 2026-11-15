/**
 * What Steerloom keeps of a pull request: when it moved through review and
 * which Jira items it names. Titles, descriptions, authors and reviewers are
 * never read into the browser, so nothing here can rank a person.
 */
export interface PullRequestRecord {
  /** "owner/name" */
  repo: string
  number: number
  url: string
  /** Item keys named in the title or branch, upper case. */
  keys: string[]
  /** When it was first ready for review; absent while it is still a draft. */
  readyAt?: string
  /** The first review anyone submitted after it was ready. */
  firstReviewAt?: string
  /** Reviews that asked for changes: rounds of rework. */
  changesRequested: number
  /** How many comments it has: a count only, never their text or authors. */
  comments?: number
  /** The last approval. */
  approvedAt?: string
  mergedAt?: string
  /** Closed without merging. */
  closedAt?: string
  /** The last change of any kind: a push, review, comment or label. */
  lastActivityAt?: string
  /** Lines added plus lines removed: the size of the change, never the code. */
  linesChanged?: number
  /** How many files the change touches. */
  filesChanged?: number
  /**
   * Open pull requests only: the combined result of the checks on the latest
   * commit (CI, required statuses). Absent when there are none or the token
   * may not read them.
   */
  checks?: PullRequestChecks
}

export type PullRequestChecks = 'passing' | 'failing' | 'running'

/**
 * A branch that names an item: which keys, and when its last commit was
 * made. The branch name itself is not kept.
 */
export interface BranchRecord {
  /** "owner/name" */
  repo: string
  keys: string[]
  lastCommitAt: string
}

const KEY = /\b[A-Za-z][A-Za-z0-9_]+-[1-9]\d*\b/g

/**
 * Item keys in a pull request's title or branch ("FLOW-131: fix login",
 * "feature/flow-131-login"). Branches are often lower case, so both are
 * read case-insensitively; the board decides later which keys are its own.
 */
export function pullRequestKeys(title: string, branch: string): string[] {
  const keys = new Set<string>()
  for (const text of [title, branch])
    for (const match of text.matchAll(KEY)) keys.add(match[0].toUpperCase())
  return [...keys]
}

/**
 * Why a pull request names no item key in its title or branch, checked in
 * this order: a bot opened it, the key is only in its description, only in
 * its commits, it names a bare number ("feature/1234-login", "#1234"), or
 * nothing at all. Counted when GitHub is connected, so a team sees what its
 * naming habit costs before a dashboard is empty.
 */
export type UnlinkedReason =
  | 'bot'
  | 'description'
  | 'commits'
  | 'number'
  | 'none'

/*
 * In free text only upper-case keys count, as people write them ("FLOW-12:
 * fix"), and common technical names that look like keys do not.
 */
const WRITTEN_KEY = /\b([A-Z][A-Z0-9_]{1,9})-[1-9]\d{0,6}\b/g
const NOT_KEYS = new Set(
  'AES BASE CVE CWE ECMA ES GPT HTTP IPV ISO MD PEP RFC RSA SHA SSL TLS UTF UUID WCAG COVID'.split(
    ' ',
  ),
)
const DATE = /\b(?:19|20)\d\d[-_.]\d{1,2}(?:[-_.]\d{1,2})?\b/g

function namesKey(text: string): boolean {
  for (const match of text.matchAll(WRITTEN_KEY))
    if (!NOT_KEYS.has(match[1]!)) return true
  return false
}

function namesNumber(title: string, branch: string): boolean {
  if (/(?:^|\W|\b[A-Z]{1,4})#\d{1,7}\b/.test(title)) return true
  if (/^\s*\[?\d{2,7}\]?[\s:-]/.test(title)) return true
  return branch
    .replace(DATE, '')
    .split(/[/_-]+/)
    .some((part) => /^\d{2,7}$/.test(part))
}

export function unlinkedReason(pull: {
  title: string
  branch: string
  description: string
  commits: string[]
  bot: boolean
}): UnlinkedReason {
  if (pull.bot) return 'bot'
  if (namesKey(pull.description)) return 'description'
  if (pull.commits.some(namesKey)) return 'commits'
  if (namesNumber(pull.title, pull.branch)) return 'number'
  return 'none'
}
