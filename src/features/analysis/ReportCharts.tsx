import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CycleTimePoint, FlowMetrics } from '../../types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { weekStart } from '../../lib/statistics'
import { chartPalette } from './chart-theme'
import {
  ChartCard,
  CompletedOutlierLinks,
  CycleTimeTooltip,
  EmptyChart,
  PinnedTooltip,
  ReferencePill,
  ThroughputTooltip,
} from './chart-parts'
import { formatDays, formatNumber, formatWeekLabel } from './format'
import { chartAnimation, stagger } from './motion'

export interface ReportChartsProps {
  metrics: FlowMetrics
  completedOutliers: CycleTimePoint[]
  partialWeeks: Set<string>
  animate: boolean
}

/**
 * The briefing's two trend charts, side by side: items finished each week and
 * how long each finished item took. Loaded on demand: the chart library is the
 * largest part of the bundle, and every chart sits below the headline,
 * signals and metric cards, which render first.
 */
export function ReportCharts({
  metrics,
  completedOutliers,
  partialWeeks,
  animate,
}: ReportChartsProps) {
  // A clicked bar freezes its tooltip where it is (hover stays as it is):
  // the frozen copy is ours, placed where Recharts had drawn the hover one.
  const [pinnedWeek, setPinnedWeek] = useState<Pin | null>(null)
  const throughputPlot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pinnedWeek) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPinnedWeek(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinnedWeek])
  const itemsByWeek = useMemo(() => {
    const groups = new Map<string, CycleTimePoint[]>()
    for (const point of metrics.cycleTimes) {
      const week = weekStart(point.cycleEnd)
      groups.set(week, [...(groups.get(week) ?? []), point])
    }
    return groups
  }, [metrics.cycleTimes])
  const pinnedWeekPoint = metrics.weeklyThroughput.find(
    ({ week }) => week === pinnedWeek?.key,
  )
  const cycleTimeExitLabels = new Map(
    metrics.cycleTimes.map(({ sequence, completedLabel }) => [
      sequence,
      completedLabel,
    ]),
  )
  const runningWeek = metrics.weeklyThroughput.some(({ week }) =>
    partialWeeks.has(week),
  )
  const p85 = metrics.percentile85CycleTime
  const bestWeek = metrics.weeklyThroughput
    .filter(({ week }) => !partialWeeks.has(week))
    .reduce<
      (typeof metrics.weeklyThroughput)[number] | null
    >((best, point) => (!best || point.items > best.items ? point : best), null)

  return (
    <div className="report-charts">
      <ChartCard
        className="sl-rise"
        style={stagger(6)}
        title="Items finished each week"
        insight={
          bestWeek
            ? `Best full week: ${bestWeek.items} ${bestWeek.items === 1 ? 'item' : 'items'}, week of ${formatWeekLabel(bestWeek.week)}`
            : undefined
        }
        legend={
          runningWeek
            ? 'Items finished · hatched: week still running'
            : 'Items finished'
        }
      >
        <div ref={throughputPlot} className="chart-pinnable">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={metrics.weeklyThroughput}
              margin={{ top: 10, right: 8, left: -16, bottom: 0 }}
              onClick={(state, event) => {
                // The whole column is the target, not only the bar: a
                // two-item bar is a sliver, its column is not.
                const week = metrics.weeklyThroughput[columnIndex(state)]?.week
                if (!week) {
                  setPinnedWeek(null)
                  return
                }
                setPinnedWeek((current) =>
                  current?.key === week
                    ? null
                    : pinAt(week, throughputPlot.current, event),
                )
              }}
            >
              <defs>
                <linearGradient
                  id="throughputBarFill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    style={{ stopColor: 'var(--brand-cyan)' }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: 'var(--chart-primary)' }}
                  />
                </linearGradient>
                <pattern
                  id="partialWeekFill"
                  patternUnits="userSpaceOnUse"
                  width="8"
                  height="8"
                  patternTransform="rotate(45)"
                >
                  <rect
                    width="8"
                    height="8"
                    style={{
                      fill: 'var(--chart-primary)',
                      fillOpacity: 0.16,
                    }}
                  />
                  <rect
                    width="3"
                    height="8"
                    style={{ fill: 'var(--chart-primary)', fillOpacity: 0.6 }}
                  />
                </pattern>
              </defs>
              <CartesianGrid
                strokeDasharray="3 4"
                vertical={false}
                stroke={chartPalette.grid}
              />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11, fill: chartPalette.label }}
                tickLine={false}
                axisLine={false}
                minTickGap={22}
                tickFormatter={formatWeekLabel}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: chartPalette.label }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                active={pinnedWeek ? false : undefined}
                cursor={{
                  fill: 'var(--surface-muted)',
                  stroke: 'var(--separator-soft)',
                  strokeWidth: 1,
                }}
                content={<ThroughputTooltip partialWeeks={partialWeeks} />}
              />
              <Bar
                dataKey="items"
                fill="url(#throughputBarFill)"
                radius={[6, 6, 2, 2]}
                maxBarSize={54}
                isAnimationActive={animate}
                {...chartAnimation}
              >
                {metrics.weeklyThroughput.map((point) => (
                  <Cell
                    key={point.week}
                    fill={
                      partialWeeks.has(point.week)
                        ? 'url(#partialWeekFill)'
                        : 'url(#throughputBarFill)'
                    }
                    stroke={
                      point.week === pinnedWeek?.key
                        ? chartPalette.percentile
                        : partialWeeks.has(point.week)
                          ? chartPalette.primary
                          : undefined
                    }
                    strokeWidth={point.week === pinnedWeek?.key ? 2 : undefined}
                    strokeDasharray={
                      partialWeeks.has(point.week) &&
                      point.week !== pinnedWeek?.key
                        ? '4 3'
                        : undefined
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {pinnedWeek && pinnedWeekPoint && (
            <PinnedTooltip
              x={pinnedWeek.x}
              y={pinnedWeek.y}
              title={`Week of ${formatWeekLabel(pinnedWeekPoint.week)}`}
              count={pinnedWeekPoint.items}
              countLabel="finished"
              details={
                partialWeeks.has(pinnedWeekPoint.week)
                  ? [
                      <p key="partial" className="chart-tooltip__detail">
                        Partial week: only days inside the period and before the
                        refresh count.
                      </p>,
                    ]
                  : []
              }
              items={itemsByWeek.get(pinnedWeekPoint.week) ?? []}
              onClose={() => setPinnedWeek(null)}
            />
          )}
        </div>
      </ChartCard>
      <ChartCard
        className="sl-rise"
        style={stagger(8)}
        title="How long each finished item took"
        insight={
          p85 === null || !metrics.cycleTimeItemCount
            ? undefined
            : `${completedOutliers.length} of ${metrics.cycleTimes.length} took longer than the usual ${formatDays(p85)}`
        }
        legend="One dot per item"
        footer={
          completedOutliers.length ? (
            <CompletedOutlierLinks items={completedOutliers} />
          ) : null
        }
      >
        {metrics.cycleTimeItemCount ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 18, left: 8, bottom: 26 }}>
              <CartesianGrid
                strokeDasharray="3 4"
                vertical={false}
                stroke={chartPalette.grid}
              />
              <XAxis
                type="number"
                dataKey="sequence"
                domain={['dataMin', 'dataMax']}
                allowDecimals={false}
                tick={{ fontSize: 11, fill: chartPalette.label }}
                tickLine={false}
                axisLine={false}
                minTickGap={18}
                tickFormatter={(value: number) =>
                  cycleTimeExitLabels.get(Math.round(value)) ?? ''
                }
                label={{
                  value: 'Items in finishing order',
                  position: 'insideBottom',
                  offset: -16,
                  fontSize: 11,
                  fill: chartPalette.label,
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: chartPalette.label }}
                tickLine={false}
                axisLine={false}
                label={{
                  value: 'Time taken, days',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 2,
                  fontSize: 11,
                  fill: chartPalette.label,
                }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 4' }}
                content={
                  <CycleTimeTooltip
                    percentile85={metrics.percentile85CycleTime}
                  />
                }
              />
              <ReferenceLine
                y={metrics.percentile85CycleTime ?? 0}
                stroke={chartPalette.percentile}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={
                  <ReferencePill
                    value={`Usual limit ${formatNumber(p85 ?? 0)} days`}
                  />
                }
              />
              <Scatter
                data={metrics.cycleTimes}
                dataKey="cycleTime"
                r={4}
                isAnimationActive={animate}
                {...chartAnimation}
              >
                {metrics.cycleTimes.map((point) => (
                  <Cell
                    key={`${point.item}-${point.sequence}`}
                    fill={
                      metrics.percentile85CycleTime !== null &&
                      point.cycleTime > metrics.percentile85CycleTime
                        ? chartPalette.late
                        : chartPalette.primary
                    }
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>
    </div>
  )
}

/** A frozen tooltip: which bar, and where the hover tooltip was drawn. */
interface Pin {
  key: string
  x: number
  y: number
}

/**
 * Where to freeze the tooltip: exactly where Recharts drew the hover one,
 * read from its wrapper; or, without one (keyboard), beside the click.
 */
function pinAt(key: string, plot: HTMLDivElement | null, event: unknown): Pin {
  const wrapper = plot?.querySelector<HTMLElement>('.recharts-tooltip-wrapper')
  const match = /translate(?:3d)?\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(
    wrapper?.style.transform ?? '',
  )
  if (match && wrapper?.style.visibility !== 'hidden')
    return { key, x: Number(match[1]), y: Number(match[2]) }
  const box = plot?.getBoundingClientRect()
  const at = (event ?? {}) as { clientX?: number; clientY?: number }
  return {
    key,
    x: Math.max(0, (at.clientX ?? 0) - (box?.left ?? 0) + 12),
    y: Math.max(0, (at.clientY ?? 0) - (box?.top ?? 0) - 12),
  }
}

/** Which column a chart click landed in, or -1 outside the columns. */
function columnIndex(state: {
  isTooltipActive: boolean
  activeTooltipIndex: number | string | null | undefined
}): number {
  if (
    !state.isTooltipActive ||
    state.activeTooltipIndex === undefined ||
    state.activeTooltipIndex === null
  )
    return -1
  const index = Number(state.activeTooltipIndex)
  return Number.isInteger(index) ? index : -1
}
