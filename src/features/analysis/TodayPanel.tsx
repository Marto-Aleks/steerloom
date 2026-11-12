import { AskAiTag } from '../../components/AskAiTag'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ItemKey } from './ItemKey'
import {
  focusSignalAgentPrompt,
  focusSignalActionLabel,
  selectTodaySignals,
  type FocusSignal,
} from '../../lib/statistics/focus-now'
import type { WorkInProgressAgePoint } from '../../types'
import { externalHttpUrl, formatNumber } from './format'
import { ExternalLink } from 'lucide-react'
import { SpotIcon } from '../../components/SpotIcon'
import type { SpotName } from '../../components/spot-icons'
import { UiIcon } from '../../components/UiIcon'
import { stagger, useCountUpOncePerSession } from './motion'

/*
 * Status vocabulary is shared with the landing page and data-viz rules:
 * At risk, Bottleneck, Aging, Rework, On track. Signals that are not a flow
 * status (fewer items finishing, missing history) read as plain "Info".
 */
export type BriefingStatus =
  | 'risk'
  | 'bottleneck'
  | 'aging'
  | 'rework'
  | 'ok'
  | 'info'

const statusLabel: Record<BriefingStatus, string> = {
  risk: 'At risk',
  bottleneck: 'Bottleneck',
  aging: 'Aging',
  rework: 'Rework',
  ok: 'On track',
  info: 'Info',
}

const signalStatus: Record<FocusSignal['id'], BriefingStatus> = {
  'delayed-wip': 'risk',
  'wip-concentration': 'bottleneck',
  'owner-concentration': 'bottleneck',
  'no-owner': 'info',
  'active-reentry': 'rework',
  'throughput-drop': 'info',
  'start-finish': 'bottleneck',
  'insufficient-history': 'info',
  healthy: 'ok',
  'review-wait': 'bottleneck',
  'merged-not-done': 'info',
  'checks-failing': 'risk',
  'approved-not-merged': 'bottleneck',
  'large-pull-requests': 'info',
}

function statusOf(signal: FocusSignal): BriefingStatus {
  return signalStatus[signal.id]
}

/** Spot icon for each status: the tile colour carries the meaning. */
const statusSpot: Record<BriefingStatus, SpotName> = {
  risk: 'at-risk',
  bottleneck: 'bottleneck',
  aging: 'aging',
  rework: 'rework',
  ok: 'on-track',
  info: 'throughput',
}

export function StatusSpot({ status }: { status: BriefingStatus }) {
  return (
    <SpotIcon
      name={statusSpot[status]}
      size={40}
      animate
      className="signal-card__icon"
    />
  )
}

export function TodayPanel({
  signals,
  heroSignal,
  onAsk,
  baseDelay = 0,
}: {
  signals: FocusSignal[]
  /** The signal shown as the hero card above this list: counted, not repeated. */
  heroSignal?: FocusSignal
  onAsk: (prompt: string, fallback?: string) => void
  /** Entrance delay of the first card, so cards follow the hero. */
  baseDelay?: number
}) {
  const riskCount = [...(heroSignal ? [heroSignal] : []), ...signals].filter(
    ({ severity }) => severity !== 'healthy',
  ).length
  const { priorities, additional } = selectTodaySignals(signals)

  return (
    <section className="signals" aria-labelledby="today-title">
      <div className="signals__header">
        <div>
          <h2 id="today-title" className="signals__title">
            Needs a decision today
          </h2>
        </div>
        <span
          className="signals__count"
          data-status={riskCount ? 'bottleneck' : 'ok'}
        >
          {riskCount
            ? `${riskCount} ${riskCount === 1 ? 'signal' : 'signals'}`
            : 'Flow clear'}
        </span>
      </div>
      <div className="signals__grid">
        {priorities.map((signal, index) => (
          <SignalCard
            signal={signal}
            onAsk={onAsk}
            key={signal.id}
            style={stagger(index, undefined, baseDelay)}
          />
        ))}
      </div>
      {additional.length > 0 && (
        <details className="signals__more">
          <summary>
            {additional.length} lower-priority{' '}
            {additional.length === 1 ? 'signal' : 'signals'}
          </summary>
          <div className="signals__grid signals__grid--additional">
            {additional.map((signal) => (
              <SignalCard signal={signal} onAsk={onAsk} key={signal.id} />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

export function SignalCard({
  signal,
  onAsk,
  style,
}: {
  signal: FocusSignal
  onAsk: (prompt: string, fallback?: string) => void
  style?: CSSProperties
}) {
  const jiraFilterHref = externalHttpUrl(signal.jiraFilter?.href)
  const status = statusOf(signal)
  const actionLabel = focusSignalActionLabel(signal)

  return (
    <article
      className="signal-card sl-rise"
      data-severity={signal.severity}
      data-status={status}
      style={style}
    >
      <StatusSpot status={status} />
      <div className="signal-card__body">
        <div className="signal-card__line">
          <p className="signal-card__status">{statusLabel[status]}</p>
          <h3 className="signal-card__title">{signal.title}</h3>
          {signal.meta ? (
            <p className="signal-card__meta">{signal.meta}</p>
          ) : null}
        </div>
        <p className="signal-card__evidence">{signal.evidence}</p>
      </div>
      <div className="signal-card__actions">
        <button
          type="button"
          className="briefing-link"
          aria-label={`${actionLabel} with Steerloom AI`}
          onClick={() => onAsk(focusSignalAgentPrompt(signal), signal.action)}
        >
          <AskAiTag /> · {actionLabel} <span aria-hidden="true">→</span>
        </button>
        {jiraFilterHref && signal.jiraFilter ? (
          <a
            className="signal-card__external"
            href={jiraFilterHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${signal.jiraFilter.label} (opens in a new tab)`}
          >
            {signal.jiraFilter.label}
            <UiIcon icon={ExternalLink} size={16} />
          </a>
        ) : null}
      </div>
    </article>
  )
}

/**
 * The briefing's hero when work is past the usual limit: the top at-risk
 * signal, with the count as the hero number and the oldest items drawn
 * against the limit.
 */
export function HeroSignal({
  signal,
  items,
  activeCount,
  limitDays,
  onAsk,
  onShowAll,
  shown = 6,
  most = 12,
}: {
  signal: FocusSignal
  items: WorkInProgressAgePoint[]
  activeCount: number
  limitDays: number | null
  onAsk: (prompt: string, fallback?: string) => void
  /** Opens the full list of active work, when it is shown. */
  onShowAll?: () => void
  /** How many of the oldest items to draw at least. */
  shown?: number
  /** How many at most, when the box is tall enough for them. */
  most?: number
}) {
  const status = statusOf(signal)
  const count = useCountUpOncePerSession(items.length, { delay: 120 })
  const oldest = [...items]
    .sort(
      (left, right) => right.ageInSelectedColumns - left.ageInSelectedColumns,
    )
    .slice(0, Math.max(shown, most))
  // The box can be taller than its first rows (it matches the column next to
  // it): show as many more of the oldest items as fit whole, never fewer
  // than `shown`, never a row cut in half.
  const listRef = useRef<HTMLUListElement>(null)
  const [fit, setFit] = useState(Math.min(shown, oldest.length))
  const [floor, setFloor] = useState<number>()
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const rows = [...list.children] as HTMLElement[]
      if (!rows.length) return
      const top = list.getBoundingClientRect().top
      const bottom = (row: HTMLElement) =>
        row.getBoundingClientRect().bottom - top
      const least = Math.min(shown, rows.length)
      const needed = Math.ceil(bottom(rows[least - 1]!))
      setFloor((current) => (current === needed ? current : needed))
      const whole = rows.filter((row) => bottom(row) <= list.clientHeight + 1)
      setFit(Math.max(least, whole.length))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [shown, oldest.length])
  const scale = Math.max(
    1,
    limitDays ?? 0,
    ...oldest.map((item) => item.ageInSelectedColumns),
  )
  const limitShare = limitDays === null ? null : limitDays / scale
  const jiraFilterHref = externalHttpUrl(signal.jiraFilter?.href)
  const actionLabel = focusSignalActionLabel(signal)

  return (
    <article
      className="briefing-hero hero-signal sl-rise"
      data-status={status}
      aria-labelledby="hero-signal-title"
      style={stagger(0)}
    >
      <div className="hero-signal__head">
        <StatusSpot status={status} />
        <p className="hero-signal__status">{statusLabel[status]}</p>
      </div>
      <h2 id="hero-signal-title" className="hero-signal__title">
        <span className="hero-signal__number" aria-hidden="true">
          {count}
        </span>
        <span className="sr-only">{items.length}</span>
        <span className="hero-signal__unit">
          of {activeCount} active {activeCount === 1 ? 'item' : 'items'} past
          the usual{' '}
          {limitDays === null
            ? 'limit'
            : `${formatNumber(limitDays)} ${limitDays === 1 ? 'day' : 'days'}`}
        </span>
      </h2>
      {oldest.length > 0 && (
        <ul
          ref={listRef}
          className="hero-signal__items"
          aria-label={`Oldest items past the usual limit${limitDays === null ? '' : `; the line marks the usual ${formatNumber(limitDays)} days (P85)`}`}
          style={
            {
              ...(limitShare === null
                ? {}
                : { '--hero-limit': `${limitShare * 100}%` }),
              ...(floor ? { minHeight: floor } : {}),
            } as CSSProperties
          }
        >
          {oldest.map((item, index) => {
            const ratio =
              limitDays && limitDays > 0
                ? item.ageInSelectedColumns / limitDays
                : null
            return (
              <li
                key={item.item}
                data-hidden={index >= fit ? 'true' : undefined}
                aria-hidden={index >= fit ? true : undefined}
              >
                <span className="hero-signal__key">
                  <ItemKey
                    itemKey={item.item}
                    title={item.title}
                    browseUrl={item.browseUrl}
                  />
                  <small title={item.statusDetail}>{item.currentStatus}</small>
                </span>
                <span className="hero-signal__bar" aria-hidden="true">
                  <span
                    className="hero-signal__fill sl-grow-x"
                    style={
                      {
                        width: `${(item.ageInSelectedColumns / scale) * 100}%`,
                        // Where the usual limit falls inside this fill, so
                        // the colour turns at exactly the dashed line.
                        '--limit-in-fill':
                          limitShare === null
                            ? '0%'
                            : `${Math.min(100, (limitShare / (item.ageInSelectedColumns / scale)) * 100)}%`,
                        ...stagger(index, undefined, 180),
                      } as CSSProperties
                    }
                  />
                  {limitShare !== null && (
                    <span className="hero-signal__limit" />
                  )}
                </span>
                <span className="hero-signal__age">
                  <strong>
                    {formatNumber(item.ageInSelectedColumns)} days
                  </strong>
                  {ratio !== null && (
                    <small>
                      {ratio.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}
                      × usual
                    </small>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="hero-signal__actions">
        <button
          type="button"
          className="briefing-link"
          aria-label={`${actionLabel} with Steerloom AI`}
          onClick={() => onAsk(focusSignalAgentPrompt(signal), signal.action)}
        >
          <AskAiTag /> · {actionLabel} <span aria-hidden="true">→</span>
        </button>
        {onShowAll ? (
          <button type="button" className="briefing-link" onClick={onShowAll}>
            Review all {activeCount} active{' '}
            {activeCount === 1 ? 'item' : 'items'}
          </button>
        ) : null}
        {jiraFilterHref && signal.jiraFilter ? (
          <a
            className="signal-card__external"
            href={jiraFilterHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${signal.jiraFilter.label} (opens in a new tab)`}
          >
            {signal.jiraFilter.label}
            <UiIcon icon={ExternalLink} size={16} />
          </a>
        ) : null}
      </div>
    </article>
  )
}
