import { AskAiTag } from '../../components/AskAiTag'
import { Check, ChevronDown, Clock, CornerUpLeft } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import type {
  FlaggedItemOutcome,
  FlaggedReplay,
} from '../../lib/statistics/flagged-replay'
import { QUICK_MOVE_DAYS } from '../../lib/statistics/flagged-replay'
import { formatDays } from './format'
import { ItemKey } from './ItemKey'
import { stagger } from './motion'

/*
 * Did flagging work? The briefing of a week ago, replayed from the board
 * history, and what happened to each item it named since. Closed by default:
 * the headline is enough at a glance, and the list can be as long as the
 * board is stuck.
 */
export function FlaggedPanel({
  replay,
  onAsk,
}: {
  replay: FlaggedReplay
  onAsk: (prompt: string) => void
}) {
  const { items, movedQuickly, limitThen, limitNow } = replay
  const waiting = items.filter((item) => item.outcome === 'waiting')
  return (
    <details
      className="flagged sl-rise"
      aria-labelledby="flagged-title"
      style={stagger(1)}
    >
      <summary className="flagged__summary">
        <div className="flagged__header">
          <h2 id="flagged-title" className="flagged__title">
            Needed attention{' '}
            {replay.daysAgo === 7 ? 'last week' : `${replay.daysAgo} days ago`}
          </h2>
          <span className="flagged__count">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
          <UiIcon icon={ChevronDown} className="flagged__chevron" />
        </div>
        <p className="flagged__headline">
          <strong>
            {movedQuickly} of {items.length}
          </strong>{' '}
          moved within {QUICK_MOVE_DAYS === 2 ? 'two' : QUICK_MOVE_DAYS} days.
        </p>
      </summary>
      <ul className="flagged__list">
        {items.map((item) => (
          <li
            key={item.item}
            className="flagged__row"
            data-outcome={item.outcome}
          >
            <span className="flagged__mark" aria-hidden="true">
              <UiIcon icon={outcomeIcon(item)} />
            </span>
            <span className="flagged__what">
              <ItemKey
                itemKey={item.item}
                title={item.title}
                browseUrl={item.browseUrl}
              />
              <span className="flagged__reason">{item.flaggedAs}</span>
            </span>
            <span className="flagged__outcome">{item.detail}</span>
          </li>
        ))}
      </ul>
      <p className="flagged__trend">
        {trendSentence(limitThen, limitNow)}
        {waiting.length > 0 && (
          <>
            {' '}
            <button
              type="button"
              className="briefing-link"
              onClick={() => onAsk(raiseAgainPrompt(waiting, replay.daysAgo))}
            >
              <AskAiTag /> ·{' '}
              {waiting.length === 1
                ? `Raise ${waiting[0]!.item} again`
                : `Raise the ${waiting.length} still waiting`}{' '}
              <span aria-hidden="true">→</span>
            </button>
          </>
        )}
      </p>
    </details>
  )
}

function outcomeIcon(item: FlaggedItemOutcome) {
  switch (item.outcome) {
    case 'finished':
    case 'moved':
      return Check
    case 'waiting':
      return Clock
    case 'returned':
      return CornerUpLeft
  }
}

function trendSentence(limitThen: number | null, limitNow: number | null) {
  if (limitThen === null || limitNow === null)
    return 'The usual limit needs finished items to compare.'
  if (Math.abs(limitThen - limitNow) < 0.05)
    return `The usual limit is still ${formatDays(limitNow)}.`
  return `Since then the usual limit went from ${formatDays(limitThen)} to ${formatDays(limitNow)}.`
}

function raiseAgainPrompt(waiting: FlaggedItemOutcome[], daysAgo: number) {
  const keys = waiting.map(({ item }) => item)
  const list =
    keys.length === 1
      ? keys[0]
      : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`
  return `${list} needed attention ${daysAgo} days ago and ${keys.length === 1 ? 'has' : 'have'} not moved since. What has changed on ${keys.length === 1 ? 'it' : 'them'}, and what should I raise today?`
}
