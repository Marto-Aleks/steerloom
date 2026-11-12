// @vitest-environment node
import { expect, it } from 'vitest'
import { checkAnswerCard, finishAnswer } from './answer-card'
import { EVAL_CONTEXT } from './eval/board'

/*
 * What Steerloom checks before a card is drawn, on the fictional test board:
 * sources, confidence and options are decided here, not by the model.
 */

const read = { checked: new Set(['EVAL-101']) }

const card = (fields: Record<string, unknown>) =>
  JSON.stringify({
    verdict: '**Rework that went quiet**, not a slow review.',
    next: 'Ask Ana Ruiz whether the requested changes still apply.',
    checkpoint: '#301 has new commits by the next refresh.',
    reasons: [
      {
        kind: 'supports',
        source: 'GitHub',
        keys: ['EVAL-101'],
        fact: 'Changes requested; quiet for 16 days.',
      },
      {
        kind: 'supports',
        source: 'Jira',
        keys: ['EVAL-101'],
        fact: 'Reopened from Done on 9 Oct.',
      },
      {
        kind: 'rules-out',
        source: 'GitHub',
        keys: ['EVAL-101'],
        fact: 'Not waiting for reviewers: the first look came within hours.',
      },
    ],
    ...fields,
  })

it('reads a card and sets the confidence from the sources, not the model', () => {
  const result = checkAnswerCard(
    card({ confidence: 'confirmed' }),
    EVAL_CONTEXT,
    read,
  )
  expect(result).toMatchObject({
    confidence: 'likely',
    basis: 'GitHub and Jira agree',
    sources: ['GitHub', 'Jira'],
    next: 'Ask Ana Ruiz whether the requested changes still apply.',
  })
  expect(result?.reasons.map((reason) => reason.kind)).toEqual([
    'supports',
    'supports',
    'rules-out',
  ])
  // One source alone is "possible".
  const single = checkAnswerCard(
    card({
      reasons: [
        {
          kind: 'supports',
          source: 'GitHub',
          keys: ['EVAL-101'],
          fact: 'Quiet for 16 days.',
        },
      ],
    }),
    EVAL_CONTEXT,
    read,
  )
  expect(single).toMatchObject({
    confidence: 'possible',
    basis: 'Only GitHub shows it',
  })
})

it('marks a claim about an item it did not read as not checked, and drops unknown items', () => {
  const result = checkAnswerCard(
    card({
      reasons: [
        // On the board, but never read in this answer.
        {
          kind: 'supports',
          source: 'Jira',
          keys: ['EVAL-102'],
          fact: 'Blocked by Logistics.',
        },
        // Not on this board at all.
        {
          kind: 'supports',
          source: 'Jira',
          keys: ['EVAL-999'],
          fact: 'Waiting on design.',
        },
        // A code claim about an item with no code trail.
        {
          kind: 'supports',
          source: 'GitHub',
          keys: ['EVAL-150'],
          fact: 'Merged.',
        },
      ],
    }),
    EVAL_CONTEXT,
    read,
  )
  expect(
    result?.reasons.map((reason) => [reason.keys[0], reason.kind]),
  ).toEqual([['EVAL-102', 'unchecked']])
  expect(result?.removed).toEqual(
    expect.arrayContaining([
      'a reason about EVAL-999: not on this board',
      'a reason about EVAL-150: not on this board',
    ]),
  )
  // Nothing supported: the confidence says so.
  expect(result).toMatchObject({
    confidence: 'possible',
    basis: 'Nothing read confirms it yet',
  })
})

it('removes options without an item, without a checkpoint, or with generic advice', () => {
  const result = checkAnswerCard(
    card({
      options: [
        {
          what: 'Improve team communication about EVAL-101.',
          checkpoint: 'Better flow.',
        },
        {
          what: 'Split the timeout fix out of EVAL-101.',
          tradeOff: 'One more item.',
          checkpoint: 'EVAL-101 merged within a week.',
          keys: ['EVAL-101'],
        },
        { what: 'Escalate it.', checkpoint: 'By Friday.' },
        { what: 'Close acme/web#301 and descope.', keys: [] },
      ],
      recommended: ['B'],
      why: 'the reviewer already said what to change.',
    }),
    EVAL_CONTEXT,
    read,
  )
  expect(result?.options).toEqual([
    {
      what: 'Split the timeout fix out of EVAL-101.',
      tradeOff: 'One more item.',
      checkpoint: 'EVAL-101 merged within a week.',
      keys: ['EVAL-101'],
      recommended: true,
    },
  ])
  expect(result?.removed).toEqual([
    'option “Improve team communication about EVAL-101.”: generic advice',
    'option “Escalate it.”: no item named',
    'option “Close acme/web#301 and descope.”: no checkpoint',
  ])
  expect(result?.why).toBe('the reviewer already said what to change.')
})

it('keeps plain answers plain, reads fenced cards, and never shows broken JSON', () => {
  expect(
    finishAnswer('EVAL-101 is held by Ana Ruiz.', EVAL_CONTEXT, read),
  ).toEqual({
    message: 'EVAL-101 is held by Ana Ruiz.',
  })
  const fenced = finishAnswer(
    '```json\n' + card({}) + '\n```',
    EVAL_CONTEXT,
    read,
  )
  expect(fenced.card?.verdict).toBe(
    '**Rework that went quiet**, not a slow review.',
  )
  expect(fenced.message).toContain('Next step: Ask Ana Ruiz')
  expect(fenced.message).toContain(
    '- Ruled out: EVAL-101: Not waiting for reviewers',
  )
  const broken = finishAnswer('{"verdict": "half', EVAL_CONTEXT, read)
  expect(broken.card).toBeUndefined()
  expect(broken.message).not.toContain('{')
  // A card without a next step is not a card.
  expect(checkAnswerCard(card({ next: '' }), EVAL_CONTEXT, read)).toBeNull()
})

it('rewrites the data’s field names and fractions of a day in the board’s words', () => {
  const result = checkAnswerCard(
    card({
      reasons: [
        {
          kind: 'supports',
          source: 'GitHub',
          keys: ['EVAL-105'],
          fact: 'No pull requests linked; code state is no code.',
        },
        {
          kind: 'supports',
          source: 'Board',
          keys: ['EVAL-105'],
          fact: 'In Code Review with no pull request (code state “nocode”).',
        },
        {
          kind: 'rules-out',
          source: 'GitHub',
          keys: ['EVAL-101'],
          fact: 'First look came within hours (0.2 days).',
        },
        {
          kind: 'supports',
          source: 'Jira',
          keys: ['EVAL-101'],
          fact: 'Reopened on 9 Oct.',
        },
      ],
    }),
    EVAL_CONTEXT,
    read,
  )
  expect(result?.reasons.map((reason) => reason.fact)).toEqual([
    'No pull requests linked; no linked code.',
    'In Code Review with no pull request.',
    'First look came within hours (5 hours).',
    'Reopened on 9 Oct.',
  ])
  expect(result?.basis).toBe('GitHub, the board and Jira agree')
})

it('drops a list of one: it only repeats the verdict', () => {
  const one = checkAnswerCard(
    card({ list: [{ keys: ['EVAL-101'], text: 'Rework went quiet.' }] }),
    EVAL_CONTEXT,
    read,
  )
  expect(one?.list).toBeUndefined()
  const two = checkAnswerCard(
    card({
      list: [
        { keys: ['EVAL-101'], text: 'Rework went quiet.' },
        { keys: ['EVAL-102'], text: 'Blocked by Logistics.' },
      ],
    }),
    EVAL_CONTEXT,
    read,
  )
  expect(two?.list).toHaveLength(2)
})

it('takes a fact naming a pull request as GitHub, and cleans field names', () => {
  const result = checkAnswerCard(
    card({
      reasons: [
        {
          kind: 'supports',
          source: 'Board',
          keys: ['EVAL-104'],
          fact: 'BoardDisagrees; PR acme/web#305 approved; state misaligned.',
        },
        {
          kind: 'supports',
          source: 'Jira',
          keys: ['EVAL-101'],
          fact: 'Reopened on 9 Oct.',
        },
      ],
    }),
    EVAL_CONTEXT,
    read,
  )
  expect(result?.reasons[0]).toMatchObject({
    source: 'GitHub',
    fact: 'the board and the code disagree; PR acme/web#305 approved; state misaligned.',
  })
  expect(result?.confidence).toBe('likely')
})
