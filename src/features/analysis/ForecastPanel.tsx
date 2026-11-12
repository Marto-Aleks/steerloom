import { AskAiTag } from '../../components/AskAiTag'
import type { CSSProperties } from 'react'
import type { ThroughputForecastResult } from '../../lib/statistics/forecast'
import { stagger, useCountUpOncePerSession } from './motion'

const LEVELS = [
  { key: 'p50', label: '50%' },
  { key: 'p70', label: '70%' },
  { key: 'p85', label: '85%' },
  { key: 'p95', label: '95%' },
] as const

const DAY = 86_400_000

/**
 * Monte Carlo forecast for the current work: when it could finish, at four
 * confidence levels, plotted on a day axis from today. As the briefing hero
 * the 85% date leads in display type; otherwise it sits below the signals.
 */
export function ForecastPanel({
  result,
  onAsk,
  hero = false,
  style,
}: {
  result: ThroughputForecastResult
  onAsk: (prompt: string) => void
  /** Rendered as the briefing's hero element. */
  hero?: boolean
  style?: CSSProperties
}) {
  const className = `forecast sl-rise${hero ? ' briefing-hero' : ''}`
  const confidence = useCountUpOncePerSession(85, {
    delay: 120,
    enabled: hero,
  })

  if ('unavailable' in result) {
    return (
      <section
        className={className}
        data-variant={hero ? 'hero' : 'standard'}
        aria-labelledby="forecast-title"
        style={style ?? stagger(0)}
      >
        <h2 id="forecast-title" className="forecast__title">
          When current work could finish
        </h2>
        <p className="forecast__unavailable">
          No forecast yet: {result.unavailable}
        </p>
      </section>
    )
  }

  const { basis, finishCurrentWork, nextTwoWeeks } = result.forecast
  const today = Date.parse(`${basis.sampleEndExclusive}T00:00:00Z`)
  const daysUntil = (date: string) =>
    Math.round((Date.parse(`${date}T00:00:00Z`) - today) / DAY)
  const marks = finishCurrentWork
    ? LEVELS.flatMap(({ key, label }) => {
        const date = finishCurrentWork[key]
        return date ? [{ key, label, date, days: daysUntil(date) }] : []
      })
    : []
  const span = Math.max(14, ...marks.map((mark) => mark.days)) * 1.08
  const headline = finishCurrentWork?.p85
    ? `${confidence}% likely by ${formatDay(finishCurrentWork.p85)}`
    : finishCurrentWork
      ? 'Not likely within a year at the current pace'
      : 'No active work to finish'

  return (
    <section
      className={className}
      data-variant={hero ? 'hero' : 'standard'}
      aria-labelledby="forecast-title"
      style={style ?? stagger(0)}
    >
      <div className="forecast__summary">
        <h2 id="forecast-title" className="forecast__title">
          When current work could finish
        </h2>
        <p className="forecast__headline">{headline}</p>
        {finishCurrentWork && (
          <p className="forecast__chance">
            <strong>{finishCurrentWork.withinTwoWeeksPercent}%</strong> chance
            all {finishCurrentWork.items} active{' '}
            {finishCurrentWork.items === 1 ? 'item finishes' : 'items finish'}{' '}
            within 14 days
          </p>
        )}
      </div>
      <div className="forecast__visual">
        {marks.length > 0 && (
          <div className="forecast__axis" aria-hidden="true">
            <span className="forecast__track" />
            <span className="forecast__today">Today</span>
            {marks.map((mark, index) => (
              <span
                key={mark.key}
                className="forecast__runner"
                data-level={mark.key}
                style={
                  {
                    '--forecast-position': mark.days / span,
                    '--forecast-delay': `${index * 60}ms`,
                  } as CSSProperties
                }
              >
                <span className="forecast__mark" data-level={mark.key}>
                  <span className="forecast__mark-label">{mark.label}</span>
                  <span className="forecast__dot" />
                </span>
              </span>
            ))}
          </div>
        )}
        {marks.length > 0 && (
          <ul
            className="forecast__dates"
            aria-label="Finish dates by confidence"
          >
            {marks.map((mark) => (
              <li key={mark.key} data-level={mark.key}>
                <span className="forecast__dates-level">
                  {mark.label} likely
                </span>
                <span className="forecast__dates-day">
                  {formatDay(mark.date, false)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="forecast__next">
        <strong>Next 14 days:</strong> at least {nextTwoWeeks.atLeastItemsP85}{' '}
        {nextTwoWeeks.atLeastItemsP85 === 1 ? 'item' : 'items'} finish (85%),
        about {nextTwoWeeks.itemsP50} (50%), including current work.
      </p>
      <details className="forecast__method">
        <summary>How it&apos;s calculated</summary>
        <p className="forecast__basis">
          The last {basis.sampledDays} days, {basis.completedItems} finished
          items, sampled 10,000 times to see how long{' '}
          {finishCurrentWork ? finishCurrentWork.items : 'the current'}{' '}
          {finishCurrentWork?.items === 1 ? 'item' : 'items'} would take.
          {finishCurrentWork?.p85
            ? ` In 85 of every 100 replays the work was done by ${formatDay(finishCurrentWork.p85, false)}${finishCurrentWork.p50 ? `; in half of them by ${formatDay(finishCurrentWork.p50, false)}` : ''}.`
            : ''}{' '}
          It assumes the coming weeks look like those {basis.sampledDays} days,
          and it doesn&apos;t know which items are blocked.
        </p>
      </details>
      <button
        type="button"
        className="briefing-link forecast__ask"
        onClick={() =>
          onAsk(
            'Explain the forecast for our current work: what the dates mean, what could make them slip, and what we should do to land the work.',
          )
        }
      >
        <AskAiTag /> what could change this <span aria-hidden="true">→</span>
      </button>
    </section>
  )
}

function formatDay(date: string, weekday = true): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    ...(weekday ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
