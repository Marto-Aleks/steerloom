import { describe, expect, it } from 'vitest'
import type { PullRequestRecord } from '../data-source/github'
import type { CycleTimePoint, WorkInProgressAgePoint } from '../../types'
import { pullRequestInsight } from './pull-requests'

const now = new Date('2026-11-10T12:00:00Z')
const at = (daysAgo: number) =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString()
const pr = (
  key: string,
  fields: Partial<PullRequestRecord>,
  number = 1,
): PullRequestRecord => ({
  repo: 'acme/web',
  number,
  url: `https://git.example.invalid/acme/web/pull/${number}`,
  keys: [key],
  changesRequested: 0,
  ...fields,
})
const activeItem = (item: string): WorkInProgressAgePoint => ({
  item,
  ageInSelectedColumns: 10,
  currentStatus: 'Review',
})
const finishedItem = (item: string): CycleTimePoint => ({
  item,
  cycleTime: 8,
  sequence: 1,
  cycleStart: at(20),
  cycleEnd: at(5),
  completedLabel: '',
})
// A finished item whose review split is 3 days waiting, 1 in rounds, 0.5 to merge.
const finishedPr = (key: string, number: number) =>
  pr(
    key,
    {
      readyAt: at(14.5),
      firstReviewAt: at(11.5),
      approvedAt: at(10.5),
      mergedAt: at(10),
    },
    number,
  )
const fiveFinished = ['F-1', 'F-2', 'F-3', 'F-4', 'F-5']

describe('pull requests in the briefing', () => {
  it('reads branch and pull request as one code trail, noting only what the board cannot show', () => {
    const { states, groups } = pullRequestInsight({
      pullRequests: [
        pr('A-1', { readyAt: at(6) }),
        pr('A-2', { readyAt: at(5), firstReviewAt: at(4), approvedAt: at(1) }),
        // Reviewed and still moving: the board already tells the story.
        pr('A-3', {
          readyAt: at(5),
          firstReviewAt: at(2),
          lastActivityAt: at(1),
          comments: 4,
        }),
        pr('A-4', { lastActivityAt: at(2) }),
        pr('A-5', { readyAt: at(5), mergedAt: at(3) }),
        pr('A-8', {
          readyAt: at(40),
          firstReviewAt: at(38),
          changesRequested: 1,
          lastActivityAt: at(30),
        }),
      ],
      branches: [
        { repo: 'acme/web', keys: ['B-1'], lastCommitAt: at(90) },
        { repo: 'acme/web', keys: ['B-2'], lastCommitAt: at(1) },
        { repo: 'acme/web', keys: ['B-3'], lastCommitAt: at(1) },
      ],
      active: [
        'A-1',
        'A-2',
        'A-3',
        'A-4',
        'A-5',
        'A-8',
        'B-1',
        'B-2',
        'B-3',
        'C-1',
        'C-2',
      ].map(activeItem),
      finished: [],
      now,
      // A-5 and B-3 and C-2 sit in Review; the rest are early.
      stageOf: (item) =>
        ['A-5', 'B-3', 'C-2'].includes(item) ? 'review' : 'early',
    })
    expect(
      Object.fromEntries([...states].map(([key, state]) => [key, state.short])),
    ).toEqual({
      'A-1': 'no first look · 6d',
      'A-2': 'approved 1d, not merged',
      'A-5': 'merged 3d ago',
      'A-8': 'in review, quiet 30d · changes asked',
      'B-1': 'coding, quiet 90d',
      'B-3': 'still coding',
      'C-2': 'no linked code',
    })
    expect(
      Object.fromEntries(
        [...groups].map(([key, entry]) => [
          key,
          [entry.id, entry.tone ?? '', entry.mismatch ? 'ring' : '']
            .join(' ')
            .trim(),
        ]),
      ),
    ).toEqual({
      'A-1': 'review waiting',
      'A-2': 'approved alive ring',
      'A-3': 'review alive',
      'A-4': 'coding alive',
      'A-5': 'merged  ring',
      'A-8': 'review quiet',
      'B-1': 'coding quiet',
      'B-2': 'coding alive',
      'B-3': 'coding alive ring',
      'C-1': 'nocode',
      'C-2': 'nocode  ring',
    })
    expect(groups.get('A-3')?.detail).toBe(
      'In review, 4 comments, last change 1 day ago.',
    )
    expect(states.get('B-1')?.full).toBe(
      'Coding: a branch exists; last commit 90 days ago.',
    )
  })

  it('splits a typical finished item’s time inside Review and counts coverage', () => {
    const { inside } = pullRequestInsight({
      pullRequests: fiveFinished.map((key, index) => finishedPr(key, index)),
      active: [],
      finished: [...fiveFinished, 'F-6'].map(finishedItem),
      now,
    })
    expect(inside).toEqual({
      parts: [
        { label: 'Waiting for a first review', days: 3, waiting: true },
        { label: 'Review rounds', days: 1 },
        { label: 'Approved, waiting to merge', days: 0.5 },
      ],
      cycleDays: 8,
      pullRequestDays: 4.5,
      linked: 5,
      total: 6,
    })
  })

  it('shows no split from too few linked items, and no “no pull request” lines then', () => {
    const result = pullRequestInsight({
      pullRequests: [finishedPr('F-1', 1)],
      active: [activeItem('A-9')],
      finished: fiveFinished.map(finishedItem),
      now,
    })
    expect(result.inside).toBeUndefined()
    expect(result.states.has('A-9')).toBe(false)
  })

  it('fires the review-wait signal when the first look is the real queue', () => {
    const { signals, states } = pullRequestInsight({
      pullRequests: [
        ...fiveFinished.map((key, index) => finishedPr(key, index)),
        pr('A-1', { readyAt: at(6) }, 20),
        pr('A-2', { readyAt: at(2) }, 21),
      ],
      active: [activeItem('A-1'), activeItem('A-2'), activeItem('A-3')],
      finished: fiveFinished.map(finishedItem),
      now,
    })
    expect(states.get('A-3')?.short).toBe('no linked code')
    expect(signals).toEqual([
      expect.objectContaining({
        id: 'review-wait',
        title: 'Pull requests wait 3 days for a first review',
        evidence:
          '67% of the time inside Review passes before anyone looks at the code. 2 open pull requests have no review yet; the oldest, A-1, has waited 6 days.',
        meta: '2 pull requests without a review',
      }),
    ])
  })

  it('names the one waiting pull request without “the oldest”', () => {
    const { signals } = pullRequestInsight({
      pullRequests: [
        ...fiveFinished.map((key, index) => finishedPr(key, index)),
        pr('A-1', { readyAt: at(4) }, 20),
      ],
      active: [activeItem('A-1')],
      finished: fiveFinished.map(finishedItem),
      now,
    })
    expect(signals[0]?.evidence).toBe(
      '67% of the time inside Review passes before anyone looks at the code. A-1 has waited 4 days with no review yet.',
    )
  })

  it('fires merged-but-not-Done for two or more cards that did not move', () => {
    const { signals } = pullRequestInsight({
      pullRequests: [
        pr('A-1', { readyAt: at(9), mergedAt: at(2) }, 1),
        pr('A-2', { readyAt: at(9), mergedAt: at(5) }, 2),
        pr('A-3', { readyAt: at(9), mergedAt: at(0.5) }, 3),
      ],
      active: ['A-1', 'A-2', 'A-3'].map(activeItem),
      finished: [],
      now,
      stageOf: () => 'review',
    })
    expect(signals).toEqual([
      expect.objectContaining({
        id: 'merged-not-done',
        title: '2 items are merged but not Done',
        evidence: expect.stringContaining('merged 2 to 5 days ago') as string,
        meta: 'A-1, A-2',
      }),
    ])
  })

  it('fires when an approved pull request is held by failing checks', () => {
    const { signals, states } = pullRequestInsight({
      pullRequests: [
        pr('A-1', {
          readyAt: at(6),
          firstReviewAt: at(4),
          approvedAt: at(3),
          checks: 'failing',
        }),
      ],
      active: [activeItem('A-1')],
      finished: [],
      now,
    })
    expect(states.get('A-1')?.short).toBe('approved, checks fail')
    expect(signals).toEqual([
      expect.objectContaining({
        id: 'checks-failing',
        title: 'An approved pull request is held by failing checks',
        evidence:
          'A-1: the checks on its latest commit fail. It is already approved, so only the checks stand between it and the merge.',
      }),
    ])
  })

  it('needs two failing pull requests when none is approved yet', () => {
    const run = (keys: string[]) =>
      pullRequestInsight({
        pullRequests: keys.map((key, index) =>
          pr(key, { readyAt: at(3), checks: 'failing' }, index + 1),
        ),
        active: keys.map(activeItem),
        finished: [],
        now,
      }).signals.filter((signal) => signal.id === 'checks-failing')
    expect(run(['A-1'])).toEqual([])
    expect(run(['A-1', 'A-2'])).toEqual([
      expect.objectContaining({
        title: '2 pull requests have failing checks',
        meta: 'A-1, A-2',
      }),
    ])
  })

  it('leaves pull requests untouched for a month out of failing checks', () => {
    const { signals } = pullRequestInsight({
      pullRequests: [
        pr('A-1', { readyAt: at(3), checks: 'failing' }, 1),
        pr('A-2', { readyAt: at(4), checks: 'failing' }, 2),
        // Nothing for 106 days: abandoned, not blocked by its build.
        pr(
          'A-3',
          { readyAt: at(120), lastActivityAt: at(106), checks: 'failing' },
          3,
        ),
      ],
      active: ['A-1', 'A-2', 'A-3'].map(activeItem),
      finished: [],
      now,
    })
    expect(signals.find((signal) => signal.id === 'checks-failing')).toEqual(
      expect.objectContaining({
        title: '2 pull requests have failing checks',
        meta: 'A-1, A-2',
      }),
    )
  })

  it('fires when approved work waits days to be merged', () => {
    const { signals } = pullRequestInsight({
      pullRequests: [
        pr(
          'A-1',
          { readyAt: at(9), firstReviewAt: at(8), approvedAt: at(5) },
          1,
        ),
        pr(
          'A-2',
          { readyAt: at(9), firstReviewAt: at(8), approvedAt: at(2.5) },
          2,
        ),
        // Approved months ago and never merged: abandoned, not waiting.
        pr(
          'A-4',
          { readyAt: at(200), firstReviewAt: at(190), approvedAt: at(180) },
          4,
        ),
        // Approved today: not yet a wait.
        pr(
          'A-3',
          { readyAt: at(9), firstReviewAt: at(8), approvedAt: at(0.5) },
          3,
        ),
      ],
      active: ['A-1', 'A-2', 'A-3', 'A-4'].map(activeItem),
      finished: [],
      now,
    })
    expect(signals).toEqual([
      expect.objectContaining({
        id: 'approved-not-merged',
        title: '2 approved pull requests wait to be merged',
        evidence: expect.stringContaining(
          'A-1 and A-2 were approved 2 to 5 days ago',
        ) as string,
      }),
    ])
  })

  it('compares large and small changes only when the gap is real', () => {
    const finishedSized = (
      key: string,
      number: number,
      size: number,
      readyDays: number,
    ) =>
      pr(
        key,
        { readyAt: at(10 + readyDays), mergedAt: at(10), linesChanged: size },
        number,
      )
    const large = ['L-1', 'L-2', 'L-3', 'L-4']
    const small = ['S-1', 'S-2', 'S-3', 'S-4', 'S-5']
    const run = (largeDays: number) =>
      pullRequestInsight({
        pullRequests: [
          ...large.map((key, index) =>
            finishedSized(key, index + 1, 900, largeDays),
          ),
          ...small.map((key, index) =>
            finishedSized(key, index + 10, 120, 1.5),
          ),
          pr('A-1', { readyAt: at(2), linesChanged: 1250 }, 30),
        ],
        active: [activeItem('A-1')],
        finished: [...large, ...small].map(finishedItem),
        now,
      }).signals.filter((signal) => signal.id === 'large-pull-requests')
    expect(run(2)).toEqual([])
    expect(run(4.5)).toEqual([
      expect.objectContaining({
        title: 'Large pull requests take 3× longer to merge',
        evidence:
          'Finished work with more than 400 lines changed took 4.5 days from ready to merged, against 1.5 days for smaller changes (4 items against 5). Open now: A-1 (1,250 lines).',
        meta: '1 large pull request open',
      }),
    ])
  })
})
