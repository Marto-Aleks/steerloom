import type { BranchRecord, PullRequestRecord } from '../data-source/github'
import type { CycleTimePoint, WorkInProgressAgePoint } from '../../types'
import type { FocusSignal } from './focus-now'
import { median } from './index'

const DAY = 86_400_000
/** Below this many finished items with a pull request, no split is shown. */
const MINIMUM_LINKED = 5
/** Under this share of finished items linked, the split is a rough guide. */
export const FULL_COVERAGE = 0.8
/** A first review this slow, taking this share of Review, is the real queue. */
const SLOW_FIRST_REVIEW_DAYS = 1
const FIRST_REVIEW_SHARE = 0.4
/** Merged this long ago and still on the board: the card did not move. */
const MERGED_STALE_DAYS = 1
const MERGED_MINIMUM = 2
/** No push, review or comment for this long: the pull request has stalled. */
const QUIET_DAYS = 7
/** Approved this long ago and not merged: finished work nobody ships. */
const APPROVED_WAIT_DAYS = 2
const APPROVED_MINIMUM = 2
/** Approved longer ago than this and still open: abandoned, not waiting. */
const APPROVED_ABANDONED_DAYS = 30
/** Open, ready pull requests with failing checks before the signal fires. */
const FAILING_MINIMUM = 2
/** Lines added plus removed above which a pull request counts as large. */
export const LARGE_PULL_REQUEST_LINES = 400
/** Finished items needed on each side before sizes are compared. */
const SIZE_GROUP_MINIMUM = 4
/** Large pull requests must take this many times longer, and a day more. */
const SIZE_RATIO = 2
const SIZE_GAP_DAYS = 1

export interface ReviewPart {
  label: string
  days: number
  /** Waiting, not work: drawn in the problem colour. */
  waiting?: boolean
}

export interface InsideReview {
  parts: ReviewPart[]
  /** A typical linked item's whole cycle time on the board, in days. */
  cycleDays: number
  /** Of that, a typical linked item's time from ready to merged. */
  pullRequestDays: number
  linked: number
  total: number
}

/** A short label for the status line and the full sentence behind it. */
export interface PullRequestState {
  short: string
  full: string
}

/**
 * An item's code state: branch, commits, pull request, review and merge read
 * as one trail, in one vocabulary.
 */
export type CodeState = 'nocode' | 'coding' | 'review' | 'approved' | 'merged'

/** Where an item's board stage sits against the review stage. */
export type StagePosition = 'early' | 'review' | 'late'

export interface CodeTrailEntry {
  id: CodeState
  /** One sentence for the item's line in the open group. */
  detail: string
  /** Moving, quiet for a week or more, or waiting for a first look. */
  tone?: 'alive' | 'quiet' | 'waiting'
  /** The board says one thing, the code another. */
  mismatch?: boolean
}

export interface PullRequestInsight {
  /**
   * Active item key → what its pull request adds to the board, such as
   * "no review yet, ready 6 days ago". Absent when the pull request is moving
   * and the board already tells the story.
   */
  states: Map<string, PullRequestState>
  inside?: InsideReview
  /** Every active item's code state, including items with no code. */
  groups: Map<string, CodeTrailEntry>
  signals: FocusSignal[]
}

const days = (from: string, to: string | number) =>
  ((typeof to === 'number' ? to : Date.parse(to)) - Date.parse(from)) / DAY
const round = (value: number) => Math.round(value * 10) / 10
const count = (value: number, word: string) =>
  `${value} ${word}${value === 1 ? '' : 's'}`
const ago = (value: number) =>
  value < 1 ? 'today' : `${count(Math.floor(value), 'day')}`
const lines = (value: number) => `${value.toLocaleString('en-US')} lines`

/** What the latest checks and the size add to an open pull request's line. */
function changeNotes(pr: PullRequestRecord | undefined): string {
  const notes = [
    ...(pr?.checks === 'failing'
      ? ['the checks on its latest commit fail']
      : []),
    ...((pr?.linesChanged ?? 0) >= LARGE_PULL_REQUEST_LINES
      ? [
          `it changes ${lines(pr!.linesChanged!)}${pr!.filesChanged ? ` in ${count(pr!.filesChanged, 'file')}` : ''}`,
        ]
      : []),
  ]
  if (!notes.length) return ''
  const text = notes.join(', and ')
  return ` ${text[0]!.toUpperCase()}${text.slice(1)}.`
}

/** Large and small finished changes: how long each took from ready to merged. */
export interface SizeSplit {
  large: { items: number; days: number }
  small: { items: number; days: number }
}

/**
 * Finished items split by the size of their merged pull requests, with the
 * typical time from ready to merged on each side. Absent while either side
 * is too small to compare.
 */
export function sizeSplit(
  finished: Array<{ item: string }>,
  byKey: Map<string, PullRequestRecord[]>,
): SizeSplit | undefined {
  const large: number[] = []
  const small: number[] = []
  for (const { item } of finished) {
    const done = (byKey.get(item) ?? []).filter(
      (pr) => pr.mergedAt && pr.readyAt && pr.linesChanged !== undefined,
    )
    if (!done.length) continue
    const size = done.reduce((sum, pr) => sum + pr.linesChanged!, 0)
    const ready = done.map((pr) => pr.readyAt!).sort()[0]!
    const merged = done
      .map((pr) => pr.mergedAt!)
      .sort()
      .at(-1)!
    ;(size > LARGE_PULL_REQUEST_LINES ? large : small).push(
      Math.max(0, days(ready, merged)),
    )
  }
  if (large.length < SIZE_GROUP_MINIMUM || small.length < SIZE_GROUP_MINIMUM)
    return undefined
  return {
    large: { items: large.length, days: round(median(large)) },
    small: { items: small.length, days: round(median(small)) },
  }
}

/**
 * What pull requests add to the briefing, from timing only: where each active
 * item's pull request stands, how a typical finished item's time inside
 * Review splits, and two signals that fire only when they matter. Never per
 * person: nothing here knows who wrote or reviewed the code.
 */
export function pullRequestInsight({
  pullRequests,
  branches = [],
  active,
  finished,
  now,
  stageOf = () => undefined,
}: {
  pullRequests: PullRequestRecord[]
  branches?: BranchRecord[]
  active: WorkInProgressAgePoint[]
  finished: CycleTimePoint[]
  now: Date
  /** Where an active item's stage sits against the review stage, if known. */
  stageOf?: (item: string) => StagePosition | undefined
}): PullRequestInsight {
  const lastCommit = new Map<string, string>()
  for (const branch of branches)
    for (const key of branch.keys)
      if ((lastCommit.get(key) ?? '') < branch.lastCommitAt)
        lastCommit.set(key, branch.lastCommitAt)
  const byKey = new Map<string, PullRequestRecord[]>()
  for (const record of pullRequests)
    for (const key of record.keys)
      byKey.set(key, [...(byKey.get(key) ?? []), record])
  const nowMs = now.getTime()

  const inside = insideReview(finished, byKey)
  const linkedShare = inside ? inside.linked / inside.total : 0

  const states = new Map<string, PullRequestState>()
  const say = (item: string, short: string, full: string) =>
    states.set(item, { short, full })
  const d = (value: number) => `${Math.max(1, Math.floor(value))}d`
  const groups = new Map<string, CodeTrailEntry>()
  const waiting: Array<{ item: string; days: number }> = []
  const merged: Array<{ item: string; days: number }> = []
  const approved: Array<{ item: string; days: number }> = []
  const failing: Array<{ item: string; approved: boolean }> = []
  const latest = (...dates: Array<string | undefined>) =>
    dates
      .filter((at): at is string => !!at)
      .sort()
      .at(-1)
  const comments = (value = 0) => (value ? `${count(value, 'comment')}, ` : '')

  for (const { item } of active) {
    const records = (byKey.get(item) ?? []).filter((pr) => !pr.closedAt)
    const open = records
      .filter((pr) => !pr.mergedAt)
      .sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''))[0]
    const mergedAt = latest(...records.map((pr) => pr.mergedAt))
    const branchAt = lastCommit.get(item)
    const position = stageOf(item)
    const activity = latest(open?.lastActivityAt, open?.readyAt, branchAt)
    const quiet = activity ? days(activity, nowMs) : 0
    const quietNote = quiet >= QUIET_DAYS ? `quiet ${d(quiet)}` : ''
    // Untouched for a month: abandoned, not blocked by its build.
    const abandoned = quiet > APPROVED_ABANDONED_DAYS

    if (open && !open.readyAt) {
      // A draft pull request is still coding.
      const mismatch = position === 'review' || position === 'late'
      const tone = quietNote ? 'quiet' : 'alive'
      const full = `Coding: the pull request is still a draft; last change ${ago(quiet)}${quiet < 1 ? '' : ' ago'}.${changeNotes(open)}`
      groups.set(item, { id: 'coding', detail: full, tone, mismatch })
      if (quietNote) say(item, `coding, ${quietNote}`, full)
      else if (mismatch) say(item, 'still coding', full)
    } else if (open && !open.firstReviewAt) {
      const wait = days(open.readyAt!, nowMs)
      waiting.push({ item, days: wait })
      const full = `${
        wait < 1
          ? 'Ready for review since today.'
          : `No first look yet: the pull request has been ready for ${ago(wait)}.`
      }${changeNotes(open)}`
      groups.set(item, {
        id: 'review',
        detail: full,
        tone: wait >= 1 ? 'waiting' : 'alive',
      })
      if (open.checks === 'failing' && !abandoned)
        failing.push({ item, approved: false })
      if (wait >= 1)
        say(
          item,
          `no first look · ${d(wait)}${open.checks === 'failing' ? ' · checks fail' : ''}`,
          full,
        )
      else if (open.checks === 'failing') say(item, 'checks fail', full)
    } else if (open?.approvedAt && open.approvedAt >= open.firstReviewAt!) {
      const since = days(open.approvedAt, nowMs)
      const full = `${
        since < 1
          ? 'Approved today, not merged yet.'
          : `Approved ${ago(since)} ago, not merged yet.`
      }${changeNotes(open)}`
      groups.set(item, {
        id: 'approved',
        detail: full,
        tone: since >= QUIET_DAYS ? 'quiet' : 'alive',
        mismatch: position === 'early',
      })
      if (open.checks === 'failing') {
        if (!abandoned) failing.push({ item, approved: true })
        say(item, `approved, checks fail`, full)
      } else {
        if (since >= APPROVED_WAIT_DAYS && since <= APPROVED_ABANDONED_DAYS)
          approved.push({ item, days: since })
        if (since >= 1) say(item, `approved ${d(since)}, not merged`, full)
      }
    } else if (open) {
      const asked = open.changesRequested ? ', changes requested' : ''
      const full = `${
        quietNote
          ? `In review${asked}, ${comments(open.comments)}nothing for ${ago(quiet)}.`
          : `In review${asked}, ${comments(open.comments)}last change ${quiet < 1 ? 'today' : `${ago(quiet)} ago`}.`
      }${changeNotes(open)}`
      groups.set(item, {
        id: 'review',
        detail: full,
        tone: quietNote ? 'quiet' : 'alive',
      })
      if (open.checks === 'failing' && !abandoned)
        failing.push({ item, approved: false })
      if (quietNote)
        say(
          item,
          `in review, ${quietNote}${open.changesRequested ? ' · changes asked' : ''}`,
          full,
        )
      else if (open.checks === 'failing')
        say(item, 'in review · checks fail', full)
    } else if (mergedAt) {
      const since = days(mergedAt, nowMs)
      const mismatch =
        since >= 1 && (position === 'early' || position === 'review')
      const full =
        since < 1
          ? 'The code was merged today.'
          : `The code was merged ${ago(since)} ago${mismatch ? '; the card has not moved past review' : ''}.`
      groups.set(item, { id: 'merged', detail: full, mismatch })
      if (mismatch) {
        merged.push({ item, days: since })
        say(item, `merged ${d(since)} ago`, full)
      }
    } else if (branchAt) {
      const mismatch = position === 'review' || position === 'late'
      const full = `Coding: a branch exists; last commit ${quiet < 1 ? 'today' : `${ago(quiet)} ago`}.`
      groups.set(item, {
        id: 'coding',
        detail: full,
        tone: quietNote ? 'quiet' : 'alive',
        mismatch,
      })
      if (quietNote) say(item, `coding, ${quietNote}`, full)
      else if (mismatch) say(item, 'still coding', full)
    } else {
      const mismatch = position === 'review' || position === 'late'
      const full = mismatch
        ? 'No linked code: no branch or pull request names this item, though the board is past coding.'
        : 'No linked code: no branch or pull request names this item.'
      groups.set(item, { id: 'nocode', detail: full, mismatch })
      if (mismatch || linkedShare >= 0.5) say(item, 'no linked code', full)
    }
  }

  const signals: FocusSignal[] = []
  const firstLook = inside?.parts[0]
  const insideTotal = inside?.parts.reduce((sum, part) => sum + part.days, 0)
  if (
    firstLook &&
    insideTotal &&
    firstLook.days >= SLOW_FIRST_REVIEW_DAYS &&
    firstLook.days / insideTotal >= FIRST_REVIEW_SHARE
  ) {
    const oldest = [...waiting].sort((a, b) => b.days - a.days)[0]
    signals.push({
      id: 'review-wait',
      severity: 'warning',
      title: `Pull requests wait ${round(firstLook.days)} days for a first review`,
      evidence: `${Math.round((firstLook.days / insideTotal) * 100)}% of the time inside Review passes before anyone looks at the code.${
        !oldest
          ? ''
          : waiting.length === 1
            ? ` ${oldest.item} has waited ${ago(oldest.days)} with no review yet.`
            : ` ${waiting.length} open pull requests have no review yet; the oldest, ${oldest.item}, has waited ${ago(oldest.days)}.`
      }`,
      ...(waiting.length
        ? { meta: `${count(waiting.length, 'pull request')} without a review` }
        : {}),
      action:
        'Agree a first look within one working day, before starting new work.',
    })
  }
  const stale = merged.filter((entry) => entry.days >= MERGED_STALE_DAYS)
  if (stale.length >= MERGED_MINIMUM) {
    const spans = stale.map((entry) => Math.floor(entry.days))
    const low = Math.min(...spans)
    const high = Math.max(...spans)
    const keys = stale.map((entry) => entry.item)
    signals.push({
      id: 'merged-not-done',
      severity: 'info',
      title: `${stale.length} items are merged but not Done`,
      evidence: `Their code was merged ${low === high ? count(low, 'day') : `${low} to ${high} days`} ago, but the cards are still in progress. Either testing happens after the merge, or the cards were not moved.`,
      meta:
        keys.length > 3
          ? `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`
          : keys.join(', '),
      action:
        'Move what is finished, or make testing after the merge its own step.',
    })
  }
  const failingApproved = failing.filter((entry) => entry.approved)
  if (failing.length >= FAILING_MINIMUM || failingApproved.length) {
    const keys = failing.map((entry) => entry.item)
    const held = failingApproved.map((entry) => entry.item)
    signals.push({
      id: 'checks-failing',
      severity: 'warning',
      title:
        failing.length === 1
          ? `An approved pull request is held by failing checks`
          : `${failing.length} pull requests have failing checks`,
      evidence: `${listKeys(keys)}: the checks on ${
        failing.length === 1
          ? 'its latest commit fail'
          : 'their latest commits fail'
      }.${
        held.length === 0
          ? ' Reviews on a red build often have to be repeated.'
          : held.length === failing.length
            ? ` ${held.length === 1 ? 'It is' : 'They are'} already approved, so only the checks stand between ${held.length === 1 ? 'it' : 'them'} and the merge.`
            : ` ${listKeys(held)} ${held.length === 1 ? 'is' : 'are'} already approved, so only the checks stand in the way.`
      }`,
      meta: shortList(keys),
      action:
        'Fix or rerun the failing checks before more review or new work; a red build blocks the merge.',
    })
  }
  if (approved.length >= APPROVED_MINIMUM) {
    const spans = approved.map((entry) => Math.floor(entry.days))
    const low = Math.min(...spans)
    const high = Math.max(...spans)
    const keys = approved.map((entry) => entry.item)
    signals.push({
      id: 'approved-not-merged',
      severity: 'warning',
      title: `${approved.length} approved pull requests wait to be merged`,
      evidence: `${listKeys(keys)} ${approved.length === 2 ? 'were' : 'were all'} approved ${low === high ? `${count(low, 'day')}` : `${low} to ${high} days`} ago and their checks do not fail, yet nobody merged them. The work is done; it just does not ship.`,
      meta: shortList(keys),
      action:
        'Merge approved work first each morning, or agree who merges once a pull request is approved.',
    })
  }
  const split = sizeSplit(finished, byKey)
  if (
    split &&
    split.small.days > 0 &&
    split.large.days >= split.small.days * SIZE_RATIO &&
    split.large.days - split.small.days >= SIZE_GAP_DAYS
  ) {
    const ratio = round(split.large.days / split.small.days)
    const openLarge = active
      .map(({ item }) =>
        (byKey.get(item) ?? []).find(
          (pr) =>
            !pr.mergedAt &&
            !pr.closedAt &&
            (pr.linesChanged ?? 0) > LARGE_PULL_REQUEST_LINES,
        ),
      )
      .filter((pr): pr is PullRequestRecord => Boolean(pr))
    signals.push({
      id: 'large-pull-requests',
      severity: 'info',
      title: `Large pull requests take ${ratio}× longer to merge`,
      evidence: `Finished work with more than ${lines(LARGE_PULL_REQUEST_LINES)} changed took ${split.large.days} days from ready to merged, against ${split.small.days} days for smaller changes (${count(split.large.items, 'item')} against ${split.small.items}).${
        openLarge.length
          ? ` Open now: ${openLarge
              .slice(0, 3)
              .map((pr) => `${pr.keys[0]} (${lines(pr.linesChanged!)})`)
              .join(', ')}.`
          : ''
      }`,
      ...(openLarge.length
        ? {
            meta: `${count(openLarge.length, 'large pull request')} open`,
          }
        : {}),
      action: `Split work into smaller pull requests, under about ${LARGE_PULL_REQUEST_LINES} changed lines each.`,
    })
  }
  return { states, groups, ...(inside ? { inside } : {}), signals }
}

/** "A-1", "A-1 and A-2", "A-1, A-2 and A-3", then "and N more". */
function listKeys(keys: string[]): string {
  if (keys.length <= 1) return keys.join('')
  if (keys.length > 4)
    return `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`
  return `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`
}

function shortList(keys: string[]): string {
  return keys.length > 3
    ? `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`
    : keys.join(', ')
}

/** The typical finished item's time from ready to merged, in three parts. */
function insideReview(
  finished: CycleTimePoint[],
  byKey: Map<string, PullRequestRecord[]>,
): InsideReview | undefined {
  const firstLook: number[] = []
  const rounds: number[] = []
  const toMerge: number[] = []
  const whole: number[] = []
  const cycles: number[] = []
  for (const { item, cycleTime } of finished) {
    const done = (byKey.get(item) ?? []).filter(
      (pr) => pr.mergedAt && pr.readyAt,
    )
    if (!done.length) continue
    const ready = done.map((pr) => pr.readyAt!).sort()[0]!
    const mergedAt = done
      .map((pr) => pr.mergedAt!)
      .sort()
      .at(-1)!
    const first =
      done
        .map((pr) => pr.firstReviewAt)
        .filter((at): at is string => !!at)
        .sort()[0] ?? mergedAt
    const approved =
      done
        .map((pr) => pr.approvedAt)
        .filter((at): at is string => !!at && at >= first && at <= mergedAt)
        .sort()
        .at(-1) ?? mergedAt
    whole.push(Math.max(0, days(ready, mergedAt)))
    cycles.push(cycleTime)
    firstLook.push(Math.max(0, days(ready, first)))
    rounds.push(Math.max(0, days(first, approved)))
    toMerge.push(Math.max(0, days(approved, mergedAt)))
  }
  if (firstLook.length < MINIMUM_LINKED) return undefined
  return {
    parts: [
      {
        label: 'Waiting for a first review',
        days: round(median(firstLook)),
        waiting: true,
      },
      { label: 'Review rounds', days: round(median(rounds)) },
      { label: 'Approved, waiting to merge', days: round(median(toMerge)) },
    ],
    cycleDays: round(median(cycles)),
    pullRequestDays: round(median(whole)),
    linked: firstLook.length,
    total: finished.length,
  }
}
