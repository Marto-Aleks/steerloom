import { useState, type CSSProperties, type ReactNode } from 'react'
import { useCountUp, useRevealOnce } from './reveal'

const vars = (values: Record<string, number | string>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties

/* Mini visuals. Each rests in its finished state; the section's
   data-revealed attribute starts their one-off animations. */

function ThroughputVisual() {
  const weeks = [5, 7, 6, 9, 8, 11, 10, 12]
  return (
    <div className="bento-bars" aria-hidden="true">
      {weeks.map((count, index) => (
        <span key={index} style={vars({ h: count / 12, i: index })} />
      ))}
    </div>
  )
}

function CycleTimeVisual() {
  const bins = [2, 5, 9, 12, 11, 9, 7, 5, 4, 3, 2, 2, 1, 1]
  return (
    <div className="bento-hist" aria-hidden="true">
      {bins.map((count, index) => (
        <span key={index} style={vars({ h: count / 12, i: index })} />
      ))}
    </div>
  )
}

const P85_AT = 0.7
function UsualLimitVisual() {
  const bins = [3, 6, 9, 11, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1]
  const cutoff = Math.round(bins.length * P85_AT)
  return (
    <div className="bento-p85" aria-hidden="true" style={vars({ at: P85_AT })}>
      <div className="bento-hist bento-hist--muted">
        {bins.map((count, index) => (
          <span
            key={index}
            data-in={index < cutoff ? 'true' : undefined}
            style={vars({ h: count / 11, i: index })}
          />
        ))}
      </div>
      <span className="bento-p85__runner">
        <span className="bento-p85__line">
          <b>85%</b>
        </span>
      </span>
    </div>
  )
}

function AgingVisual() {
  const items = [0.16, 0.34, 0.68, 0.8, 0.92]
  return (
    <div className="bento-aging" aria-hidden="true">
      <span className="bento-aging__limit">
        <b>usual limit</b>
      </span>
      {items.map((x, index) => (
        <span
          className="bento-aging__runner"
          key={index}
          data-late={x > 0.6 ? 'true' : undefined}
          style={vars({ x, i: index })}
        >
          <span className="bento-aging__dot" />
        </span>
      ))}
    </div>
  )
}

function ReworkVisual() {
  return (
    <svg className="bento-rework" viewBox="0 0 220 80" aria-hidden="true">
      <defs>
        <marker
          id="bento-arrow"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" />
        </marker>
      </defs>
      <path className="bento-rework__flow" d="M8 58 H212" pathLength={1} />
      <path
        className="bento-rework__loop"
        d="M168 58 C 168 8, 64 8, 64 50"
        pathLength={1}
        markerEnd="url(#bento-arrow)"
      />
      {[40, 104, 168].map((x) => (
        <circle key={x} className="bento-rework__stage" cx={x} cy={58} r={5} />
      ))}
    </svg>
  )
}

/* The forecast: 200 simulated outcomes drop into a histogram, then the
   confidence markers appear and the 50–95% finish window is shaded. (The
   showcase above already tells the single "85% by" date.) */
const COLUMNS = 20
const DOTS_PER_COLUMN = (() => {
  const raw = Array.from({ length: COLUMNS }, (_, index) => {
    const x = (index - 7.5) / 3.6
    return Math.exp(-(x * x) / 2) * (index > 7 ? 1 : 0.85)
  })
  const total = raw.reduce((sum, value) => sum + value, 0)
  return raw.map((value) => Math.max(1, Math.round((value / total) * 200)))
})()
const MARKERS = [50, 70, 85, 95].map((percent) => {
  const total = DOTS_PER_COLUMN.reduce((sum, count) => sum + count, 0)
  let running = 0
  const column = DOTS_PER_COLUMN.findIndex((count) => {
    running += count
    return running / total >= percent / 100
  })
  return { percent, at: (column + 0.5) / COLUMNS }
})
// A stable scatter so dots in the same row do not land in lockstep.
const jitter = (column: number, row: number) =>
  ((column * 37 + row * 61) % 17) / 17

function ForecastVisual() {
  return (
    <div className="bento-forecast" aria-hidden="true">
      <span className="bento-forecast__chip">10,000 simulations</span>
      <div className="bento-forecast__plot">
        <div className="bento-forecast__columns">
          {DOTS_PER_COLUMN.map((count, column) => (
            <div className="bento-forecast__column" key={column}>
              {Array.from({ length: count }, (_, row) => (
                <span
                  key={row}
                  style={vars({
                    d: `${row * 70 + jitter(column, row) * 380}ms`,
                  })}
                />
              ))}
            </div>
          ))}
        </div>
        <span
          className="bento-forecast__window"
          style={vars({
            from: MARKERS[0]?.at ?? 0,
            to: MARKERS[MARKERS.length - 1]?.at ?? 1,
          })}
        />
        {MARKERS.map((marker, index) => (
          <span
            key={marker.percent}
            className="bento-forecast__marker"
            data-focus={
              marker.percent === 50 || marker.percent === 95
                ? 'true'
                : undefined
            }
            style={vars({ at: marker.at, i: index })}
          >
            <b>{marker.percent}%</b>
          </span>
        ))}
      </div>
    </div>
  )
}

const tiles: ReadonlyArray<{
  id: string
  name: string
  target: number
  decimals?: number
  /** Shown instead of a counted number, for values that are not counts. */
  display?: string
  unit: string
  definition: string
  formula: string
  visual: ReactNode
}> = [
  {
    id: 'forecast',
    name: 'Forecast',
    target: 0,
    display: 'Nov 9–21',
    unit: 'finish window, 50–95% likely',
    definition: 'When the work in progress will be done, with the odds.',
    formula:
      '10,000 simulated futures, each replaying daily throughput sampled from your last 8 weeks. The window runs from the date half of them had finished the current work to the date 95% had.',
    visual: <ForecastVisual />,
  },
  {
    id: 'throughput',
    name: 'Throughput',
    target: 12,
    unit: 'items/week',
    definition: 'Items finished per week.',
    formula:
      'Items that left the measured stages in the period, divided by the number of weeks in it.',
    visual: <ThroughputVisual />,
  },
  {
    id: 'cycle',
    name: 'Cycle time',
    target: 4.2,
    decimals: 1,
    unit: 'days',
    definition: 'Time an item spent in the measured stages.',
    formula:
      'Every visit to the measured stages, added up per finished item. The figure is the median.',
    visual: <CycleTimeVisual />,
  },
  {
    id: 'p85',
    name: 'Usual limit (P85)',
    target: 9,
    unit: 'days',
    definition: 'What 85% of finished items stayed within.',
    formula:
      'Sort the finished items by cycle time; the usual limit is where 85% of them have finished.',
    visual: <UsualLimitVisual />,
  },
  {
    id: 'aging',
    name: 'Aging work',
    target: 3,
    unit: 'items',
    definition: 'Active items already past the usual limit.',
    formula:
      'Active items whose time in the measured stages is already longer than the usual limit.',
    visual: <AgingVisual />,
  },
  {
    id: 'rework',
    name: 'Rework',
    target: 4,
    unit: 'this week',
    definition: 'Items that left the flow and came back.',
    formula:
      'Items that left the measured stages and later re-entered them, counted once each.',
    visual: <ReworkVisual />,
  },
]

function Tile({
  tile,
  index,
  revealed,
}: {
  tile: (typeof tiles)[number]
  index: number
  revealed: boolean
}) {
  const [open, setOpen] = useState(false)
  const shown = useCountUp(tile.target, revealed, {
    delay: 200 + index * 60,
    decimals: tile.decimals,
  })
  const formulaId = `bento-formula-${tile.id}`
  return (
    <article
      className="bento__tile"
      data-tile={tile.id}
      data-open={open ? 'true' : undefined}
      style={vars({ i: index })}
    >
      <div className="bento__face">
        <h3 className="bento__name">{tile.name}</h3>
        <p className="bento__value">
          <span className="bento__number">{tile.display ?? shown}</span>
          {tile.display ? (
            <span className="bento__unit bento__unit--block">{tile.unit}</span>
          ) : (
            <span className="bento__unit"> {tile.unit}</span>
          )}
        </p>
        <p className="bento__definition">{tile.definition}</p>
        <div className="bento__visual">{tile.visual}</div>
      </div>
      <p className="bento__formula" id={formulaId} hidden={!open}>
        {tile.formula}
      </p>
      <button
        type="button"
        className="bento__how"
        aria-expanded={open}
        aria-controls={formulaId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Back to the example' : 'How it’s calculated →'}
      </button>
    </article>
  )
}

/** Six metrics as an uneven grid; the forecast is the hero tile. */
export function MetricsBento() {
  const [ref, revealed] = useRevealOnce<HTMLElement>(0.2)
  return (
    <section
      ref={ref}
      className="bento-section"
      data-revealed={revealed ? 'true' : undefined}
      aria-labelledby="landing-metrics"
    >
      <h2
        id="landing-metrics"
        className="landing__heading bento-section__title"
      >
        Six numbers that tell the truth about your board
      </h2>
      <p className="landing__subheading bento-section__lead">
        Calculated from when work actually moved, not when someone remembered to
        update a ticket.
      </p>
      <div className="bento">
        {tiles.map((tile, index) => (
          <Tile key={tile.id} tile={tile} index={index} revealed={revealed} />
        ))}
      </div>
      <p className="bento-section__swipe" aria-hidden="true">
        Swipe for all six →
      </p>
    </section>
  )
}
