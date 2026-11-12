/*
 * The shape of a why or what-to-do answer: a short verdict and next step on
 * top, the reasoning (what supports it, what was ruled out, the options
 * weighed) underneath. The AI fills the fields; Steerloom checks them and
 * sets the confidence before the card is drawn.
 */

export type AnswerSource = 'Jira' | 'GitHub' | 'Board'

export interface AnswerReason {
  /** supports the verdict, rules another explanation out, or was not read. */
  kind: 'supports' | 'rules-out' | 'unchecked'
  source: AnswerSource
  keys: string[]
  fact: string
}

export interface AnswerOption {
  what: string
  tradeOff?: string
  checkpoint: string
  keys: string[]
  recommended?: boolean
}

export interface AnswerCard {
  verdict: string
  /** Set by Steerloom from the sources, never by the model. */
  confidence: 'likely' | 'possible'
  basis: string
  /** The sources behind the supporting reasons, for the badge. */
  sources?: AnswerSource[]
  /** What-to-raise answers: one line per cause. */
  list?: Array<{ keys: string[]; text: string }>
  reasons: AnswerReason[]
  options?: AnswerOption[]
  /** Why the recommended options, in one clause. */
  why?: string
  next: string
  checkpoint?: string
  question?: string
  /** What Steerloom took out before drawing, in plain words. */
  removed?: string[]
}

/** Code states in the board's words. */
const CODE_WORDS: Record<string, string> = {
  nocode: 'no linked code',
  coding: 'still coding',
  review: 'in review',
  approved: 'approved',
  merged: 'merged',
}

/**
 * The board's words, not the data's: field names the model copies from the
 * briefing are rewritten, and fractions of a day become hours.
 */
export function boardWords(value: string): string {
  return (
    value
      .replace(
        /\s*\((?:code(?: state)?)[:\s]*[“"']?(nocode|coding|review|approved|merged)[”"']?\)/gi,
        '',
      )
      .replace(
        /\bcode state(?:\s+is|:)?\s*[“"']?(nocode|no code|coding|review|approved|merged)[”"']?/gi,
        (_, state: string) =>
          CODE_WORDS[state.toLowerCase()] ?? 'no linked code',
      )
      .replace(/[“"']?\bnocode\b[”"']?/gi, 'no linked code')
      // "boardDisagrees between board state and code" says it twice; the
      // punctuation the model wrote after it is kept as it was.
      .replace(
        /\bboard\s?disagrees\b(?:\s*(?:=|:|is)?\s*true\b)?(?:\s*(?:between|on)\s+(?:the\s+)?board(?:\s+state)?\s+and\s+(?:the\s+)?code)?(\s*[;,:])?/gi,
        (_, mark?: string) =>
          `the board and the code disagree${mark ? mark.trim() : ''}`,
      )
      .replace(/\bcodeQuietDays\s*(?:=|:|is)?\s*(\d+)/gi, 'quiet for $1 days')
      .replace(
        /\bbranchLastCommitDaysAgo\s*(?:=|:|is)?\s*(\d+)/gi,
        'last commit $1 days ago',
      )
      .replace(/;\s*([.;,]|$)/g, '$1')
      .replace(/\b0\.(\d+)\s*days?\b/g, (_, digits: string) => {
        const hours = Math.round(Number(`0.${digits}`) * 24)
        return hours < 1
          ? 'under an hour'
          : `${hours} ${hours === 1 ? 'hour' : 'hours'}`
      })
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

/**
 * What a card being written already says: the verdict and the next step,
 * read from the unfinished JSON as it streams in. A field still being typed
 * comes back as far as it has got. Nothing else is shown before Steerloom has
 * checked the card.
 */
export function draftCard(partial: string): {
  verdict?: string
  next?: string
} {
  const field = (name: string) => {
    const match = new RegExp(
      `"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)`,
    ).exec(partial)
    if (!match?.[1]) return undefined
    // A half-written escape at the end is dropped, not shown.
    const raw = match[1].replace(/\\(u[0-9a-fA-F]{0,3})?$/, '')
    try {
      return boardWords(JSON.parse(`"${raw}"`) as string)
    } catch {
      return undefined
    }
  }
  const verdict = field('verdict')
  const next = field('next')
  return {
    ...(verdict ? { verdict } : {}),
    ...(next ? { next } : {}),
  }
}

const letters = 'ABC'

/** The confidence with its sources: "Likely · Jira + GitHub". */
export function confidenceLabel(card: AnswerCard): string {
  const level = card.confidence === 'likely' ? 'Likely' : 'Possible'
  const sources = card.sources ?? []
  if (!sources.length) return level
  return sources.length === 1
    ? `${level} · ${sources[0]} only`
    : `${level} · ${sources.join(' + ')}`
}

/**
 * The card as plain text: for copying, for the conversation the AI sees next
 * time, and for the test questions. Ruled-out lines are prefixed so a reader
 * (or a check) never takes them for the cause.
 */
export function answerCardText(card: AnswerCard): string {
  const keys = (list: string[]) => (list.length ? `${list.join(', ')}: ` : '')
  const lines = [
    card.verdict,
    `${confidenceLabel(card)}: ${card.basis}.`,
    ...(card.list ?? []).map((line) => `- ${keys(line.keys)}${line.text}`),
    `Next step: ${card.next}${card.checkpoint ? ` Check: ${card.checkpoint}` : ''}`,
    ...(card.question ? [card.question] : []),
    '',
    'Why:',
    ...card.reasons.map(
      (reason) =>
        `- ${
          reason.kind === 'rules-out'
            ? 'Ruled out: '
            : reason.kind === 'unchecked'
              ? 'Not checked: '
              : ''
        }${keys(reason.keys)}${reason.fact} (${reason.source})`,
    ),
    ...(card.options?.length
      ? [
          '',
          'Options:',
          ...card.options.map(
            (option, index) =>
              `${letters[index]}. ${option.what}${option.tradeOff ? ` ${option.tradeOff}` : ''} Check: ${option.checkpoint}${option.recommended ? ' (recommended)' : ''}`,
          ),
          ...(card.why ? [`Recommended because ${card.why}`] : []),
        ]
      : []),
  ]
  return lines.join('\n').trim()
}
