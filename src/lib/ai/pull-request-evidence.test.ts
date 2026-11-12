import { expect, it } from 'vitest'
import type { PullRequestRecord } from '../data-source/github'
import { buildPullRequestEvidence } from './pull-request-evidence'

const now = new Date('2026-11-10T12:00:00Z')
const at = (daysAgo: number) =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString()
const pr = (
  key: string,
  number: number,
  fields: Partial<PullRequestRecord>,
): PullRequestRecord => ({
  repo: 'acme/web',
  number,
  url: `https://git.example.invalid/acme/web/pull/${number}`,
  keys: [key],
  changesRequested: 0,
  ...fields,
})
const active = (item: string, age: number, column = 'Review') => ({
  item,
  column,
  ageInSelectedColumns: age,
  currentStageAgeDays: age / 2,
})

it('puts each item’s pull requests next to where the board says it is', () => {
  const evidence = buildPullRequestEvidence({
    pullRequests: [
      pr('FLOW-1', 1, {
        readyAt: at(9),
        firstReviewAt: at(4),
        changesRequested: 2,
        approvedAt: at(1),
        lastActivityAt: at(1),
      }),
      pr('FLOW-3', 3, { readyAt: at(20), mergedAt: at(12) }),
      pr('FLOW-9', 9, { readyAt: at(3) }),
    ],
    repositories: 1,
    active: [active('FLOW-1', 14), active('FLOW-2', 30), active('FLOW-4', 5)],
    delayedKeys: ['FLOW-2'],
    finished: [
      { item: 'FLOW-3', cycleTime: 11, cycleEnd: at(2) },
      { item: 'FLOW-5', cycleTime: 4, cycleEnd: at(1) },
    ],
    finishedCount: 2,
    now,
  })
  // The late item comes first even without a pull request; FLOW-4 has none
  // and is not late, so it is left out; FLOW-9 is not on the board.
  expect(evidence.items.map((item) => item.key)).toEqual([
    'FLOW-2',
    'FLOW-1',
    'FLOW-3',
  ])
  expect(evidence.items[0]).toMatchObject({ pullRequests: [] })
  expect(evidence.items[1]).toEqual({
    key: 'FLOW-1',
    stage: 'Review',
    daysInStage: 7,
    ageDays: 14,
    pullRequests: [
      {
        ref: 'acme/web#1',
        state: 'approved',
        readyDaysAgo: 9,
        firstReviewAfterDays: 5,
        changesRequested: 2,
        approvedDaysAgo: 1,
        lastActivityDaysAgo: 1,
      },
    ],
  })
  expect(evidence.items[2]).toMatchObject({
    stage: 'finished',
    cycleTimeDays: 11,
    finishedDaysAgo: 2,
    pullRequests: [{ state: 'merged', mergedDaysAgo: 12 }],
  })
  expect(evidence.coverage).toEqual({ linked: 1, finished: 2 })
  expect(JSON.stringify(evidence)).not.toContain('git.example.invalid')
})

it('lists at most four pull requests per item and counts the rest', () => {
  const evidence = buildPullRequestEvidence({
    pullRequests: Array.from({ length: 6 }, (_, index) =>
      pr('FLOW-1', index, { readyAt: at(index + 1) }),
    ),
    repositories: 1,
    active: [active('FLOW-1', 10)],
    delayedKeys: [],
    finished: [],
    finishedCount: 0,
    now,
  })
  expect(evidence.items[0]?.pullRequests).toHaveLength(4)
  expect(evidence.items[0]?.morePullRequests).toBe(2)
})

it('adds each active item’s code trail, including items with only a branch', () => {
  const evidence = buildPullRequestEvidence({
    pullRequests: [],
    branches: [{ repo: 'acme/web', keys: ['FLOW-4'], lastCommitAt: at(30) }],
    trail: new Map([
      [
        'FLOW-4',
        {
          id: 'coding' as const,
          detail: '',
          tone: 'quiet' as const,
          mismatch: true,
        },
      ],
    ]),
    repositories: 1,
    active: [active('FLOW-4', 40), active('FLOW-5', 2)],
    delayedKeys: [],
    finished: [],
    finishedCount: 0,
    now,
  })
  expect(evidence.items).toEqual([
    {
      key: 'FLOW-4',
      stage: 'Review',
      daysInStage: 20,
      ageDays: 40,
      code: 'coding',
      branchLastCommitDaysAgo: 30,
      codeQuietDays: 30,
      boardDisagrees: true,
      pullRequests: [],
    },
  ])
})
