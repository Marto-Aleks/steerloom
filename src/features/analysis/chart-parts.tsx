import type { CSSProperties, ReactNode } from 'react'
import { ItemKey } from './ItemKey'
import { itemListLink } from '../../lib/workspace/item-links'
import { GlassCard } from '../../components/ui'
import type { CycleTimePoint, ThroughputPoint } from '../../types'
import { chartPalette, tooltipStyle } from './chart-theme'
import { externalHttpUrl, formatNumber, formatWeekLabel } from './format'
import { ExternalLink, X } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'

export function ThroughputTooltip({
  active,
  payload,
  partialWeeks,
}: {
  active?: boolean
  payload?: Array<{ payload: ThroughputPoint }>
  partialWeeks: ReadonlySet<string>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return (
    <div style={tooltipStyle} className="chart-tooltip">
      <p className="chart-tooltip__title">
        Week of {formatWeekLabel(point.week)}
      </p>
      <p className="chart-tooltip__value">
        {point.items.toLocaleString()} {point.items === 1 ? 'item' : 'items'}{' '}
        finished
      </p>
      {partialWeeks.has(point.week) ? (
        <p className="chart-tooltip__detail">
          Partial week: only days inside the period and before the refresh
          count.
        </p>
      ) : null}
    </div>
  )
}

export function ChartCard({
  visible = true,
  title,
  description,
  legend,
  children,
  footer,
  insight,
  className = '',
  style,
}: {
  visible?: boolean
  title: string
  /** One plain line under the title; most charts need none. */
  description?: string
  legend: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** The one thing to read off the chart, pinned above the plot. */
  insight?: string
  className?: string
  style?: CSSProperties
}) {
  if (!visible) return null
  return (
    <GlassCard
      className={`chart-card ${className}`.trim()}
      tone="solid"
      style={style}
    >
      <div className="data-card-heading">
        <div>
          <h2 className="chart-card__title">{title}</h2>
          {description ? (
            <p className="metadata-copy chart-card__description mt-1">
              {description}
            </p>
          ) : null}
        </div>
        <span className="chart-legend">
          {typeof legend === 'string' ? (
            <span
              className="chart-legend__dot"
              style={{ backgroundColor: chartPalette.primary }}
            />
          ) : null}
          {legend}
        </span>
      </div>
      {insight ? <p className="chart-card__insight">{insight}</p> : null}
      <div
        role="img"
        aria-label={`${title}${insight ? `: ${insight}` : ''}${description ? `. ${description}` : ''}`}
        className="chart-card__plot"
      >
        {children}
      </div>
      {footer ? <div className="chart-card__footer">{footer}</div> : null}
    </GlassCard>
  )
}

/**
 * A tooltip someone froze by clicking its bar: the same facts, kept in
 * place, with the item count as a link that opens those items in the
 * tracker. Closes with its ×, Escape, or a click elsewhere on the chart.
 */
export function PinnedTooltip({
  x,
  y,
  title,
  count,
  countLabel,
  details,
  items,
  onClose,
}: {
  x: number
  y: number
  title: string
  count: number
  /** What the count is, such as "finished" or "(90%)". */
  countLabel: string
  details: ReactNode[]
  items: CycleTimePoint[]
  onClose: () => void
}) {
  const list = itemListLink(items)
  const noun = count === 1 ? 'item' : 'items'
  return (
    <div
      role="dialog"
      aria-label={`${title}, pinned`}
      className="chart-tooltip chart-tooltip--pinned"
      style={{ ...tooltipStyle, left: x, top: y }}
    >
      <div className="chart-tooltip__row">
        <p className="chart-tooltip__title">{title}</p>
        <button
          type="button"
          className="chart-tooltip__close"
          onClick={onClose}
          aria-label="Unpin"
        >
          <UiIcon icon={X} size={14} />
        </button>
      </div>
      <p className="chart-tooltip__value">
        {list ? (
          <a
            href={list.href}
            target="_blank"
            rel="noopener noreferrer"
            className="chart-tooltip__link"
            aria-label={`Open ${list.count === count ? 'the' : `the first ${list.count} of`} ${count} ${noun} in ${list.tracker} (opens in a new tab)`}
          >
            {count.toLocaleString()} {noun}
            <UiIcon icon={ExternalLink} size={14} />
          </a>
        ) : (
          <>
            {count.toLocaleString()} {noun}
          </>
        )}{' '}
        {countLabel}
      </p>
      {details}
      {!list && items.some((item) => item.browseUrl) && (
        <p className="chart-tooltip__detail chart-tooltip__keys">
          {items.slice(0, 8).map((item, index) => (
            <span key={`${item.item}-${item.sequence}`}>
              {index > 0 ? ', ' : ''}
              <ItemKey
                itemKey={item.item}
                title={item.title}
                browseUrl={item.browseUrl}
              />
            </span>
          ))}
          {items.length > 8 ? ` and ${items.length - 8} more` : ''}
        </p>
      )}
    </div>
  )
}

export function EmptyChart() {
  return (
    <div className="empty-chart surface-inset">
      <div>
        <p className="empty-chart__title">Nothing finished yet</p>
        <p className="empty-chart__copy">
          Measure stages that items have already left, or choose a longer
          period.
        </p>
      </div>
    </div>
  )
}

export function CycleTimeTooltip({
  active,
  payload,
  percentile85,
}: {
  active?: boolean
  payload?: Array<{ payload: CycleTimePoint }>
  percentile85: number | null
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div style={tooltipStyle} className="chart-tooltip">
      <p className="chart-tooltip__title">{point.item}</p>
      {point.title && <p className="chart-tooltip__detail">{point.title}</p>}
      <p className="chart-tooltip__detail">
        {point.cycleStart} → {point.cycleEnd}
      </p>
      <p className="chart-tooltip__value">
        {formatNumber(point.cycleTime)} days counted in selected columns
      </p>
      {percentile85 !== null && point.cycleTime > percentile85 ? (
        <p className="chart-tooltip__percentile">
          Past the usual limit of {formatNumber(percentile85)} days (P85)
        </p>
      ) : null}
    </div>
  )
}

export function ReferencePill({
  viewBox,
  value,
  color = chartPalette.percentile,
}: {
  viewBox?: { x?: number; y?: number; width?: number; height?: number }
  value: string
  color?: string
}) {
  if (!viewBox) return null
  const { x = 0, y = 0, width = 0 } = viewBox
  const pillWidth = Math.round(value.length * 6.4 + 18)
  const pillHeight = 20
  const vertical = width === 0
  const left = vertical ? x - pillWidth / 2 : x + width - pillWidth
  const top = vertical ? y - pillHeight - 4 : y - pillHeight - 4
  return (
    <g className="chart-pill">
      <rect
        x={left}
        y={top}
        width={pillWidth}
        height={pillHeight}
        rx={pillHeight / 2}
        style={{ fill: chartPalette.surface, stroke: color }}
        strokeWidth={1}
      />
      <text
        x={left + pillWidth / 2}
        y={top + pillHeight / 2}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fill: color }}
        fontSize={11}
        fontWeight={650}
      >
        {value}
      </text>
    </g>
  )
}

export function CompletedOutlierLinks({ items }: { items: CycleTimePoint[] }) {
  return (
    <div className="completed-outliers">
      <p>Finished items past the usual limit (P85)</p>
      <ul>
        {items.map((item) => {
          const href = externalHttpUrl(item.browseUrl)
          return (
            <li key={`${item.item}-${item.sequence}`}>
              <ItemKey
                itemKey={item.item}
                title={item.title}
                browseUrl={item.browseUrl}
              >
                <span>{formatNumber(item.cycleTime)}d</span>
                {href ? <UiIcon icon={ExternalLink} size={16} /> : null}
              </ItemKey>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
