// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { accountIdFromToken, usageCounter, usageSource } from './usage'

const token = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.y`

it('counts people once per step and visits as times', () => {
  const usage = usageCounter()
  usage.count('signed_in', 'account-1')
  usage.count('signed_in', 'account-1')
  usage.count('signed_in', 'account-2')
  usage.count('landing_view')
  usage.count('landing_view')
  const report = usage.report()
  const signed = report.steps.find((item) => item.step === 'signed_in')!
  expect(signed).toEqual({ step: 'signed_in', people: 2, total: 3 })
  const landing = report.steps.find((item) => item.step === 'landing_view')!
  expect(landing).toEqual({ step: 'landing_view', people: null, total: 2 })
  expect(report.days[0]?.counts.signed_in).toBe(3)
})

it('keeps no account ids, only one-way codes, and survives a restart', () => {
  const file = join(
    mkdtempSync(join(tmpdir(), 'steerloom-usage-')),
    'usage.json',
  )
  const first = usageCounter(file)
  first.count('board_connected', 'fictional-account-id')
  first.flush()
  const stored = readFileSync(file, 'utf8')
  expect(stored).not.toContain('fictional-account-id')
  const again = usageCounter(file)
  again.count('board_connected', 'fictional-account-id')
  const step = again
    .report()
    .steps.find((item) => item.step === 'board_connected')!
  expect(step).toEqual({ step: 'board_connected', people: 1, total: 2 })
})

it('keeps 90 days of daily counts', () => {
  let day = new Date('2026-01-01T12:00:00Z')
  const usage = usageCounter(undefined, () => day)
  usage.count('landing_view')
  day = new Date('2026-05-01T12:00:00Z')
  usage.count('landing_view')
  expect(usage.report().days.map((item) => item.day)).toEqual(['2026-05-01'])
})

it('reads the account id from a session token and ignores anything else', () => {
  expect(accountIdFromToken(token('abc-123'))).toBe('abc-123')
  expect(accountIdFromToken('not-a-token')).toBeUndefined()
  expect(accountIdFromToken('a.%%%.b')).toBeUndefined()
})

it('counts steps per link source and caps the number of sources', () => {
  const usage = usageCounter()
  usage.count('landing_view', undefined, 'li')
  usage.count('demo_opened', undefined, 'li')
  usage.count('landing_view')
  for (let index = 0; index < 40; index++)
    usage.count('landing_view', undefined, `s${index}`)
  const report = usage.report()
  expect(report.sources.find((item) => item.source === 'li')?.counts).toEqual({
    landing_view: 1,
    demo_opened: 1,
  })
  // Busiest first: the 11 sources past the cap, then li.
  expect(report.sources.slice(0, 2).map((item) => item.source)).toEqual([
    'other',
    'li',
  ])
  expect(report.sources).toHaveLength(31)
  expect(
    report.sources.find((item) => item.source === 'other')?.counts,
  ).toEqual({ landing_view: 11 })
})

it('accepts only short plain source tags', () => {
  expect(usageSource('LI')).toBe('li')
  expect(usageSource('post-2')).toBe('post-2')
  expect(usageSource('<script>')).toBeUndefined()
  expect(usageSource('x'.repeat(25))).toBeUndefined()
  expect(usageSource(7)).toBeUndefined()
})
