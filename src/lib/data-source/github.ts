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
