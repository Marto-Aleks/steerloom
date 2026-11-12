// @vitest-environment node
import { expect, it } from 'vitest'
import { EVAL_CODE, EVAL_CONTEXT, EVAL_ITEMS, evalBoard } from './board'
import { EVAL_CASES, scoreAnswer } from './cases'

/*
 * The test questions themselves, without a model: the fictional board is
 * consistent, every case names items that exist, and the scoring catches the
 * failures it is there for.
 */

const rework = EVAL_CASES.find((test) => test.id === 'rework-quiet')!

it('builds a consistent fictional board', () => {
  const keys = new Set(EVAL_ITEMS.map((item) => item.key))
  expect(EVAL_CODE.every((entry) => keys.has(entry.key))).toBe(true)
  expect(
    EVAL_CONTEXT.delayedWorkInProgress.map((item) => item.key),
  ).not.toContain('EVAL-110')
  for (const test of EVAL_CASES)
    for (const key of [...(test.mention ?? []), ...(test.read ?? [])])
      expect(keys.has(key) || key === 'EVAL-150', `${test.id}: ${key}`).toBe(
        true,
      )
  expect(new Set(EVAL_CASES.map((test) => test.id)).size).toBe(
    EVAL_CASES.length,
  )
})

it('reads only what is asked, and hides text in an overview', async () => {
  const board = evalBoard()
  const overview = await board.reader.items(['EVAL-101', 'EVAL-199'], false)
  expect(overview.items[0]?.comments).toBeUndefined()
  expect(overview.unavailable).toEqual(['EVAL-199'])
  const detail = await board.reader.items(['EVAL-101'], true)
  expect(detail.items[0]?.comments?.length).toBe(2)
  expect([...board.readKeys()]).toEqual(['EVAL-101', 'EVAL-199'])
})

it('passes a good answer', () => {
  const answer = `**EVAL-101 is late because rework went quiet**: it was reopened from Done and changes were requested on acme/web#301 16 days ago, with no activity since.
- Next step: ask Ana Ruiz whether the requested changes are still needed.`
  expect(scoreAnswer(rework, answer, new Set(['EVAL-101']))).toEqual({
    pass: true,
    failures: [],
  })
})

it('fails the answers it exists to catch', () => {
  const wrong = `EVAL-101 is waiting for a first review. Ana Ruiz pushes the changes. Hold a retro.`
  const { pass, failures } = scoreAnswer(rework, wrong, new Set())
  expect(pass).toBe(false)
  expect(failures).toEqual(
    expect.arrayContaining([
      'missing: changes were requested',
      'says: blames waiting for a first review',
      'says: generic coaching',
      'says: assumes who writes code',
      'answered without reading EVAL-101',
    ]),
  )
})

it('checks the verdict line on its own', () => {
  const thin = EVAL_CASES.find((test) => test.id === 'thin-evidence')!
  const claims =
    'EVAL-109 is late because **there is no linked code**.\n- Ask Chen Li what it waits on.'
  const hedges =
    'Nothing on the board says why **EVAL-109 waits**.\n- Ask Chen Li what it waits on.'
  expect(scoreAnswer(thin, claims, new Set(['EVAL-109'])).failures).toEqual([
    'verdict misses: admits the cause is unknown',
  ])
  expect(scoreAnswer(thin, hedges, new Set(['EVAL-109'])).pass).toBe(true)
})
