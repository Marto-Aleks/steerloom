import {
  answerCardText,
  boardWords,
  type AnswerCard,
  type AnswerOption,
  type AnswerReason,
  type AnswerSource,
} from '../../src/lib/ai/answer-card'
import type { AiReportContext } from '../../src/lib/ai/report-context'

/*
 * Turns the AI's answer into a checked card. The AI writes the fields; this
 * decides what the reader may trust: a reason about an item nobody read is
 * marked "not checked", an option with no item or no checkpoint is removed,
 * and the confidence comes from how many sources agree, whatever the AI
 * claimed. Anything that is not a usable card stays plain text.
 */

const LIMIT = { text: 400, reasons: 6, options: 3, list: 4, keys: 6 }

/** Advice that fits every team and so helps none. */
const GENERIC =
  /\b(hold a retro|run a retrospective|improve (team )?communication|align with stakeholders|best practices?|foster|synerg)/i

const KEY = /\b[A-Z][A-Z0-9]*-\d+\b/g
/** A pull request named by its repository: "acme/web#12". */
const PULL_REQUEST_REF = /\b[\w.-]+\/[\w.-]+#\d+\b/

/** A pull request named in text: "acme/web#12" or "#12". */
const PULL_REQUEST = /(?:[\w.-]+\/[\w.-]+)?#\d+\b/

export interface CardEvidence {
  /** Items the AI read on the board in this answer. */
  checked: ReadonlySet<string>
}

/** Every item key this briefing knows about, and those with a code trail. */
function knownKeys(context: AiReportContext) {
  const code = new Set([
    ...(context.codeLookup ?? []).map((entry) => entry.key),
    ...(context.pullRequests?.items ?? []).map((entry) => entry.key),
  ])
  const board = new Set([
    ...code,
    ...context.delayedWorkInProgress.map((item) => item.key),
    ...context.completedOutliers.map((item) => item.key),
    ...context.reenteredWorkInProgress.map((item) => item.key),
    ...(context.workInProgressByStage ?? []).flatMap((stage) =>
      stage.items.map((item) => item.key),
    ),
    ...(context.jiraEvidence?.issues ?? []).map((issue) => issue.key),
  ])
  return { code, board }
}

const text = (value: unknown): string =>
  typeof value === 'string' ? boardWords(value.trim()).slice(0, LIMIT.text) : ''

const keyList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((key): key is string => typeof key === 'string')
            .map((key) => key.trim().toUpperCase()),
        ),
      ].slice(0, LIMIT.keys)
    : []

const source = (value: unknown): AnswerSource =>
  value === 'Jira' || value === 'GitHub' ? value : 'Board'

/** The JSON object in an answer, with or without a code fence around it. */
export function readCardJson(answer: string): Record<string, unknown> | null {
  const trimmed = answer.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** True when an answer is meant as a card: the text is a JSON object. */
export function looksLikeCard(answer: string): boolean {
  const trimmed = answer.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('```json')
}

export function checkAnswerCard(
  answer: string,
  context: AiReportContext,
  evidence: CardEvidence,
): AnswerCard | null {
  const raw = readCardJson(answer)
  if (!raw) return null
  const verdict = text(raw.verdict)
  const next = text(raw.next)
  if (!verdict || !next) return null

  const known = knownKeys(context)
  const isKnown = (key: string) =>
    known.board.has(key) || evidence.checked.has(key)
  const removed: string[] = []

  const reasons: AnswerReason[] = []
  for (const item of Array.isArray(raw.reasons) ? raw.reasons : []) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const fact = text(entry.fact)
    if (!fact) continue
    const named = keyList(entry.keys)
    const keys = named.filter(isKnown)
    // Every item it is about is unknown here: drop it rather than show it.
    if (named.length && !keys.length) {
      removed.push(`a reason about ${named.join(', ')}: not on this board`)
      continue
    }
    const kind = entry.kind === 'rules-out' ? 'rules-out' : 'supports'
    // A fact that names a pull request came from the code, whatever the
    // model called its source; the confidence depends on getting it right.
    const from: AnswerSource = PULL_REQUEST_REF.test(fact)
      ? 'GitHub'
      : source(entry.source)
    // A claim from a source about an item that source was not read for.
    const unread =
      (from === 'Jira' && keys.some((key) => !evidence.checked.has(key))) ||
      (from === 'GitHub' && keys.some((key) => !known.code.has(key)))
    reasons.push({
      kind: unread ? 'unchecked' : kind,
      source: from,
      keys,
      fact,
    })
    if (reasons.length >= LIMIT.reasons) break
  }

  const rawOptions = Array.isArray(raw.options) ? raw.options : []
  const recommended = new Set(
    (Array.isArray(raw.recommended) ? raw.recommended : [raw.recommended])
      .filter((letter): letter is string => typeof letter === 'string')
      .map((letter) => letter.trim().toUpperCase().charAt(0)),
  )
  const options: AnswerOption[] = []
  rawOptions.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const entry = item as Record<string, unknown>
    const what = text(entry.what)
    const checkpoint = text(entry.checkpoint)
    if (!what) return
    const keys = keyList(entry.keys).filter(isKnown)
    const mentions = `${what} ${checkpoint}`
    const namesItem =
      keys.length > 0 ||
      (mentions.match(KEY) ?? []).some(isKnown) ||
      PULL_REQUEST.test(mentions)
    if (!checkpoint || !namesItem || GENERIC.test(mentions)) {
      removed.push(
        `option “${what}”: ${GENERIC.test(mentions) ? 'generic advice' : !checkpoint ? 'no checkpoint' : 'no item named'}`,
      )
      return
    }
    if (options.length >= LIMIT.options) return
    options.push({
      what,
      ...(text(entry.tradeOff) ? { tradeOff: text(entry.tradeOff) } : {}),
      checkpoint,
      keys,
      ...(recommended.has('ABC'.charAt(index)) ? { recommended: true } : {}),
    })
  })

  const list = (Array.isArray(raw.list) ? raw.list : [])
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const entry = item as Record<string, unknown>
      const line = text(entry.text)
      return line
        ? [{ keys: keyList(entry.keys).filter(isKnown), text: line }]
        : []
    })
    .slice(0, LIMIT.list)

  // Confidence is Steerloom's: likely only when two sources agree.
  const supports = [
    ...new Set(
      reasons
        .filter((reason) => reason.kind === 'supports')
        .map((reason) => reason.source),
    ),
  ]
  const confidence = supports.length >= 2 ? 'likely' : 'possible'
  const named = { Jira: 'Jira', GitHub: 'GitHub', Board: 'the board' }
  const basis =
    supports.length >= 2
      ? `${listed(supports.map((item) => named[item]))} agree`
      : supports.length === 1
        ? `only ${named[supports[0] ?? 'Board']} shows it`
        : 'nothing read confirms it yet'

  const why = text(raw.why)
  const checkpoint = text(raw.checkpoint)
  const question = text(raw.question)
  return {
    verdict,
    confidence,
    basis: basis.charAt(0).toUpperCase() + basis.slice(1),
    ...(supports.length ? { sources: supports } : {}),
    // A list of one only repeats the verdict.
    ...(list.length >= 2 ? { list } : {}),
    reasons,
    ...(options.length ? { options } : {}),
    ...(why && options.some((option) => option.recommended) ? { why } : {}),
    next,
    ...(checkpoint ? { checkpoint } : {}),
    ...(question ? { question } : {}),
    ...(removed.length ? { removed } : {}),
  }
}

/**
 * The finished answer: a checked card with its text, or the plain answer.
 * An answer that was meant as a card but cannot be read is never shown as
 * raw JSON.
 */
export function finishAnswer(
  answer: string,
  context: AiReportContext,
  evidence: CardEvidence,
): { message: string; card?: AnswerCard } {
  const card = checkAnswerCard(answer, context, evidence)
  if (card) return { message: answerCardText(card), card }
  if (looksLikeCard(answer))
    return {
      message:
        'Steerloom AI answered in a shape Steerloom could not read. Ask again, or ask a narrower question.',
    }
  return { message: answer }
}

/** "a and b", "a, b and c". */
function listed(items: string[]): string {
  return items.length <= 2
    ? items.join(' and ')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
