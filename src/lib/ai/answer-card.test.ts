import { expect, it } from 'vitest'
import { draftCard } from './answer-card'

it('reads the verdict and next step from a card still being written', () => {
  expect(draftCard('{"verdict":"**FICT-12** is stuck in rew')).toEqual({
    verdict: '**FICT-12** is stuck in rew',
  })
  expect(
    draftCard(
      '{"verdict":"FICT-12 is \\"stuck\\" (code state \\"nocode\\").","next":"Ask Ana wh',
    ),
  ).toEqual({ verdict: 'FICT-12 is "stuck".', next: 'Ask Ana wh' })
  // A half-written escape is left out, not shown.
  expect(draftCard('{"verdict":"Line one\\')).toEqual({ verdict: 'Line one' })
  expect(draftCard('{"ver')).toEqual({})
})
