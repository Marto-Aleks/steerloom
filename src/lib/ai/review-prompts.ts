import type { AgingWorkItem } from '../statistics/aging-work'

export const REVIEW_SELECTION_LIMIT = 5

/*
 * A question is what the person would ask, in a sentence. The items' ages and
 * stages travel with the briefing data, and how to answer lives with the
 * assistant: a question that carried both said things twice, and sometimes
 * differently.
 */

/** "A, B and C", for up to the selection limit; the rest is counted. */
function namedItems(items: AgingWorkItem[]): string {
  const keys = items.slice(0, REVIEW_SELECTION_LIMIT).map((item) => item.item)
  const more = items.length - keys.length
  const list =
    keys.length <= 1
      ? (keys[0] ?? '')
      : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`
  return more > 0 ? `${list} (and ${more} more selected)` : list
}

/** Why the selected active items take as long as they do. */
export function selectedWorkPrompt(items: AgingWorkItem[]): string {
  return `Why ${items.length === 1 ? 'is' : 'are'} ${namedItems(items)} taking so long, and what should happen next?`
}

/** What needs a conversation today. No meeting assumed. */
export const raiseTodayPrompt = 'What should the team raise today?'

export const periodSummaryPrompt =
  'Draft a flow summary of at most 150 words for the selected reporting period. State the period first; when it spans several weeks, say how the last two complete calendar weeks compare, and do not call a longer comparison a weekly change. Include completed volume, cycle time, sample sizes, and current risks. Cite the supporting periods, metrics, and item keys. Separate observations from hypotheses, name missing evidence, and propose up to three team decisions with a measurable follow-up. Do not invent causes or forecasts.'

/** The question for one group of the code view, ready to send. */
export function codeGroupQuestion(
  group: { id: string; label: string; items: Array<{ key: string }> },
  stage: string,
): string {
  const keys = group.items.map((item) => item.key).join(', ')
  return group.id === 'none' || group.id === 'nocode'
    ? `${keys} sit in ${stage} without a linked pull request. What could they be waiting for, and what should I ask the team?`
    : `${keys}: their pull requests are ${group.label}. Why, and what should happen next?`
}

/** The question for the items where the board and the code disagree. */
export function codeMismatchQuestion(keys: string[]): string {
  return `${keys.join(', ')}: the board and the code disagree about where these items are. What does each mean, and what should happen next?`
}
