import type { AnswerCard } from '../../src/lib/ai/answer-card'
import type { AgentStats } from './agent'
import type { AiUsage } from './client'
import type { AiServerConfig } from './config'

/*
 * What one question cost and took, in counts: time, requests to the AI
 * provider, tokens, board reads, and how often Steerloom had to correct the
 * model. One line goes to the server's log and the same counts go back with
 * the answer. Never the question, the answer, an item key or a name.
 */

export type AnswerOutcome =
  /** A checked card, a plain answer, or a card Steerloom could not read. */
  | 'card'
  | 'text'
  | 'unreadable'
  /** The person is asked to allow board reading first. */
  | 'asked'
  | 'failed'

export interface AnswerStats {
  outcome: AnswerOutcome
  seconds: number
  /** Requests the AI provider answered. */
  modelCalls: number
  /** Requests sent again: a busy provider or a dropped connection. */
  retries: number
  /** Requests sent again with more room for the answer. */
  roomRetries: number
  /** Null when the provider reported no token counts at all. */
  tokens: {
    input: number
    /** Of the input, read from the provider's cache at its lower price. */
    cached: number
    cacheWritten: number
    output: number
  } | null
  reads: {
    calls: number
    items: number
    detailed: number
    searches: number
    code: number
  }
  /** Steerloom sent the model back to read the board before answering. */
  nudged: boolean
  /** The turn limit ended the reading. */
  outOfTurns: boolean
  /** On a card: reasons and options taken out, and reasons marked not checked. */
  removed: number
  unchecked: number
}

export function answerStats(input: {
  outcome: AnswerOutcome
  startedAt: number
  now?: number
  usage?: AiUsage
  agent?: Partial<AgentStats>
  card?: AnswerCard
}): AnswerStats {
  const { usage, agent, card } = input
  const reported = usage ? usage.requests - usage.unreported : 0
  return {
    outcome: input.outcome,
    seconds:
      Math.round(((input.now ?? Date.now()) - input.startedAt) / 100) / 10,
    modelCalls: usage?.requests ?? 0,
    retries: usage?.retries ?? 0,
    roomRetries: usage?.roomRetries ?? 0,
    tokens:
      usage && reported > 0
        ? {
            input: usage.inputTokens,
            cached: usage.cachedTokens,
            cacheWritten: usage.cacheWriteTokens,
            output: usage.outputTokens,
          }
        : null,
    reads: {
      calls: agent?.toolCalls ?? 0,
      items: agent?.items ?? 0,
      detailed: agent?.detailed ?? 0,
      searches: agent?.searches ?? 0,
      code: agent?.code ?? 0,
    },
    nudged: agent?.nudged ?? false,
    outOfTurns: agent?.outOfTurns ?? false,
    removed: card?.removed?.length ?? 0,
    unchecked:
      card?.reasons.filter((reason) => reason.kind === 'unchecked').length ?? 0,
  }
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** The log line: readable as it is, and each part easy to search for. */
export function statsLine(
  config: Pick<AiServerConfig, 'format' | 'model'>,
  stats: AnswerStats,
  status?: number,
): string {
  const reads = [
    stats.reads.items
      ? `${plural(stats.reads.items, 'item')}${stats.reads.detailed ? ` (${stats.reads.detailed} in detail)` : ''}`
      : '',
    stats.reads.searches
      ? plural(stats.reads.searches, 'search', 'searches')
      : '',
    stats.reads.code ? plural(stats.reads.code, 'code trail') : '',
  ].filter(Boolean)
  const notes = [
    stats.retries ? plural(stats.retries, 'retry', 'retries') : '',
    stats.roomRetries ? `${stats.roomRetries} for more room` : '',
    stats.nudged ? 'sent back to read' : '',
    stats.outOfTurns ? 'turn limit' : '',
    stats.removed ? `${stats.removed} removed` : '',
    stats.unchecked ? `${stats.unchecked} not checked` : '',
  ].filter(Boolean)
  return [
    `[ai] answer ${stats.outcome}${status ? ` ${status}` : ''}`,
    `${config.format} ${config.model || 'gateway default'}`,
    `${stats.seconds.toFixed(1)} s`,
    plural(stats.modelCalls, 'model call'),
    reads.length ? reads.join(', ') : 'no board reads',
    stats.tokens
      ? `${stats.tokens.input} tokens in (${stats.tokens.cached} cached), ${stats.tokens.output} out`
      : 'tokens not reported',
    ...notes,
  ].join(' · ')
}
