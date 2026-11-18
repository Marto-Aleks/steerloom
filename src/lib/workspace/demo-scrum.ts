import type { BranchRecord, PullRequestRecord } from '../data-source/github'
import type {
  FlowBoardSnapshot,
  SprintData,
  SprintItemRecord,
  SprintRecord,
} from '../../types'

/*
 * A fictional Scrum team, relative to "now": five closed two-week sprints,
 * the running one and the next one planned. Points shape how long work takes,
 * with noise; unfinished work rolls into the next sprint; a few items are
 * added mid-sprint, and bugs are not estimated. For tests and the review
 * preview: every number the Sprint tab shows comes from this history.
 */

const DAY = 86_400_000
const TITLES = [
  'Saved cards at checkout',
  'Order history filters',
  'Gift message on orders',
  'Express delivery option',
  'Address autocomplete',
  'Delivery slot picker',
  'Stock alert emails',
  'Wishlist sharing',
  'Returns label download',
  'Product size guide',
  'Coupon stacking rules',
  'Guest checkout',
  'Search suggestions',
  'Reorder in one click',
  'Invoice PDF',
  'Loyalty points balance',
]
const BUG_TITLES = [
  'Coupon fails on mobile',
  'Fix VAT on gift cards',
  'Wrong stock count after refund',
  'Cart badge out of date',
]

interface Spec {
  /** The sprint it was planned into, by number. */
  sprint: number
  points?: number
  bug?: boolean
  /** Days after that sprint's start it was added; absent when planned. */
  added?: number
  /** Days after joining before work started; absent when not started yet. */
  start?: number
  /** Days in progress and review until Done. */
  cycle?: number
}

/** Deterministic noise, so tests and screenshots agree. */
function noise(seed: number) {
  const value = Math.sin(seed * 9301 + 49297) * 233280
  return value - Math.floor(value)
}

const USUAL: Record<number, number> = { 1: 2, 2: 3, 3: 4, 5: 6.5, 8: 7 }

export function scrumDemoSnapshot(now = new Date()): FlowBoardSnapshot {
  const at = now.getTime()
  // The running sprint started on the Monday of last week, 09:00 UTC.
  const anchor = new Date(at - 7 * DAY)
  anchor.setUTCHours(9, 0, 0, 0)
  anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7))
  const ACTIVE = 24
  const startOf = (n: number) => anchor.getTime() + (n - ACTIVE) * 14 * DAY
  const endOf = (n: number) => startOf(n) + 11 * DAY + 8 * 3_600_000

  const sprints: SprintRecord[] = [19, 20, 21, 22, 23, 24, 25].map((n) => ({
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
    ...(n === ACTIVE ? { goal: 'Checkout v2 live for 10% of shoppers' } : {}),
  }))

  const specs: Spec[] = []
  const sizes = [3, 5, 2, 8, 1, 3, 5, 2, 3, 5]
  ;[19, 20, 21, 22, 23].forEach((n, sprintIndex) => {
    const planned = [9, 10, 8, 10, 9][sprintIndex]!
    for (let index = 0; index < planned; index++) {
      const seed = n * 100 + index
      const points = sizes[(index + sprintIndex) % sizes.length]!
      specs.push({
        sprint: n,
        points,
        start: Math.floor(noise(seed) * 7),
        cycle: USUAL[points]! * (0.6 + noise(seed + 7) * 1.3),
      })
    }
    const added = [1, 2, 0, 3, 2][sprintIndex]!
    for (let index = 0; index < added; index++) {
      const seed = n * 100 + 50 + index
      specs.push({
        sprint: n,
        bug: index % 2 === 0,
        ...(index % 2 ? { points: 2 } : {}),
        added: 2 + Math.floor(noise(seed) * 6),
        start: 0,
        cycle: 1.5 + noise(seed + 3) * 4,
      })
    }
  })
  // The running sprint: done, moving, late, not started, and one that has
  // rolled over twice; two bugs and a story added since it started.
  specs.push(
    { sprint: 22, points: 8, start: 2, cycle: 60 },
    { sprint: ACTIVE, points: 3, start: 0, cycle: 3 },
    { sprint: ACTIVE, points: 2, start: 1, cycle: 4 },
    { sprint: ACTIVE, points: 1, start: 6, cycle: 2 },
    { sprint: ACTIVE, points: 2, start: 6, cycle: 30 },
    { sprint: ACTIVE, points: 1, start: 7, cycle: 30 },
    { sprint: ACTIVE, points: 5, start: 4, cycle: 30 },
    { sprint: ACTIVE, points: 5, start: 6, cycle: 30 },
    { sprint: ACTIVE, points: 5 },
    { sprint: ACTIVE, points: 3 },
    { sprint: ACTIVE, bug: true, added: 2, start: 0, cycle: 30 },
    { sprint: ACTIVE, bug: true, added: 3, start: 1, cycle: 30 },
    { sprint: ACTIVE, points: 3, added: 7 },
  )
  ;[5, 8, 5, 3, 8, 3, 5, 3].forEach((points) =>
    specs.push({ sprint: ACTIVE + 1, points }),
  )

  const issues: FlowBoardSnapshot['issues'] = []
  const transitions: FlowBoardSnapshot['transitions'] = []
  const items: SprintItemRecord[] = []
  const iso = (time: number) => new Date(time).toISOString()
  specs.forEach((spec, index) => {
    const id = String(5000 + index)
    const key = `SCRUM-${10 + index}`
    // The next sprint's items were planned two days ago.
    const joined =
      spec.sprint > ACTIVE
        ? at - 2 * DAY
        : startOf(spec.sprint) + (spec.added ?? -2) * DAY
    const created = joined - (spec.added === undefined ? 3 : 0) * DAY
    issues.push({
      id,
      key,
      issueTypeId: spec.bug ? '1' : '10001',
      issueTypeName: spec.bug ? 'Bug' : 'Story',
      createdAt: iso(created),
      title: spec.bug
        ? BUG_TITLES[index % BUG_TITLES.length]!
        : TITLES[index % TITLES.length]!,
      browseUrl: `https://example.atlassian.net/browse/${key}`,
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
    // Sprint membership: planned or added, then rolled over at each close
    // until it finishes.
    const changes: SprintItemRecord['sprintChanges'] = []
    let ids = [String(100 + spec.sprint)]
    changes.push({ at: iso(joined), from: [], to: ids })
    for (let n = spec.sprint; n < ACTIVE; n++) {
      if (done !== undefined && done <= endOf(n)) break
      const next = [...ids, String(100 + n + 1)]
      changes.push({ at: iso(endOf(n)), from: ids, to: next })
      ids = next
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

/** The measured stages for the fictional Scrum board. */
export const SCRUM_DEMO_FILTERS = {
  ticketTypes: [],
  windowDays: 30,
  selectedColumnIds: ['col-progress', 'col-review'],
}

/**
 * The fictional team's code for its running sprint: the oldest item's pull
 * request waits for a first review, one is approved, one is merged while its
 * card still sits in Review, the rest are branches with recent commits.
 */
export function scrumDemoCode(snapshot: FlowBoardSnapshot): {
  pullRequests: PullRequestRecord[]
  branches: BranchRecord[]
} {
  const now = Date.parse(snapshot.loadedAt)
  const ago = (days: number) => new Date(now - days * DAY).toISOString()
  const active = snapshot.sprints?.sprints.find((s) => s.state === 'active')
  const inSprint = new Set(
    snapshot.sprints?.items
      .filter((item) => active && item.sprintIds.includes(active.id))
      .map((item) => item.issueId),
  )
  const status = (issueId: string) =>
    snapshot.transitions.filter((t) => t.issueId === issueId).at(-1)?.statusId
  const started = snapshot.issues.filter(
    (issue) =>
      inSprint.has(issue.id) &&
      ['progress', 'review'].includes(status(issue.id) ?? ''),
  )
  const pullRequests: PullRequestRecord[] = []
  const branches: BranchRecord[] = []
  started.forEach((issue, index) => {
    const pr = (fields: Partial<PullRequestRecord>) =>
      pullRequests.push({
        repo: 'acme/shop',
        number: 300 + index,
        url: `https://git.example.invalid/acme/shop/pull/${300 + index}`,
        keys: [issue.key],
        changesRequested: 0,
        ...fields,
      })
    if (status(issue.id) === 'review' && index === 0)
      pr({ readyAt: ago(6), lastActivityAt: ago(6), checks: 'passing' })
    else if (index === 1)
      pr({
        readyAt: ago(3),
        firstReviewAt: ago(2),
        approvedAt: ago(1),
        lastActivityAt: ago(1),
        checks: 'passing',
      })
    else if (index === 2)
      pr({
        readyAt: ago(4),
        firstReviewAt: ago(3),
        approvedAt: ago(2),
        mergedAt: ago(1),
        lastActivityAt: ago(1),
      })
    else
      branches.push({
        repo: 'acme/shop',
        keys: [issue.key],
        lastCommitAt: ago(index % 3),
      })
  })
  return { pullRequests, branches }
}
