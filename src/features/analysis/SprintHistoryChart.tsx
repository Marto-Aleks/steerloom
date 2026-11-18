import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ClosedSprintView, SprintRef } from '../../lib/statistics/sprint'
import { ChartCard, PinnedTooltip } from './chart-parts'
import { columnIndex, pinAt, type Pin } from './chart-pin'
import { chartPalette, tooltipStyle } from './chart-theme'
import { formatNumber } from './format'
import { ItemKey } from './ItemKey'
import { chartAnimation, stagger } from './motion'

/*
 * The last sprints, planned against finished, as the Kanban briefing's
 * "Items finished each week": hover a sprint for its numbers, click it to
 * pin them with its finished items one click from Jira, and what did not
 * finish, came in late or went out. Escape or the × unpins. Loaded on
 * demand with the other charts: the chart library is the bundle's largest
 * part.
 */

interface Row {
  id: string
  name: string
  /** Planned items that finished, planned that did not, items added. */
  finishedPlanned: number
  open: number
  added: number
  view: ClosedSprintView
}

export default function SprintHistoryChart({
  history,
  unit,
  footer,
}: {
  history: ClosedSprintView[]
  unit: 'points' | 'items'
  /** Under the chart: the next sprint's plan and the AI question. */
  footer?: ReactNode
}) {
  const [pinned, setPinned] = useState<Pin | null>(null)
  const plot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pinned) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned])
  const rows: Row[] = history.map((view) => ({
    id: view.sprint.id,
    name: view.sprint.name,
    finishedPlanned: view.finishedPlanned,
    open: view.planned.length - view.finishedPlanned,
    added: view.added.length,
    view,
  }))
  const planned = history.reduce((sum, view) => sum + view.planned.length, 0)
  const finished = history.reduce((sum, view) => sum + view.finishedPlanned, 0)
  const added = Math.round(
    history.reduce((sum, view) => sum + view.added.length, 0) / history.length,
  )
  const pinnedRow = rows.find((row) => row.id === pinned?.key)
  const short = (name: string) => name.replace(/^sprint\s+/i, '')
  return (
    <ChartCard
      className="sl-rise sprint-history-chart"
      style={stagger(4)}
      title={`Last ${history.length} ${history.length === 1 ? 'sprint' : 'sprints'}`}
      insight={
        planned
          ? `Finished ${Math.round((finished / planned) * 100)}% of planned work${added ? ` · about ${added} added mid-sprint` : ''}`
          : undefined
      }
      footer={footer}
      legend={
        <>
          <span className="chart-legend__dot" data-part="finished" />
          finished
          <span className="chart-legend__dot" data-part="open" />
          planned, not finished
          <span className="chart-legend__dot" data-part="added" />
          added
        </>
      }
    >
      <div ref={plot} className="chart-pinnable">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 10, right: 8, left: -16, bottom: 0 }}
            onClick={(state, event) => {
              // The whole column is the target, as on the weekly chart.
              const row = rows[columnIndex(state)]
              if (!row) {
                setPinned(null)
                return
              }
              setPinned((current) =>
                current?.key === row.id
                  ? null
                  : pinAt(row.id, plot.current, event),
              )
            }}
          >
            <defs>
              <linearGradient
                id="sprintFinishedFill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" style={{ stopColor: 'var(--brand-cyan)' }} />
                <stop
                  offset="100%"
                  style={{ stopColor: 'var(--chart-primary)' }}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 4"
              vertical={false}
              stroke={chartPalette.grid}
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: chartPalette.label }}
              tickLine={false}
              axisLine={false}
              tickFormatter={short}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: chartPalette.label }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              active={pinned ? false : undefined}
              cursor={{
                fill: 'var(--surface-muted)',
                stroke: 'var(--separator-soft)',
                strokeWidth: 1,
              }}
              content={<SprintTooltip unit={unit} />}
            />
            <Bar
              dataKey="finishedPlanned"
              stackId="sprint"
              fill="url(#sprintFinishedFill)"
              maxBarSize={54}
              {...chartAnimation}
            >
              {rows.map((row) => (
                <Cell
                  key={row.id}
                  stroke={
                    row.id === pinned?.key ? chartPalette.percentile : undefined
                  }
                  strokeWidth={row.id === pinned?.key ? 2 : undefined}
                />
              ))}
            </Bar>
            <Bar
              dataKey="open"
              stackId="sprint"
              fill="var(--separator)"
              maxBarSize={54}
              {...chartAnimation}
            />
            <Bar
              dataKey="added"
              stackId="sprint"
              fill="color-mix(in srgb, var(--chart-orange) 22%, transparent)"
              stroke="var(--chart-orange)"
              strokeWidth={1.5}
              radius={[6, 6, 0, 0]}
              maxBarSize={54}
              {...chartAnimation}
            />
          </BarChart>
        </ResponsiveContainer>
        {pinned && pinnedRow && (
          <PinnedTooltip
            x={pinned.x}
            y={pinned.y}
            title={pinnedRow.name}
            count={pinnedRow.view.finished.length}
            countLabel="finished"
            details={details(pinnedRow.view, unit)}
            items={pinnedRow.view.finished.map(asPoint)}
            onClose={() => setPinned(null)}
          />
        )}
      </div>
    </ChartCard>
  )
}

function SprintTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean
  payload?: Array<{ payload: Row }>
  unit: 'points' | 'items'
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const { view } = row
  return (
    <div style={tooltipStyle} className="chart-tooltip">
      <p className="chart-tooltip__title">{row.name}</p>
      <p className="chart-tooltip__value">
        {view.finishedPlanned} of {view.planned.length} planned finished
      </p>
      {view.added.length > 0 && (
        <p className="chart-tooltip__detail">
          {view.added.length} added mid-sprint
        </p>
      )}
      {unit === 'points' && (
        <p className="chart-tooltip__detail">
          {formatNumber(view.finishedPoints)} points finished
        </p>
      )}
      <p className="chart-tooltip__detail">Click to see the items</p>
    </div>
  )
}

/** The pinned card's lines: the plan, then what did not go to plan. */
function details(view: ClosedSprintView, unit: 'points' | 'items') {
  const keys = (label: string, refs: SprintRef[]) =>
    refs.length ? (
      <p key={label} className="chart-tooltip__detail chart-tooltip__keys">
        {label}:{' '}
        {refs.slice(0, 8).map((ref, index) => (
          <span key={ref.key}>
            {index > 0 ? ', ' : ''}
            <ItemKey
              itemKey={ref.key}
              title={ref.title}
              browseUrl={ref.browseUrl}
            />
          </span>
        ))}
        {refs.length > 8 ? ` and ${refs.length - 8} more` : ''}
      </p>
    ) : null
  return [
    <p key="plan" className="chart-tooltip__detail">
      {view.finishedPlanned} of {view.planned.length} planned
      {unit === 'points'
        ? ` · ${formatNumber(view.finishedPoints)} points finished`
        : ''}
    </p>,
    view.sprint.goal ? (
      <p key="goal" className="chart-tooltip__detail">
        Goal: {view.sprint.goal}
      </p>
    ) : null,
    keys('Not finished', view.notFinished),
    keys('Added mid-sprint', view.added),
    keys('Removed', view.removed),
  ].filter(Boolean)
}

const asPoint = (ref: SprintRef) => ({
  item: ref.key,
  ...(ref.title ? { title: ref.title } : {}),
  ...(ref.browseUrl ? { browseUrl: ref.browseUrl } : {}),
})
