// @vitest-environment node
import { expect, it } from 'vitest'
import { checkAnswerCard, finishAnswer } from './answer-card'
import { EVAL_CONTEXT } from './eval/board'
import type { AiReportContext } from '../../src/lib/ai/report-context'

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

/*
 * A board with sprints, asked what its last sprints say. The model names the
 * sprints where item keys go; the facts are the briefing's own numbers.
 */
const SPRINTS: AiReportContext = {
  ...EVAL_CONTEXT,
  sprint: {
    unit: 'points',
    planning: {
      sprint: 'Shop Sprint 25',
      items: [{ key: 'EVAL-171', points: 5 }],
      planned: 40,
      unestimatedItems: 0,
      lastSprints: 2,
      low: 21,
      high: 37,
      usual: 30,
    },
    lastSprints: [
      {
        name: 'Shop Sprint 23',
        planned: 30,
        finishedPlanned: 14,
        added: 5,
        removed: 16,
        finishedPoints: 21,
      },
      {
        name: 'Shop Sprint 24',
        planned: 34,
        finishedPlanned: 17,
        added: 4,
        removed: 17,
        finishedPoints: 37,
      },
    ],
  },
}

const sprintCard = JSON.stringify({
  verdict: '**Half of each plan gets finished**: 31 of 64 planned items.',
  next: 'The team plans Shop Sprint 25 to what it finished before.',
  checkpoint: 'Shop Sprint 25 finishes at least 70% of its plan.',
  reasons: [
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['Shop Sprint 23', 'Shop Sprint 24'],
      fact: 'Shop Sprint 23 finished 14 of 30 planned items, Shop Sprint 24 17 of 34.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['SPRINT 24'],
      fact: '17 planned items left Shop Sprint 24 before its end.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['Shop Sprint 23', 'Shop Sprint 24'],
      fact: 'Shop Sprint 23 finished 14 of 30 planned items, Shop Sprint 24 17 of 34.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['EVAL-171'],
      fact: 'Planned for the next sprint at 5 points.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['WEB-999'],
      fact: 'An item this board does not hold.',
    },
    {
      kind: 'supports',
      source: 'Jira',
      keys: ['WEB-999'],
      fact: 'The same unknown item, said twice.',
    },
  ],
  options: [
    {
      what: 'Plan the next sprint to 30 points, what the team usually finishes',
      tradeOff: 'Ten points wait a sprint.',
      checkpoint: 'Shop Sprint 25 finishes at least 70% of its plan.',
      keys: [],
    },
    {
      what: 'Lock the scope after day 3 of the sprint',
      tradeOff: 'Urgent work needs a swap, not an add.',
      checkpoint: 'Fewer items are added.',
      keys: [],
    },
  ],
  recommended: ['A'],
  why: 'it needs no new rule',
})

it('keeps facts about sprints: a sprint named where keys go is not a missing item', () => {
  const result = checkAnswerCard(sprintCard, SPRINTS, { checked: new Set() })!
  // The sprint facts stay, as the board's own numbers, with no item chips.
  expect(result.reasons.slice(0, 3)).toEqual([
    expect.objectContaining({ kind: 'supports', source: 'Board', keys: [] }),
    expect.objectContaining({ kind: 'supports', source: 'Board', keys: [] }),
    expect.objectContaining({ kind: 'supports', source: 'Board', keys: [] }),
  ])
  // An item in the next sprint's plan is on this board; Jira was not read
  // for it, so the claim says so.
  expect(result.reasons[3]).toMatchObject({
    kind: 'unchecked',
    keys: ['EVAL-171'],
  })
  // A real unknown item is still dropped, and said once.
  expect(result.reasons).toHaveLength(4)
  expect(result.removed).toEqual([
    'a reason about WEB-999: not on this board',
    'option “Lock the scope after day 3 of the sprint”: no item named',
  ])
  expect(result.sources).toEqual(['Board'])
})

it('accepts a change to planning that names a sprint and the number to move', () => {
  const result = checkAnswerCard(sprintCard, SPRINTS, { checked: new Set() })!
  expect(result.options).toEqual([
    expect.objectContaining({
      what: 'Plan the next sprint to 30 points, what the team usually finishes',
      recommended: true,
    }),
  ])
  // Without sprints on the board, an option still has to name an item.
  expect(
    checkAnswerCard(sprintCard, EVAL_CONTEXT, { checked: new Set() })!.options,
  ).toBeUndefined()
})

it('accepts a change to how the board works that names a stage and a number', () => {
  const stage = EVAL_CONTEXT.scope.selectedColumns[0]!
  const result = checkAnswerCard(
    JSON.stringify({
      verdict: `**${stage} is where the time goes.**`,
      next: `The team agrees a limit for ${stage}.`,
      reasons: [
        {
          kind: 'supports',
          source: 'Jira',
          keys: [stage],
          fact: `${stage} holds most of the active items.`,
        },
      ],
      options: [
        {
          what: `Limit ${stage} to four items at a time`,
          tradeOff: 'New work waits when it is full.',
          checkpoint: `${stage} holds 4 items or fewer by the next refresh.`,
          keys: [],
        },
        {
          what: 'Start less at once',
          tradeOff: 'New work waits.',
          checkpoint: 'Fewer than 4 items started this week.',
          keys: [],
        },
        {
          what: `Review ${stage} more often`,
          tradeOff: 'Takes time.',
          checkpoint: 'It feels faster.',
          keys: [],
        },
      ],
    }),
    EVAL_CONTEXT,
    { checked: new Set() },
  )!
  // A fact about a stage is the board's own, with no item chip.
  expect(result.reasons).toEqual([
    expect.objectContaining({ kind: 'supports', source: 'Board', keys: [] }),
  ])
  // Tied to this board's stage and a number: kept. Naming no stage, or no
  // number to check: still removed.
  expect(result.options?.map((option) => option.what)).toEqual([
    `Limit ${stage} to four items at a time`,
  ])
  expect(result.removed).toHaveLength(2)
})
