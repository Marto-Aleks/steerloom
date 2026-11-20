import type { BranchRecord, PullRequestRecord } from '../data-source/github'
import type {
  AnalysisFilters,
  FlowBoardSnapshot,
  SprintData,
  SprintItemRecord,
  SprintRecord,
} from '../../types'

/*
 * The open demo's Scrum team: five closed two-week sprints, the running one
 * and the next one planned. Every time is an offset from "now", so the
 * board reads the same on any day and at any hour: the running sprint is
 * always on day 10 of 14, which keeps the demo's recorded AI answers true.
 * Points shape how long work takes, with noise; unfinished work rolls into
 * the next sprint; some items come in mid-sprint, and bugs are not
 * estimated. Fictional throughout.
 */

const DAY = 86_400_000
const HOUR = 3_600_000
const TEAM = ['Lea', 'Marco', 'Nina', 'Omar', 'Kai']
const TITLES = [
  'Order history filters',
  'Guest checkout',
  'Search suggestions',
  'Reorder in one click',
  'Invoice PDF',
  'Loyalty points balance',
  'Coupon stacking rules',
  'Product comparison',
  'Back-in-stock badge',
  'Gift wrapping option',
  'Recently viewed items',
  'Shipping cost preview',
  'Store pickup option',
  'Product reviews summary',
  'Bundle discounts',
  'Address book',
]
const BUG_TITLES = [
  'Cart badge out of date',
  'Wrong stock count after refund',
  'Search ignores accents',
  'Discount shown twice in cart',
]

interface Spec {
  key: number
  title?: string
  /** The sprint it was planned into, by number. */
  sprint: number
  points?: number
  bug?: boolean
  owner?: string
  /** Days after that sprint's start it was added; absent when planned. */
  added?: number
  /** Days after joining before work started; absent when not started. */
  start?: number
  /** Days in progress and review until Done. */
  cycle?: number
}

/** Deterministic noise, so tests, screenshots and recordings agree. */
function noise(seed: number) {
  const value = Math.sin(seed * 9301 + 49297) * 233280
  return value - Math.floor(value)
}

// How long work of each size usually takes, in days: small items are quick,
// 5s and 8s overlap, so points predict time only partly.
const USUAL: Record<number, number> = { 1: 2, 2: 3, 3: 4.5, 5: 6, 8: 7 }
const ACTIVE = 24
const NEXT = ACTIVE + 1

/**
 * The comments and blocker a real tracker would hold, for the demo's AI
 * answers: the assistant reads them like any board's.
 */
export const SCRUM_DEMO_NOTES: Record<
  string,
  {
    comments?: Array<{ author: string; daysAgo: number; body: string }>
    blockedBy?: { key: string; summary: string; status: string }
  }
> = {
  'SHOP-231': {
    comments: [
      {
        author: 'Lea',
        daysAgo: 6,
        body: 'Code is done. The 3-D Secure step can only be tested once the payment provider fixes their sandbox.',
      },
      {
        author: 'Marco',
        daysAgo: 2,
        body: 'Provider says the sandbox fix ships next week. No date yet.',
      },
    ],
    blockedBy: {
      key: 'PAY-88',
      summary: 'Sandbox: 3-D Secure callbacks fail',
      status: 'In Progress',
    },
  },
  'SHOP-245': {
    comments: [
      {
        author: 'Marco',
        daysAgo: 3,
        body: 'Bigger than we estimated: the courier API has no slot endpoint, so we poll their feed.',
      },
    ],
  },
  'SHOP-249': {
    comments: [
      {
        author: 'Nina',
        daysAgo: 8,
        body: 'Support reports about 40 failed coupon checkouts a day on mobile. Taking it into the sprint.',
      },
    ],
  },
  'SHOP-246': {
    comments: [
      {
        author: 'Omar',
        daysAgo: 1,
        body: 'Waiting for the copy from marketing before the emails can go to review.',
      },
    ],
  },
}

export function scrumDemoSnapshot(now = new Date()): FlowBoardSnapshot {
  const at = now.getTime()
  // The running sprint started 9 days and 6 hours ago. A sprint starts every
  // two weeks and ends on its fourteenth day, an hour into it: 14 days long,
  // with the time left that the demo's forecast was written around.
  const anchor = at - 9 * DAY - 6 * HOUR
  const startOf = (n: number) => anchor + (n - ACTIVE) * 14 * DAY
  const endOf = (n: number) => startOf(n) + 13 * DAY + HOUR

  const sprints: SprintRecord[] = [19, 20, 21, 22, 23, ACTIVE, NEXT].map(
    (n) => ({
      id: String(100 + n),
      name: `Sprint ${n}`,
      state: n < ACTIVE ? 'closed' : n === ACTIVE ? 'active' : 'future',
      ...(n <= ACTIVE
        ? {
            startAt: new Date(startOf(n)).toISOString(),
            endAt: new Date(endOf(n)).toISOString(),
          }
        : {}),
      ...(n < ACTIVE ? { completedAt: new Date(endOf(n)).toISOString() } : {}),
      ...(n === ACTIVE
        ? { goal: 'Checkout v2 live for 10% of shoppers' }
        : n === 23
          ? { goal: 'Faster search on mobile' }
          : {}),
    }),
  )

  const specs: Spec[] = []
  const sizes = [3, 5, 2, 8, 1, 3, 5, 2, 3, 5]
  let next = 120
  ;[19, 20, 21, 22, 23].forEach((n, sprintIndex) => {
    const planned = [9, 10, 8, 10, 9][sprintIndex]!
    for (let index = 0; index < planned; index++) {
      const seed = n * 100 + index
      const points = sizes[(index + sprintIndex) % sizes.length]!
      specs.push({
        key: next++,
        sprint: n,
        points,
        start: Math.floor(noise(seed) * 7),
        cycle: USUAL[points]! * (0.55 + noise(seed + 7) * 1.4),
      })
    }
    const added = [1, 2, 0, 3, 2][sprintIndex]!
    for (let index = 0; index < added; index++) {
      const seed = n * 100 + 50 + index
      specs.push({
        key: next++,
        sprint: n,
        bug: index % 2 === 0,
        ...(index % 2 ? { points: 2 } : {}),
        added: 2 + Math.floor(noise(seed) * 6),
        start: 0,
        cycle: 1.5 + noise(seed + 3) * 4,
      })
    }
  })
  // The running sprint, day 10 of 14: done, moving, late, not started, one
  // item in its third sprint and blocked by the payment provider, and two
  // bugs and a story added since it started.
  specs.push(
    {
      key: 231,
      title: 'Checkout v2: 3-D Secure payment step',
      sprint: 22,
      points: 8,
      owner: 'Lea',
      start: 2,
      cycle: 60,
    },
    {
      key: 240,
      title: 'Saved cards at checkout',
      sprint: ACTIVE,
      points: 3,
      owner: 'Lea',
      start: 0,
      cycle: 3,
    },
    {
      key: 241,
      title: 'Checkout v2: order summary',
      sprint: ACTIVE,
      points: 2,
      owner: 'Kai',
      start: 1,
      cycle: 4,
    },
    {
      key: 242,
      title: 'Gift message on orders',
      sprint: ACTIVE,
      points: 1,
      owner: 'Nina',
      start: 6,
      cycle: 2,
    },
    {
      key: 243,
      title: 'Checkout v2: delivery options',
      sprint: ACTIVE,
      points: 2,
      owner: 'Kai',
      start: 6,
      cycle: 30,
    },
    {
      key: 244,
      title: 'Address autocomplete',
      sprint: ACTIVE,
      points: 1,
      owner: 'Omar',
      start: 7,
      cycle: 30,
    },
    {
      key: 245,
      title: 'Delivery slot picker',
      sprint: ACTIVE,
      points: 5,
      owner: 'Marco',
      start: 4,
      cycle: 30,
    },
    {
      key: 246,
      title: 'Stock alert emails',
      sprint: ACTIVE,
      points: 5,
      owner: 'Omar',
      start: 6,
      cycle: 30,
    },
    {
      key: 247,
      title: 'Checkout v2: rollout switch for 10%',
      sprint: ACTIVE,
      points: 5,
    },
    { key: 248, title: 'Returns label download', sprint: ACTIVE, points: 3 },
    {
      key: 249,
      title: 'Coupon fails on mobile',
      sprint: ACTIVE,
      bug: true,
      owner: 'Nina',
      added: 2,
      start: 0,
      cycle: 30,
    },
    {
      key: 250,
      title: 'Fix VAT on gift cards',
      sprint: ACTIVE,
      bug: true,
      owner: 'Kai',
      added: 3,
      start: 1,
      cycle: 30,
    },
    {
      key: 251,
      title: 'Product size guide',
      sprint: ACTIVE,
      points: 3,
      added: 7,
    },
  )
  // The next sprint: planned above what the team usually finishes, two
  // items not estimated yet.
  ;[8, 5, 8, 5, 8, 5, 3, 5, 5, undefined, undefined].forEach((points, index) =>
    specs.push({
      key: 260 + index,
      sprint: NEXT,
      ...(points !== undefined ? { points } : { bug: true }),
    }),
  )

  const issues: FlowBoardSnapshot['issues'] = []
  const transitions: FlowBoardSnapshot['transitions'] = []
  const items: SprintItemRecord[] = []
  const iso = (time: number) => new Date(time).toISOString()
  specs.forEach((spec, index) => {
    const id = String(7000 + index)
    const key = `SHOP-${spec.key}`
    // The next sprint's items were planned two days ago.
    const joined =
      spec.sprint > ACTIVE
        ? at - 2 * DAY
        : startOf(spec.sprint) + (spec.added ?? -2) * DAY
    const created = joined - (spec.added === undefined ? 3 : 0) * DAY
    const owner = spec.owner ?? TEAM[index % TEAM.length]!
    issues.push({
      id,
      key,
      issueTypeId: spec.bug ? '1' : '10001',
      issueTypeName: spec.bug ? 'Bug' : 'Story',
      createdAt: iso(created),
      title:
        spec.title ??
        (spec.bug
          ? BUG_TITLES[index % BUG_TITLES.length]!
          : TITLES[index % TITLES.length]!),
      browseUrl: `https://example.atlassian.net/browse/${key}`,
      ...(spec.start !== undefined ? { assignee: owner } : {}),
      ownerKnown: true,
    })
    transitions.push({ issueId: id, statusId: 'todo', enteredAt: iso(created) })
    const begun =
      spec.start !== undefined
        ? joined + Math.max(0, spec.start) * DAY
        : undefined
    const done =
      begun !== undefined && spec.cycle !== undefined
        ? begun + spec.cycle * DAY
        : undefined
    if (begun !== undefined && begun < at) {
      transitions.push({
        issueId: id,
        statusId: 'progress',
        enteredAt: iso(begun),
      })
      const review = begun + (done! - begun) * 0.6
      if (review < at)
        transitions.push({
          issueId: id,
          statusId: 'review',
          enteredAt: iso(review),
        })
      if (done! < at)
        transitions.push({
          issueId: id,
          statusId: 'done',
          enteredAt: iso(done!),
        })
    }
    // Planned or added, then rolled over at each close until it finishes.
    const changes: SprintItemRecord['sprintChanges'] = []
    let ids = [String(100 + spec.sprint)]
    changes.push({ at: iso(joined), from: [], to: ids })
    for (let n = spec.sprint; n < ACTIVE; n++) {
      if (done !== undefined && done <= endOf(n)) break
      const moved = [...ids, String(100 + n + 1)]
      changes.push({ at: iso(endOf(n)), from: ids, to: moved })
      ids = moved
    }
    items.push({
      issueId: id,
      sprintIds: ids,
      ...(spec.points !== undefined ? { points: spec.points } : {}),
      sprintChanges: changes,
      pointChanges: [],
    })
  })

  const sprintData: SprintData = {
    estimate: { kind: 'points', field: 'Story Points' },
    sprints,
    items,
  }
  return {
    source: { kind: 'demo', label: 'Fictional Scrum team' },
    board: {
      id: 'demo-scrum',
      name: 'Shop team',
      columns: [
        { id: 'col-todo', name: 'To Do', statusIds: ['todo'] },
        { id: 'col-progress', name: 'In Progress', statusIds: ['progress'] },
        { id: 'col-review', name: 'Review', statusIds: ['review'] },
        { id: 'col-done', name: 'Done', statusIds: ['done'] },
      ],
      statuses: [
        { id: 'todo', name: 'To Do', category: 'todo' },
        { id: 'progress', name: 'In Progress', category: 'in-progress' },
        { id: 'review', name: 'Review', category: 'in-progress' },
        { id: 'done', name: 'Done', category: 'done' },
      ],
    },
    issues,
    transitions,
    loadedAt: now.toISOString(),
    sprints: sprintData,
  }
}

/** The measured stages for the Scrum team's flow briefing. */
export const SCRUM_DEMO_FILTERS: AnalysisFilters = {
  ticketTypes: [],
  windowDays: 30,
  selectedColumnIds: ['col-progress', 'col-review'],
}

/**
 * The team's code for its running sprint: the blocked item's pull request
 * waits for a first review, one is approved, one is merged while its card
 * still sits in progress, one is in rework with a red build, the rest are
 * branches with recent commits.
 */
export function scrumDemoCode(snapshot: FlowBoardSnapshot): {
  pullRequests: PullRequestRecord[]
  branches: BranchRecord[]
} {
  const now = Date.parse(snapshot.loadedAt)
  const ago = (days: number) => new Date(now - days * DAY).toISOString()
  const pr = (
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
  return {
    pullRequests: [
      pr('SHOP-231', 412, {
        readyAt: ago(6),
        lastActivityAt: ago(6),
        checks: 'passing',
        linesChanged: 640,
        filesChanged: 14,
      }),
      pr('SHOP-243', 418, {
        readyAt: ago(2),
        firstReviewAt: ago(1.5),
        approvedAt: ago(1),
        lastActivityAt: ago(1),
        checks: 'passing',
        linesChanged: 180,
        filesChanged: 5,
      }),
      pr('SHOP-244', 419, {
        readyAt: ago(1.5),
        firstReviewAt: ago(1),
        approvedAt: ago(0.8),
        mergedAt: ago(0.5),
        lastActivityAt: ago(0.5),
        linesChanged: 90,
        filesChanged: 3,
      }),
      pr('SHOP-249', 415, {
        readyAt: ago(5),
        firstReviewAt: ago(4),
        changesRequested: 2,
        lastActivityAt: ago(1),
        checks: 'failing',
        linesChanged: 120,
        filesChanged: 4,
        comments: 9,
      }),
    ],
    branches: [
      { repo: 'acme/shop', keys: ['SHOP-245'], lastCommitAt: ago(0.3) },
      { repo: 'acme/shop', keys: ['SHOP-246'], lastCommitAt: ago(4) },
      { repo: 'acme/shop', keys: ['SHOP-250'], lastCommitAt: ago(0.5) },
    ],
  }
}
