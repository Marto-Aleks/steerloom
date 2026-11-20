import { expect, it } from 'vitest'
import { boardWords, draftCard } from './answer-card'

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

it('puts the briefing’s field names into plain words wherever a model copies them', () => {
  expect(
    boardWords(
      'Check: finishedPlanned ÷ planned ≥ 0.7, carriedOver < 8 and backToBacklog ≤ 1 next sprint.',
    ),
  ).toBe(
    'Check: planned items finished ÷ planned ≥ 0.7, carried over < 8 and back to the backlog ≤ 1 next sprint.',
  )
  // Ordinary words that only look similar are left alone.
  expect(boardWords('The work was carried over into the stage.')).toBe(
    'The work was carried over into the stage.',
  )
})
