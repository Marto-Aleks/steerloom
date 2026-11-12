import { expect, it } from 'vitest'
import { demoSnapshot } from './demo'
import { demoCodeTrail } from './demo-github'

it('gives the demo board a code trail that lines up with its items', () => {
  const snapshot = demoSnapshot(
    'demo-product',
    new Date('2026-11-08T09:00:00Z'),
  )
  const { pullRequests, branches } = demoCodeTrail(snapshot)
  const keys = new Set(snapshot.issues.map((issue) => issue.key))
  // Every record names an item on the board, and nothing is in the future.
  for (const record of [...pullRequests, ...branches])
    for (const key of record.keys) expect(keys.has(key)).toBe(true)
  const dates = pullRequests.flatMap((record) =>
    [record.readyAt, record.mergedAt].filter(Boolean),
  )
  expect(dates.every((date) => date! <= snapshot.loadedAt)).toBe(true)
  // Work in progress covers every code state, two of them merged already.
  const active = (key: string) =>
    pullRequests.find((record) => record.keys.includes(key))
  expect(active('DEMO-35')?.readyAt).toBeUndefined()
  expect(active('DEMO-34')?.firstReviewAt).toBeUndefined()
  expect(active('DEMO-33')?.approvedAt).toBeDefined()
  expect(active('DEMO-31')?.mergedAt).toBeDefined()
  expect(branches.map((branch) => branch.keys[0])).toContain('DEMO-36')
  // Fictional addresses only.
  expect(pullRequests.every((record) => record.url.includes('.invalid'))).toBe(
    true,
  )
})
