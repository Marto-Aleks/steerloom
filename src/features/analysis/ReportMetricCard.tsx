import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp, MoveRight } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import type { FlowMetricId } from '../../lib/statistics/flow-evidence'
import { sparklinePath, type TrendDescriptor } from './format'

export function Sparkline({
  values,
  stroke,
  className = '',
}: {
  values: number[]
  stroke: string
  className?: string
}) {
  const path = sparklinePath(values)
  if (!path) return null
  return (
    <svg
      className={`report-sparkline ${className}`.trim()}
      viewBox="0 0 200 44"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="sl-draw"
        pathLength="1"
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

type MetricCardTone = 'blue' | 'warn'

const sparklineStroke: Record<MetricCardTone, string> = {
  blue: 'var(--chart-primary)',
  warn: 'var(--chart-orange)',
}

/**
 * One compact metric in the briefing's metrics row: label, the number in the
 * display face with its unit, the change in words, the sample it rests on
 * and a way to see how it was calculated.
 */
export function MetricCard({
  visible = true,
  metric,
  label,
  value,
  unit,
  detail,
  tone = 'blue',
  trend,
  sparkline,
  onExplain,
  href,
  howLabel = 'How it’s calculated',
  style,
}: {
  visible?: boolean
  /** Opens the evidence view for this metric when clicked. */
  metric?: FlowMetricId
  label: string
  value: string
  /** Shown after the big number in a smaller face, e.g. "days". */
  unit?: string
  /** Sample size or time range the number rests on. */
  detail: string
  tone?: MetricCardTone
  trend?: TrendDescriptor | null
  /** A real series to draw as a sparkline; omitted when fewer than 2 points. */
  sparkline?: number[]
  onExplain?: (metric: FlowMetricId) => void
  /** In-page link used instead of the evidence view. */
  href?: string
  howLabel?: string
  style?: CSSProperties
}) {
  if (!visible) return null
  const spoken = unit ? `${value} ${unit}` : value
  const summary = `${label}: ${spoken}${trend ? `. ${trend.description}` : ''}. ${detail}`
  const content = (
    <>
      <span className="briefing-metric__label">{label}</span>
      <span className="briefing-metric__value">
        <span className="briefing-metric__number">{value}</span>
        {unit ? <span className="briefing-metric__unit">{unit}</span> : null}
      </span>
      {trend ? (
        <span
          className="briefing-metric__trend"
          data-tone={trend.tone}
          aria-hidden="true"
        >
          <UiIcon
            icon={
              trend.direction === 'up'
                ? ArrowUp
                : trend.direction === 'down'
                  ? ArrowDown
                  : MoveRight
            }
            size={16}
            className="briefing-metric__trend-arrow"
          />
          {trend.label}
        </span>
      ) : null}
      {sparkline && sparkline.length > 1 ? (
        <Sparkline values={sparkline} stroke={sparklineStroke[tone]} />
      ) : null}
      <span className="briefing-metric__how" aria-hidden="true">
        {howLabel}
      </span>
    </>
  )
  if (href) {
    return (
      <a
        className="briefing-metric sl-rise"
        data-tone={tone}
        href={href}
        style={style}
        aria-label={`${summary}. ${howLabel}`}
      >
        {content}
      </a>
    )
  }
  return (
    <button
      type="button"
      className="briefing-metric sl-rise"
      data-tone={tone}
      style={style}
      aria-label={`Explain ${summary}`}
      onClick={() => {
        if (metric) onExplain?.(metric)
      }}
    >
      {content}
    </button>
  )
}
