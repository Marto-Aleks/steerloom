import { expect, it } from 'vitest'
import { answerStats, statsLine } from './answer-stats'

const usage = {
  requests: 4,
  inputTokens: 38_400,
  cachedTokens: 31_000,
  cacheWriteTokens: 7_000,
  outputTokens: 2_100,
  unreported: 0,
  retries: 1,
  roomRetries: 0,
}

it('writes one log line per answer, in counts only', () => {
  const stats = answerStats({
    outcome: 'card',
    startedAt: 1_000,
    now: 42_240,
    usage,
    agent: {
      toolCalls: 5,
      items: 12,
      detailed: 5,
      searches: 2,
      code: 0,
      nudged: true,
      outOfTurns: false,
    },
    card: {
      verdict: 'Fictional verdict.',
      confidence: 'possible',
      basis: 'Only Jira shows it',
      next: 'Ask the owner.',
      reasons: [
        { kind: 'supports', source: 'Jira', keys: ['DEMO-1'], fact: 'A fact.' },
        {
          kind: 'unchecked',
          source: 'Jira',
          keys: ['DEMO-2'],
          fact: 'A claim.',
        },
      ],
      removed: ['option “Hold a retro”: generic advice'],
    },
  })
  expect(stats).toMatchObject({
    seconds: 41.2,
    modelCalls: 4,
    tokens: { input: 38_400, cached: 31_000, output: 2_100 },
    removed: 1,
    unchecked: 1,
  })
  const line = statsLine(
    { format: 'anthropic', model: 'fictional-model' },
    stats,
  )
  expect(line).toBe(
    '[ai] answer card · anthropic fictional-model · 41.2 s · 4 model calls · 12 items (5 in detail), 2 searches · 38400 tokens in (31000 cached), 2100 out · 1 retry · sent back to read · 1 removed · 1 not checked',
  )
  // Nothing of the answer itself reaches the log.
  expect(line).not.toMatch(/DEMO-|Fictional verdict|retro/)
})

it('says so when a provider reports no token counts, and names a failure', () => {
  const stats = answerStats({
    outcome: 'failed',
    startedAt: 0,
    now: 3_000,
    usage: { ...usage, requests: 1, unreported: 1, retries: 0 },
  })
  expect(stats.tokens).toBeNull()
  expect(statsLine({ format: 'openai', model: '' }, stats, 502)).toBe(
    '[ai] answer failed 502 · openai gateway default · 3.0 s · 1 model call · no board reads · tokens not reported',
  )
})
