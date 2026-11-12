import type {
  AiItemPullRequests,
  AiPullRequest,
  AiPullRequestEvidence,
} from '../../../src/lib/ai/pull-request-evidence'
import type { AiJiraIssueEvidence } from '../../../src/lib/ai/jira-evidence'
import type { AiReportContext } from '../../../src/lib/ai/report-context'
import type { BoardReader, BoardSearch } from '../board-reader'

/*
 * A fictional board for testing Steerloom AI's reasoning. Every late item has
 * one planted cause, readable only from its comments, history, links or code
 * trail, so a good answer has to read before it explains. People and items
 * are invented; nothing here comes from a real board.
 */

export const EVAL_NOW = Date.parse('2026-11-08T09:00:00Z')
const DAY = 86_400_000
const at = (daysAgo: number) => new Date(EVAL_NOW - daysAgo * DAY).toISOString()

const move = (daysAgo: number, from: string, to: string, by = 'Board') => ({
  changedAt: at(daysAgo),
  changedBy: by,
  field: 'status',
  fromValue: from,
  toValue: to,
})

const comment = (daysAgo: number, author: string, body: string) => ({
  author,
  createdAt: at(daysAgo),
  body,
})

const base = (
  key: string,
  summary: string,
  status: string,
  assignee: string,
  updatedDaysAgo: number,
): AiJiraIssueEvidence => ({
  key,
  summary,
  issueType: 'Story',
  status,
  statusCategory: 'In Progress',
  priority: 'Medium',
  assignee,
  components: ['Web shop'],
  updatedAt: at(updatedDaysAgo),
})

/** The items, in full detail. Overview reads see fewer fields. */
export const EVAL_ITEMS: AiJiraIssueEvidence[] = [
  {
    // Rework that went quiet: reopened, changes requested, nothing since.
    ...base(
      'EVAL-101',
      'Checkout: retry failed payments once',
      'Code Review',
      'Ana Ruiz',
      16,
    ),
    createdAt: at(52),
    history: [
      move(48, 'To Do', 'In Progress'),
      move(40, 'In Progress', 'Code Review'),
      move(31, 'Code Review', 'Done'),
      move(30, 'Done', 'Code Review', 'Fictional QA'),
    ],
    comments: [
      comment(
        30,
        'Fictional QA',
        'Reopened: the retry fires twice on a timeout.',
      ),
      comment(
        16,
        'Fictional Reviewer',
        'Requested changes on the pull request: handle the timeout case before retrying.',
      ),
    ],
  },
  {
    // Blocked by another team's work.
    ...base(
      'EVAL-102',
      'Show delivery estimate on the product page',
      'In Progress',
      'Ben Okafor',
      8,
    ),
    createdAt: at(30),
    history: [move(27, 'To Do', 'In Progress')],
    links: [
      {
        direction: 'inward',
        relationship: 'is blocked by',
        key: 'EVAL-150',
        summary: 'Delivery estimate API (Logistics team)',
        issueType: 'Story',
        status: 'To Do',
      },
    ],
    comments: [
      comment(
        20,
        'Ben Okafor',
        'Cannot finish until the logistics API returns the estimate; asked their team for a date.',
      ),
      comment(8, 'Ben Okafor', 'Still no date from Logistics.'),
    ],
  },
  {
    // Ready for review nine days ago; nobody has looked.
    ...base(
      'EVAL-103',
      'Search results ignore the colour filter',
      'Code Review',
      'Chen Li',
      9,
    ),
    createdAt: at(25),
    history: [
      move(23, 'To Do', 'In Progress'),
      move(9, 'In Progress', 'Code Review'),
    ],
  },
  {
    // Approved, waiting for a release window to merge.
    ...base(
      'EVAL-104',
      'Save basket between sessions',
      'Code Review',
      'Dara Novak',
      6,
    ),
    createdAt: at(27),
    history: [
      move(25, 'To Do', 'In Progress'),
      move(12, 'In Progress', 'Code Review'),
    ],
    comments: [
      comment(
        6,
        'Dara Novak',
        'Approved. Holding the merge for the next release window.',
      ),
    ],
  },
  {
    // The board says Code Review, but no code names the item.
    ...base(
      'EVAL-105',
      'Promo code box accepts spaces and then fails',
      'Code Review',
      'Ben Okafor',
      11,
    ),
    createdAt: at(24),
    history: [
      move(22, 'To Do', 'In Progress'),
      move(11, 'In Progress', 'Code Review'),
    ],
  },
  {
    // Merged five days ago; the card never moved.
    ...base(
      'EVAL-106',
      'Receipt PDF is missing the VAT line',
      'In Progress',
      'Chen Li',
      24,
    ),
    createdAt: at(26),
    history: [move(24, 'To Do', 'In Progress')],
  },
  {
    // Scope keeps growing: too big to finish as one item.
    ...base(
      'EVAL-107',
      'Let customers pick a delivery day',
      'In Progress',
      'Ana Ruiz',
      1,
    ),
    createdAt: at(38),
    description:
      'Customers choose a delivery day at checkout. Acceptance: 1) weekdays for the next 14 days; 2) cut-off at 14:00; 3) price per day; 4) unavailable days greyed out; 5) works on mobile; 6) shown on the receipt; 7) shown on the tracking page; 8) weekend slots; 9) bank holiday rules.',
    history: [move(34, 'To Do', 'In Progress')],
    subtasks: [
      {
        key: 'EVAL-171',
        summary: 'Day picker UI',
        status: 'Done',
        issueType: 'Sub-task',
      },
      {
        key: 'EVAL-172',
        summary: 'Cut-off logic',
        status: 'Done',
        issueType: 'Sub-task',
      },
      {
        key: 'EVAL-173',
        summary: 'Weekend slots',
        status: 'In Progress',
        issueType: 'Sub-task',
      },
      {
        key: 'EVAL-174',
        summary: 'Bank holiday rules',
        status: 'To Do',
        issueType: 'Sub-task',
      },
      {
        key: 'EVAL-175',
        summary: 'Tracking page',
        status: 'To Do',
        issueType: 'Sub-task',
      },
    ],
    comments: [
      comment(
        25,
        'Fictional Product Owner',
        'Adding weekend slots to this story too.',
      ),
      comment(
        12,
        'Fictional Product Owner',
        'Please also include the bank holiday rules here.',
      ),
    ],
  },
  {
    // Also waiting for a first look: review is a queue.
    ...base(
      'EVAL-108',
      'Mobile menu overlaps the cookie banner',
      'Code Review',
      'Dara Novak',
      7,
    ),
    createdAt: at(24),
    history: [
      move(22, 'To Do', 'In Progress'),
      move(7, 'In Progress', 'Code Review'),
    ],
  },
  {
    // Nothing to go on: an honest answer says so.
    ...base(
      'EVAL-109',
      'Image zoom stuck on the first photo',
      'In Progress',
      'Chen Li',
      26,
    ),
    createdAt: at(28),
    history: [move(26, 'To Do', 'In Progress')],
  },
  {
    // Healthy, recently started.
    ...base(
      'EVAL-110',
      'Add size guide to clothing items',
      'In Progress',
      'Ben Okafor',
      0,
    ),
    createdAt: at(4),
    history: [move(2, 'To Do', 'In Progress')],
  },
]

const pr = (ref: string, fields: Partial<AiPullRequest>): AiPullRequest => ({
  ref: `acme/web#${ref}`,
  state: 'open',
  changesRequested: 0,
  ...fields,
})

/** What GitHub says per item: the code trail behind get_code. */
export const EVAL_CODE: AiItemPullRequests[] = [
  {
    key: 'EVAL-101',
    stage: 'Code Review',
    daysInStage: 40,
    ageDays: 48,
    code: 'review',
    codeQuietDays: 16,
    pullRequests: [
      pr('301', {
        readyDaysAgo: 41,
        firstReviewAfterDays: 0.2,
        changesRequested: 2,
        lastActivityDaysAgo: 16,
        comments: 6,
      }),
    ],
  },
  {
    key: 'EVAL-102',
    stage: 'In Progress',
    daysInStage: 27,
    ageDays: 27,
    code: 'coding',
    branchLastCommitDaysAgo: 19,
    codeQuietDays: 19,
    pullRequests: [],
  },
  {
    key: 'EVAL-103',
    stage: 'Code Review',
    daysInStage: 9,
    ageDays: 23,
    code: 'review',
    codeQuietDays: 9,
    pullRequests: [
      pr('310', { readyDaysAgo: 9, lastActivityDaysAgo: 9, comments: 0 }),
    ],
  },
  {
    key: 'EVAL-104',
    stage: 'Code Review',
    daysInStage: 12,
    ageDays: 25,
    code: 'approved',
    pullRequests: [
      pr('305', {
        state: 'approved',
        readyDaysAgo: 12,
        firstReviewAfterDays: 1,
        approvedDaysAgo: 6,
        lastActivityDaysAgo: 6,
        comments: 3,
      }),
    ],
  },
  {
    key: 'EVAL-105',
    stage: 'Code Review',
    daysInStage: 11,
    ageDays: 22,
    code: 'nocode',
    boardDisagrees: true,
    pullRequests: [],
  },
  {
    key: 'EVAL-106',
    stage: 'In Progress',
    daysInStage: 24,
    ageDays: 24,
    code: 'merged',
    boardDisagrees: true,
    pullRequests: [
      pr('298', {
        state: 'merged',
        readyDaysAgo: 9,
        firstReviewAfterDays: 1,
        approvedDaysAgo: 6,
        mergedDaysAgo: 5,
        lastActivityDaysAgo: 5,
        comments: 2,
      }),
    ],
  },
  {
    key: 'EVAL-107',
    stage: 'In Progress',
    daysInStage: 34,
    ageDays: 34,
    code: 'coding',
    branchLastCommitDaysAgo: 1,
    pullRequests: [],
  },
  {
    key: 'EVAL-108',
    stage: 'Code Review',
    daysInStage: 7,
    ageDays: 22,
    code: 'review',
    codeQuietDays: 7,
    pullRequests: [
      pr('312', { readyDaysAgo: 7, lastActivityDaysAgo: 7, comments: 0 }),
    ],
  },
  {
    key: 'EVAL-109',
    stage: 'In Progress',
    daysInStage: 26,
    ageDays: 26,
    code: 'nocode',
    pullRequests: [],
  },
  {
    key: 'EVAL-110',
    stage: 'In Progress',
    daysInStage: 2,
    ageDays: 2,
    code: 'coding',
    branchLastCommitDaysAgo: 0,
    pullRequests: [],
  },
]

const LIMIT_DAYS = 21
const active = EVAL_CODE.map((entry) => ({
  key: entry.key,
  stage: entry.stage,
  ageDays: entry.ageDays ?? 0,
  daysInStage: entry.daysInStage ?? 0,
}))

const pullRequests: AiPullRequestEvidence = {
  repositories: 1,
  coverage: { linked: 19, finished: 24 },
  typicalInsideReview: {
    waitingForFirstReviewDays: 1,
    reviewRoundsDays: 1.5,
    waitingToMergeDays: 0.5,
  },
  items: EVAL_CODE.filter((entry) => entry.pullRequests.length),
  omittedItems: 0,
}

/** The briefing the AI sees, as Steerloom would build it for this board. */
export const EVAL_CONTEXT: AiReportContext = {
  generatedAt: new Date(EVAL_NOW).toISOString(),
  sourceLabel: 'EVAL · Fictional test board',
  boardName: 'Fictional test board',
  scope: {
    selectedColumns: ['In Progress', 'Code Review'],
    ticketTypes: ['Story'],
    windowDays: 90,
  },
  headline: {
    completedObservations: 24,
    medianCycleTimeDays: 9,
    percentile85CycleTimeDays: LIMIT_DAYS,
    exitThroughputPerWeek: 1.9,
  },
  ticketGroupTotals: {
    completedOutliers: 0,
    delayedWorkInProgress: active.filter((item) => item.ageDays > LIMIT_DAYS)
      .length,
    reenteredWorkInProgress: 1,
  },
  focusSignals: [
    {
      severity: 'critical',
      title: '9 items past the usual 21 days',
      evidence: 'Oldest: EVAL-101, 48 days in progress, 2.3× the usual.',
      suggestedTeamPrompt:
        'Review the delayed items and agree what to unblock first.',
    },
  ],
  weeklyThroughput: [],
  cycleTimeDistribution: [],
  weeklyCycleTimeTrend: [],
  delayedWorkInProgress: active
    .filter((item) => item.ageDays > LIMIT_DAYS)
    .map((item) => ({
      key: item.key,
      status: item.stage,
      ageDays: item.ageDays,
    })),
  completedOutliers: [],
  reenteredWorkInProgress: [{ key: 'EVAL-101', status: 'Code Review' }],
  workInProgressByStage: ['In Progress', 'Code Review'].map((stage) => {
    const items = active
      .filter((item) => item.stage === stage)
      .sort((a, b) => b.daysInStage - a.daysInStage)
    return {
      stage,
      count: items.length,
      items: items.map(({ key, ageDays, daysInStage }) => ({
        key,
        ageDays,
        daysInStage,
      })),
    }
  }),
  pullRequests,
  codeLookup: EVAL_CODE,
}

/** An overview read: status and people, no text or history. */
function overview(item: AiJiraIssueEvidence): AiJiraIssueEvidence {
  const kept: AiJiraIssueEvidence = { ...item }
  delete kept.description
  delete kept.comments
  delete kept.history
  delete kept.links
  delete kept.subtasks
  return kept
}

/** A read-only board over the fictional items that records every read. */
export function evalBoard() {
  const reads: Array<{ keys: string[]; detail: boolean }> = []
  const searches: BoardSearch[] = []
  const byKey = new Map(EVAL_ITEMS.map((item) => [item.key, item]))
  const reader: BoardReader = {
    label: 'Jira',
    keyExample: 'EVAL-123',
    normaliseKey: (raw) =>
      /^EVAL-\d+$/i.test(raw.trim()) ? raw.trim().toUpperCase() : null,
    items: (keys, detail) => {
      reads.push({ keys, detail })
      const found = keys.flatMap((key) => {
        const item = byKey.get(key)
        return item ? [detail ? item : overview(item)] : []
      })
      return Promise.resolve({
        items: found,
        unavailable: keys.filter((key) => !byKey.has(key)),
      })
    },
    search: (query) => {
      searches.push(query)
      const text = query.text?.toLowerCase()
      const person = query.assignee?.toLowerCase()
      const matches = EVAL_ITEMS.filter(
        (item) =>
          query.state !== 'done' &&
          (!query.status ||
            item.status.toLowerCase() === query.status.toLowerCase()) &&
          (!person || (item.assignee ?? '').toLowerCase().includes(person)) &&
          (!text || item.summary.toLowerCase().includes(text)),
      )
      const limit = query.limit ?? 25
      return Promise.resolve({
        items: matches.slice(0, limit).map(overview),
        total: matches.length,
        more: matches.length > limit,
      })
    },
  }
  /** Every key the AI read, in either mode. */
  const readKeys = () => new Set(reads.flatMap((read) => read.keys))
  return { reader, reads, searches, readKeys }
}
