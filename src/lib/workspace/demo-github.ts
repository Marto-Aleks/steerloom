import type { BranchRecord, PullRequestRecord } from '../data-source/github'
import type { FlowBoardSnapshot } from '../../types'

const DAY = 86_400_000

/**
 * A fictional code trail for the demo board, so the demo shows GitHub
 * without a token: pull requests for most finished items, and for the work
 * in progress one of each state, including two the board has not caught up
 * with. Built from the snapshot it belongs to, so the dates line up.
 */
export function demoCodeTrail(snapshot: FlowBoardSnapshot): {
  pullRequests: PullRequestRecord[]
  branches: BranchRecord[]
} {
  const now = Date.parse(snapshot.loadedAt)
  const iso = (time: number) => new Date(time).toISOString()
  const ago = (days: number) => iso(now - days * DAY)
  const entered = (issueId: string, statusId: string) =>
    snapshot.transitions.find(
      (transition) =>
        transition.issueId === issueId && transition.statusId === statusId,
    )?.enteredAt
  const record = (
    key: string,
    number: number,
    fields: Partial<PullRequestRecord>,
  ): PullRequestRecord => ({
    repo: 'acme/shop',
    number,
    url: `https://git.example.invalid/acme/shop/pull/${number}`,
    keys: [key],
    changesRequested: 0,
    ...fields,
  })
  // Review spans of the finished items: the slowest quarter were the large
  // changes, so the demo shows what size does to review time.
  const spans = snapshot.issues
    .map((issue) => {
      const review = entered(issue.id, 'stage-2')
      const done = entered(issue.id, 'stage-3')
      return review && done ? Date.parse(done) - Date.parse(review) : undefined
    })
    .filter((span): span is number => span !== undefined)
    .sort((a, b) => a - b)
  const largeFrom = spans[Math.floor(spans.length * 0.75)] ?? Infinity
  const finished = snapshot.issues.flatMap((issue, index) => {
    const review = entered(issue.id, 'stage-2')
    const done = entered(issue.id, 'stage-3')
    // About one in eight items had no linked pull request.
    if (!review || !done || index % 8 === 7) return []
    const start = Date.parse(review)
    const span = Date.parse(done) - start
    const large = span >= largeFrom
    return [
      record(issue.key, 100 + index, {
        readyAt: review,
        firstReviewAt: iso(start + span * 0.55),
        approvedAt: iso(start + span * 0.85),
        mergedAt: iso(start + span * 0.95),
        comments: 2 + (index % 4),
        linesChanged: large
          ? 480 + ((index * 137) % 900)
          : 40 + ((index * 53) % 300),
        filesChanged: large ? 12 + (index % 20) : 2 + (index % 7),
      }),
    ]
  })
  return {
    pullRequests: [
      ...finished,
      // Still coding: a draft pull request.
      record('DEMO-35', 201, {
        lastActivityAt: ago(2),
        linesChanged: 210,
        filesChanged: 6,
        checks: 'running',
      }),
      // Ready five days ago; nobody has looked. A large change.
      record('DEMO-34', 202, {
        readyAt: ago(5),
        lastActivityAt: ago(5),
        linesChanged: 920,
        filesChanged: 23,
        checks: 'passing',
      }),
      // Approved yesterday, not merged: its checks fail.
      record('DEMO-33', 203, {
        readyAt: ago(6),
        firstReviewAt: ago(3),
        approvedAt: ago(1),
        lastActivityAt: ago(1),
        comments: 4,
        linesChanged: 140,
        filesChanged: 4,
        checks: 'failing',
      }),
      // Merged, but the cards still say In progress.
      record('DEMO-31', 204, {
        readyAt: ago(8),
        firstReviewAt: ago(6),
        approvedAt: ago(5),
        mergedAt: ago(4),
      }),
      record('DEMO-30', 205, {
        readyAt: ago(7),
        firstReviewAt: ago(4),
        approvedAt: ago(3),
        mergedAt: ago(2),
      }),
    ],
    branches: [
      // The oldest item: a branch nobody has touched for twelve days.
      { repo: 'acme/shop', keys: ['DEMO-36'], lastCommitAt: ago(12) },
      { repo: 'acme/shop', keys: ['DEMO-35'], lastCommitAt: ago(2) },
      // Reopened, and being worked on today.
      { repo: 'acme/shop', keys: ['DEMO-32'], lastCommitAt: ago(0) },
    ],
  }
}
