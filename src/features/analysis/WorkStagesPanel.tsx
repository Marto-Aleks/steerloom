import type { CSSProperties, ReactNode } from 'react'
import { pileUpStage, type StageLoad } from '../../lib/statistics/briefing'
import { formatNumber } from './format'
import { stagger } from './motion'

const COLUMN_HEIGHT = 132
const BLOCK_GAP = 4
const MAX_BLOCK_HEIGHT = 14
const MIN_BLOCK_HEIGHT = 3

// Active items per measured stage as stacked blocks over a flow baseline.
// Items past the usual limit sit at the bottom of each stack in their own colour.
export function WorkStagesPanel({
  loads,
  limitDays = null,
  flow,
  finishedCount,
  style,
  footer,
}: {
  loads: StageLoad[]
  limitDays?: number | null
  /** Items started and finished over the last complete weeks. */
  flow?: { started: number; finished: number; days: number }
  /** Finished items behind the time shares. */
  finishedCount?: number
  style?: CSSProperties
  /** Extra detail at the bottom of the card, such as where time inside a stage goes. */
  footer?: ReactNode
}) {
  if (!loads.length) return null
  const total = loads.reduce((sum, load) => sum + load.count, 0)
  const late = loads.reduce((sum, load) => sum + (load.late ?? 0), 0)
  const pile = pileUpStage(loads)
  const most = mostTimeStage(loads)

  return (
    <section
      className="work-stages sl-rise"
      style={style}
      aria-labelledby="work-stages-title"
    >
      <div className="work-stages__header">
        <h2 id="work-stages-title" className="work-stages__title">
          Where work sits now
        </h2>
        <span className="work-stages__total">
          {total} active {total === 1 ? 'item' : 'items'}
        </span>
      </div>
      {flow && (
        <p className="work-stages__flow">
          <span
            data-growing={flow.started > flow.finished ? 'true' : undefined}
          >
            {flow.started} started
          </span>{' '}
          · <strong>{flow.finished} finished</strong> in the last {flow.days}{' '}
          days
        </p>
      )}
      {most && finishedCount ? (
        <p className="work-stages__share-note">
          The {finishedCount} {finishedCount === 1 ? 'item' : 'items'} finished
          in this period spent {finishedCount === 1 ? 'its' : 'their'} time
          here:
        </p>
      ) : null}
      <ul
        className="work-stages__lanes"
        aria-label="Active items per measured stage"
        style={{ '--work-stage-count': loads.length } as CSSProperties}
      >
        {loads.map((load, laneIndex) => {
          // Crowded stages close the gaps first, so every item stays visible
          // inside the column instead of being squeezed below a pixel.
          const gap =
            load.count * (MIN_BLOCK_HEIGHT + BLOCK_GAP) > COLUMN_HEIGHT
              ? 1
              : BLOCK_GAP
          const blockHeight = load.count
            ? Math.max(
                1,
                Math.min(
                  MAX_BLOCK_HEIGHT,
                  Math.floor(
                    (COLUMN_HEIGHT - (load.count - 1) * gap) / load.count,
                  ),
                ),
              )
            : 0
          return (
            <li
              className="work-stages__lane"
              key={load.id}
              data-pile={pile?.id === load.id ? 'true' : undefined}
              data-most={most?.id === load.id ? 'true' : undefined}
            >
              <div
                className="work-stages__stack"
                aria-hidden="true"
                style={
                  {
                    height: COLUMN_HEIGHT,
                    '--block-gap': `${gap}px`,
                  } as CSSProperties
                }
              >
                {Array.from({ length: load.count }, (_, blockIndex) => (
                  <span
                    className="work-stages__block sl-grow-y"
                    data-late={
                      blockIndex < (load.late ?? 0) ? 'true' : undefined
                    }
                    key={blockIndex}
                    style={{
                      height: blockHeight,
                      ...stagger(blockIndex, 30, 120 + laneIndex * 60),
                    }}
                  />
                ))}
              </div>
              <div className="work-stages__baseline" aria-hidden="true" />
              <strong className="work-stages__count">
                {load.count}
                <span className="sr-only">
                  {' '}
                  {load.count === 1 ? 'item' : 'items'}
                  {load.late ? `, ${load.late} past the usual limit,` : ''} in
                </span>
              </strong>
              <span className="work-stages__name">{load.name}</span>
              {load.timeShare !== undefined && (
                <span className="work-stages__share">
                  {Math.round(load.timeShare * 100)}%
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {total > 0 && (
        <ul className="work-stages__legend" aria-label="Key">
          <li>
            <span className="work-stages__swatch" aria-hidden="true" />
            {limitDays === null
              ? `${total} active, no usual limit yet`
              : `${total - late} within the usual limit`}
          </li>
          {late > 0 && limitDays !== null && (
            <li>
              <span
                className="work-stages__swatch"
                data-late="true"
                aria-hidden="true"
              />
              {late} past the usual {formatNumber(limitDays)}{' '}
              {limitDays === 1 ? 'day' : 'days'}
            </li>
          )}
        </ul>
      )}
      {footer}
    </section>
  )
}

/** The stage where finished work spent most of its time, when known. */
function mostTimeStage(loads: StageLoad[]): StageLoad | null {
  const known = loads.filter((load) => load.timeShare !== undefined)
  if (!known.length) return null
  return [...known].sort(
    (left, right) => (right.timeShare ?? 0) - (left.timeShare ?? 0),
  )[0]!
}
