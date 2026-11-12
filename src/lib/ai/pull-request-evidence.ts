import type {
  BranchRecord,
  PullRequestChecks,
  PullRequestRecord,
} from '../data-source/github'
import {
  LARGE_PULL_REQUEST_LINES,
  sizeSplit,
  type CodeState,
  type CodeTrailEntry,
  type InsideReview,
} from '../statistics/pull-requests'

const DAY = 86_400_000
/** Items with their pull requests that one answer can reason over. */
export const PULL_REQUEST_ITEM_LIMIT = 30
/** Pull requests listed per item; more are counted, not listed. */
export const PULL_REQUESTS_PER_ITEM = 4
/** Items the get_code tool can look up: every item with code, up to this. */
export const CODE_LOOKUP_LIMIT = 200

export interface AiPullRequest {
  /** "acme/web#123" */
  ref: string
  state: 'draft' | 'open' | 'approved' | 'merged' | 'closed'
  readyDaysAgo?: number
  /** From ready to the first review by someone else. */
  firstReviewAfterDays?: number
  changesRequested: number
  approvedDaysAgo?: number
  mergedDaysAgo?: number
  lastActivityDaysAgo?: number
  /** How many comments it has; a count only. */
  comments?: number
  /** Lines added plus removed. */
  linesChanged?: number
  filesChanged?: number
  /** Open pull requests: the checks on the latest commit. */
  checks?: PullRequestChecks
}

export interface AiItemPullRequests {
  key: string
  /** The board's side: the stage now, or "finished" with its cycle time. */
  stage: string
  daysInStage?: number
  ageDays?: number
  cycleTimeDays?: number
  /** Finished items: when the card left the measured stages. */
  finishedDaysAgo?: number
  pullRequests: AiPullRequest[]
  /** Pull requests beyond the listed ones. */
  morePullRequests?: number
  /** Active items: the code trail read as one state. */
  code?: CodeState
  /** Days since the last commit on a branch that names the item. */
  branchLastCommitDaysAgo?: number
  /** Days since anything happened on the item's code, when a week or more. */
  codeQuietDays?: number
  /** The board and the code disagree about where this item is. */
  boardDisagrees?: boolean
}

/**
 * The code side of the board for Steerloom AI: per item, its pull requests'
 * timeline next to where the board says the item is, so an answer can tell
 * where the time went. Timing only; nothing names a person.
 */
export interface AiPullRequestEvidence {
  repositories: number
  /** Finished items in the period with a merged pull request, of all finished. */
  coverage: { linked: number; finished: number }
  /** A typical finished item's days inside Review, when enough are linked. */
  typicalInsideReview?: {
    waitingForFirstReviewDays: number
    reviewRoundsDays: number
    waitingToMergeDays: number
  }
  /**
   * Finished items split at a size threshold: typical days from ready to
   * merged for large and for small changes, when both sides are big enough.
   */
  sizeAndSpeed?: {
    largeOverLines: number
    large: { items: number; readyToMergedDays: number }
    small: { items: number; readyToMergedDays: number }
  }
  items: AiItemPullRequests[]
  /** Items with pull requests beyond the listed ones. */
  omittedItems: number
}

interface ActiveItem {
  item: string
  column: string
  ageInSelectedColumns: number
  currentStageAgeDays: number
}

export function buildPullRequestEvidence({
  pullRequests,
  branches = [],
  trail,
  repositories,
  active,
  delayedKeys,
  finished,
  inside,
  finishedCount,
  now,
  limit = PULL_REQUEST_ITEM_LIMIT,
}: {
  pullRequests: PullRequestRecord[]
  branches?: BranchRecord[]
  /** Each active item's code state, as the briefing shows it. */
  trail?: Map<string, CodeTrailEntry>
  repositories: number
  active: ActiveItem[]
  /** Late items first: they are what most questions are about. */
  delayedKeys: string[]
  /** Every item finished in the period. */
  finished: Array<{ item: string; cycleTime: number; cycleEnd: string }>
  inside?: InsideReview
  finishedCount: number
  now: Date
  /** How many items to list: the prompt's few, or the lookup's many. */
  limit?: number
}): AiPullRequestEvidence {
  const byKey = new Map<string, PullRequestRecord[]>()
  for (const record of pullRequests)
    for (const key of record.keys)
      byKey.set(key, [...(byKey.get(key) ?? []), record])
  const lastCommit = new Map<string, string>()
  for (const branch of branches)
    for (const key of branch.keys)
      if ((lastCommit.get(key) ?? '') < branch.lastCommitAt)
        lastCommit.set(key, branch.lastCommitAt)
  // Whole days from 10 up: "106 days", not "105.9".
  const ago = (at?: string) => {
    if (at === undefined) return undefined
    const value = Math.max(0, (now.getTime() - Date.parse(at)) / DAY)
    return value >= 10 ? Math.round(value) : round(value)
  }
  const describe = (record: PullRequestRecord): AiPullRequest => {
    const firstReviewAfter =
      record.readyAt && record.firstReviewAt
        ? round(
            (Date.parse(record.firstReviewAt) - Date.parse(record.readyAt)) /
              DAY,
          )
        : undefined
    return {
      ref: `${record.repo}#${record.number}`,
      state: record.mergedAt
        ? 'merged'
        : record.closedAt
          ? 'closed'
          : !record.readyAt
            ? 'draft'
            : record.approvedAt
              ? 'approved'
              : 'open',
      ...defined('readyDaysAgo', ago(record.readyAt)),
      ...defined('firstReviewAfterDays', firstReviewAfter),
      changesRequested: record.changesRequested,
      ...defined('approvedDaysAgo', ago(record.approvedAt)),
      ...defined('mergedDaysAgo', ago(record.mergedAt)),
      ...defined('lastActivityDaysAgo', ago(record.lastActivityAt)),
      ...defined('comments', record.comments || undefined),
      ...defined('linesChanged', record.linesChanged),
      ...defined('filesChanged', record.filesChanged),
      ...(record.checks && !record.mergedAt && !record.closedAt
        ? { checks: record.checks }
        : {}),
    }
  }
  const codeOf = (key: string) => {
    const entry = trail?.get(key)
    const branchDays = ago(lastCommit.get(key))
    const activity = [
      branchDays,
      ...(byKey.get(key) ?? [])
        .filter((record) => !record.mergedAt && !record.closedAt)
        .map((record) => ago(record.lastActivityAt)),
    ].filter((days): days is number => days !== undefined)
    const quiet = activity.length ? Math.min(...activity) : undefined
    return {
      ...(entry ? { code: entry.id } : {}),
      ...defined('branchLastCommitDaysAgo', branchDays),
      ...(entry?.tone === 'quiet' && quiet !== undefined
        ? { codeQuietDays: quiet }
        : {}),
      ...(entry?.mismatch ? { boardDisagrees: true } : {}),
    }
  }
  const listed = (key: string) => {
    const records = [...(byKey.get(key) ?? [])].sort((a, b) =>
      (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
    )
    return {
      pullRequests: records.slice(0, PULL_REQUESTS_PER_ITEM).map(describe),
      ...(records.length > PULL_REQUESTS_PER_ITEM
        ? { morePullRequests: records.length - PULL_REQUESTS_PER_ITEM }
        : {}),
    }
  }

  const delayed = new Set(delayedKeys)
  // Late items, then the rest of the active work oldest first: an item with
  // no pull request is evidence too, when it is late.
  const activeItems: AiItemPullRequests[] = [...active]
    .sort(
      (a, b) =>
        Number(delayed.has(b.item)) - Number(delayed.has(a.item)) ||
        b.ageInSelectedColumns - a.ageInSelectedColumns,
    )
    .filter(
      (item) =>
        byKey.has(item.item) ||
        lastCommit.has(item.item) ||
        delayed.has(item.item) ||
        trail?.get(item.item)?.mismatch,
    )
    .map((item) => ({
      key: item.item,
      stage: item.column,
      daysInStage: round(item.currentStageAgeDays),
      ageDays: round(item.ageInSelectedColumns),
      ...codeOf(item.item),
      ...listed(item.item),
    }))
  // Then the slowest finished items, to show what made them slow.
  const finishedItems: AiItemPullRequests[] = [...finished]
    .filter((item) => byKey.has(item.item))
    .sort((a, b) => b.cycleTime - a.cycleTime)
    .map((item) => ({
      key: item.item,
      stage: 'finished',
      cycleTimeDays: round(item.cycleTime),
      ...defined('finishedDaysAgo', ago(item.cycleEnd)),
      ...listed(item.item),
    }))
  const all = [...activeItems, ...finishedItems]
  const [waiting, rounds, merge] = inside?.parts ?? []
  const split = sizeSplit(finished, byKey)
  return {
    repositories,
    coverage: {
      linked: finished.filter((item) =>
        byKey.get(item.item)?.some((record) => record.mergedAt),
      ).length,
      finished: finishedCount,
    },
    ...(waiting && rounds && merge
      ? {
          typicalInsideReview: {
            waitingForFirstReviewDays: waiting.days,
            reviewRoundsDays: rounds.days,
            waitingToMergeDays: merge.days,
          },
        }
      : {}),
    ...(split
      ? {
          sizeAndSpeed: {
            largeOverLines: LARGE_PULL_REQUEST_LINES,
            large: {
              items: split.large.items,
              readyToMergedDays: split.large.days,
            },
            small: {
              items: split.small.items,
              readyToMergedDays: split.small.days,
            },
          },
        }
      : {}),
    items: all.slice(0, limit),
    omittedItems: Math.max(0, all.length - limit),
  }
}

const round = (value: number) => Math.round(value * 10) / 10
function defined<K extends string>(
  key: K,
  value: number | undefined,
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>)
}
