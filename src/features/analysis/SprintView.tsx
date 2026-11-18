import {
  Fragment,
  lazy,
  Suspense,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { AskAiTag } from '../../components/AskAiTag'
import { StatusMessage } from '../../components/ui'
import {
  sprintDescopePrompt,
  sprintGoalPrompt,
  sprintPlanningPrompt,
  sprintStandupPrompt,
  type ActiveSprintView,
  type PlanningView,
  type PointsTimeView,
  type SprintBriefing,
  type SprintItemState,
  type SprintItemView,
  type SprintRef,
} from '../../lib/statistics/sprint'
import { formatNumber } from './format'
import { ItemKey } from './ItemKey'
import { stagger } from './motion'
import { StatusSpot, TodayPanel } from './TodayPanel'

/*
 * The Sprint tab, for Scrum boards: will the running sprint land, the code
 * behind it, what needs a decision, the next plan against what the team
 * usually finishes, whether points predict time, and the last sprints. The
 * Briefing tab stays as it is. Same rules as the briefing: every key links to
 * its item with the title on hover, lists open on click, nothing per person.
 */

type Ask = (prompt: string, fallback?: string) => void

// The chart library loads on demand, as for the briefing's charts.
const SprintHistoryChart = lazy(() => import('./SprintHistoryChart'))

const stateLabel: Record<SprintItemState, string> = {
  done: 'done',
  track: 'on track',
  open: 'in progress',
  risk: 'at risk',
  todo: 'not started',
}
/** Groups on the card, the ones that need a decision first. */
const GROUPS = ['risk', 'todo', 'open', 'track', 'done'] as const

export function SprintView({
  briefing,
  onAsk,
  code,
}: {
  briefing: SprintBriefing
  onAsk: Ask
  /** The code behind the sprint, from GitHub, when connected. */
  code?: ReactNode
}) {
  if (briefing.unavailable === 'permission')
    return (
      <StatusMessage variant="info" title="Connect Jira again to see sprints">
        This connection is older than the Sprint tab. Connect this Jira project
        again from the workspace page: Steerloom updates the connection you
        have, and nothing is duplicated.
      </StatusMessage>
    )
  const {
    active,
    planning,
    planningGap,
    pointsTime,
    pointsTimeGap,
    history,
    unit,
  } = briefing
  // Beside the forecast: the code behind it, the next plan, and whether
  // points predict time, so the column ends with the forecast.
  // Two balanced columns: the forecast with "points vs time" under it, the
  // code behind the sprint with the next plan beside them. The last card of
  // each column takes up the slack, never the forecast.
  const pointsCard = pointsTime ? (
    <PointsTime key="points" view={pointsTime} />
  ) : pointsTimeGap ? (
    <NotYet
      key="points"
      title="Do your points predict time?"
      why={`${pointsTimeGap.estimated} finished ${pointsTimeGap.estimated === 1 ? 'item had' : 'items had'} an estimate in the last 90 days; this needs ${pointsTimeGap.needed}.`}
    />
  ) : null
  const side = [
    code && <Fragment key="code">{code}</Fragment>,
    planning ? (
      <PlanningCheck
        key="planning"
        planning={planning}
        unit={unit}
        onAsk={onAsk}
      />
    ) : planningGap ? (
      <NotYet
        key="planning"
        title="Planning the next sprint"
        why={planningGap}
      />
    ) : null,
  ].filter(Boolean)
  return (
    <div className="sprint-view">
      <div
        className="briefing-stage"
        data-hero="signal"
        data-layout={side.length ? 'split' : 'single'}
      >
        <div className="briefing-stage__side">
          {active ? (
            <SprintHero active={active} unit={unit} onAsk={onAsk} />
          ) : (
            <section className="work-stages sprint-none sl-rise">
              <p className="code-review__headline">No sprint is running</p>
              <p className="code-review__sub">
                Start one in Jira and refresh. The last sprints are below.
              </p>
            </section>
          )}
          {pointsCard}
        </div>
        {side.length > 0 && <div className="briefing-stage__side">{side}</div>}
      </div>
      {briefing.signals.length > 0 && (
        <TodayPanel signals={briefing.signals} onAsk={onAsk} baseDelay={120} />
      )}
      {history.length > 0 && (
        <Suspense
          fallback={<div className="chart-card__plot" aria-hidden="true" />}
        >
          <SprintHistoryChart history={history} unit={unit} />
        </Suspense>
      )}
    </div>
  )
}

function SprintHero({
  active,
  unit,
  onAsk,
}: {
  active: ActiveSprintView
  unit: 'points' | 'items'
  onAsk: Ask
}) {
  const { sprint, items, points } = active
  const count = (state: SprintItemState) =>
    items.filter((item) => item.state === state).length
  const unlikely = items.filter(
    (item) => item.state === 'risk' || item.state === 'todo',
  )
  const [opened, setOpened] = useState<SprintItemState>()
  const listId = useId()
  const forecast = active.sample > 0
  // Without a forecast nothing is called late: the list is what is open.
  const listed = opened
    ? items.filter((item) => item.state === opened)
    : forecast
      ? unlikely
      : items.filter((item) => item.state !== 'done')
  const share = items.length ? active.likely / items.length : 1
  const status = !forecast ? 'info' : share >= 0.85 ? 'ok' : 'risk'
  const end = sprint.endAt ? new Date(sprint.endAt) : undefined
  const endsToday = end && end.toDateString() === new Date().toDateString()
  const byWhen = !end
    ? 'by the end'
    : endsToday
      ? 'by today’s end'
      : `by ${end.toLocaleDateString('en-US', { weekday: 'long' })}`
  const sprintLink = sprintJiraLink(items, sprint.id)
  return (
    <article
      className="briefing-hero hero-signal sprint-hero sl-rise"
      data-status={status}
      aria-labelledby="sprint-hero-title"
      style={stagger(0)}
    >
      <div className="hero-signal__head">
        <StatusSpot status={status} />
        <p className="hero-signal__status">
          {status === 'info'
            ? 'Sprint so far'
            : status === 'ok'
              ? 'On track'
              : 'At risk'}
        </p>
        <p className="sprint-hero__when">
          Day {active.day} of {active.days}
          {end
            ? ` · ends ${end.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : ''}
        </p>
      </div>
      <h2 id="sprint-hero-title" className="hero-signal__title">
        <span className="hero-signal__number">{active.likely}</span>
        <span className="hero-signal__unit">
          of {items.length} sprint {items.length === 1 ? 'item' : 'items'}{' '}
          {forecast ? `likely done ${byWhen}` : 'done'}
        </span>
      </h2>
      <p className="sprint-hero__basis">
        {active.sample
          ? `85% confident of at least ${active.atLeast} · from ${active.sample} items finished in the last 90 days`
          : `No forecast yet: ${active.finishedRecently} ${active.finishedRecently === 1 ? 'item' : 'items'} finished in the last 90 days, and it needs 5.`}
      </p>
      {sprint.goal && (
        <p className="sprint-hero__goal">
          <strong>Goal:</strong> {sprint.goal}
        </p>
      )}
      {unit === 'points' && points && points.total > 0 && (
        <p className="sprint-hero__points">
          <strong>
            {formatNumber(points.likely)} of {formatNumber(points.total)} points
          </strong>{' '}
          {forecast ? 'likely' : 'done'}.
          {forecast && points.atRisk / points.total >= 0.5
            ? ' Most points sit in the items at risk.'
            : ''}
          {points.unestimated
            ? ` ${points.unestimated} ${points.unestimated === 1 ? 'item has' : 'items have'} no estimate.`
            : ''}
        </p>
      )}
      {/* The code card's model: one chip per item, grouped, decisions
          first; a group opens its items. */}
      <ul
        className="code-review__groups sprint-hero__groups"
        style={chipSize(Math.max(...GROUPS.map(count)))}
      >
        {GROUPS.filter((state) => count(state)).map((state, groupIndex) => (
          <li key={state} data-group={`sprint-${state}`}>
            <button
              type="button"
              className="code-review__group"
              aria-expanded={opened === state}
              aria-controls={listId}
              data-open={opened === state ? 'true' : undefined}
              onClick={() => setOpened(opened === state ? undefined : state)}
            >
              <span className="code-review__chips" aria-hidden="true">
                {items
                  .filter((item) => item.state === state)
                  .map((item, index) => (
                    <span
                      key={item.key}
                      className="code-review__chip sl-grow-y"
                      style={{
                        animationDelay: `${120 + groupIndex * 80 + index * 20}ms`,
                      }}
                    />
                  ))}
              </span>
              <span className="code-review__label">
                <strong>{count(state)}</strong> {stateLabel[state]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {/* What needs a decision is listed without a click; another group
          swaps the list to its items. */}
      {listed.length > 0 && (
        <div id={listId} className="code-review__open sprint-hero__list">
          <p className="sprint-hero__list-title">
            {opened
              ? `${count(opened)} ${stateLabel[opened]}`
              : forecast
                ? 'At risk and not started'
                : 'Still open'}
          </p>
          <ul className="code-review__items" aria-label="Sprint items">
            {listed.map((item) => (
              <li key={item.key} data-group={`sprint-${item.state}`}>
                <span className="code-review__chip" aria-hidden="true" />
                <ItemKey
                  itemKey={item.key}
                  title={item.title}
                  browseUrl={item.browseUrl}
                />
                <span>{itemDetail(item, unit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="hero-signal__actions">
        {/* The sprint's questions, ready to send, as in the briefing's header. */}
        <div
          className="report-hero__ask sprint-hero__ask"
          role="group"
          aria-label="Ask Steerloom AI"
        >
          <span>
            <AskAiTag />
          </span>
          <button
            type="button"
            className="briefing-link"
            onClick={() => onAsk(sprintStandupPrompt(active))}
          >
            What to raise at stand-up <span aria-hidden="true">→</span>
          </button>
          {sprint.goal && (
            <button
              type="button"
              className="briefing-link"
              onClick={() => onAsk(sprintGoalPrompt(active))}
            >
              Will we meet the goal? <span aria-hidden="true">→</span>
            </button>
          )}
          {unlikely.length > 0 && (
            <button
              type="button"
              className="briefing-link"
              onClick={() => onAsk(sprintDescopePrompt(active, unit))}
            >
              What to descope <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        {sprintLink && (
          <a
            className="briefing-link"
            href={sprintLink}
            target="_blank"
            rel="noreferrer"
          >
            Open the sprint in Jira
          </a>
        )}
      </div>
    </article>
  )
}

/** One line per item: where it stands, its size, its chance. */
function itemDetail(item: SprintItemView, unit: 'points' | 'items') {
  return [
    item.status,
    unit === 'points'
      ? item.points !== undefined
        ? `${formatNumber(item.points)} pts`
        : 'no estimate'
      : '',
    item.chance !== undefined ? `${Math.round(item.chance * 100)}% likely` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Chips thin out as the biggest group grows, as on the code card. */
function chipSize(largest: number) {
  const [width, gap, height] =
    largest <= 12
      ? [10, 4, 24]
      : largest <= 24
        ? [7, 3, 22]
        : largest <= 48
          ? [5, 2, 20]
          : [3, 1, 18]
  return {
    '--chip-width': `${width}px`,
    '--chip-gap': `${gap}px`,
    '--chip-height': `${height}px`,
  } as CSSProperties
}

function PlanningCheck({
  planning,
  unit,
  onAsk,
}: {
  planning: PlanningView
  unit: 'points' | 'items'
  onAsk: Ask
}) {
  const word = unit === 'points' ? 'points' : 'items'
  const { planned, low, high, usual } = planning
  const over = planned > high
  const scale = Math.max(planned, high) * 1.15 || 1
  const at = (value: number) => `${(value / scale) * 100}%`
  const headline = over
    ? `${formatNumber(planned)} ${word} planned; the team finishes about ${formatNumber(usual)}`
    : planned >= low
      ? `${formatNumber(planned)} ${word} planned: within the usual range`
      : `${formatNumber(planned)} ${word} planned so far; the team usually finishes ${formatNumber(usual)}`
  return (
    <section
      className="work-stages planning-check sl-rise"
      data-status={over ? 'risk' : 'ok'}
      aria-labelledby="planning-check-title"
    >
      <div className="work-stages__header">
        <h2 id="planning-check-title" className="work-stages__title">
          Planning {planning.sprint.name}
        </h2>
        <span className="work-stages__total">
          from the last {planning.sprints} sprints
        </span>
      </div>
      <p className="code-review__headline">{headline}</p>
      <p className="code-review__sub">
        The last {planning.sprints} sprints finished {formatNumber(low)}–
        {formatNumber(high)} {word}.
        {over ? ` None finished more than ${formatNumber(high)}.` : ''}
        {planning.unestimated
          ? ` ${planning.unestimated} planned ${planning.unestimated === 1 ? 'item has' : 'items have'} no estimate.`
          : ''}
      </p>
      <div
        className="planning-check__track"
        role="img"
        aria-label={`Usually ${low} to ${high} ${word}, about ${usual}; ${planned} planned`}
      >
        <span
          className="planning-check__range"
          style={{ left: at(low), width: at(high - low) } as CSSProperties}
        />
        <span className="planning-check__usual" style={{ left: at(usual) }}>
          <small>usual {formatNumber(usual)}</small>
        </span>
        <span
          className="planning-check__plan"
          data-over={over ? 'true' : undefined}
          style={{ left: at(planned) }}
        >
          <small>planned {formatNumber(planned)}</small>
        </span>
      </div>
      {over && (
        <div className="hero-signal__actions">
          <button
            type="button"
            className="briefing-link"
            aria-label="Choose what to leave out, with Steerloom AI"
            onClick={() => onAsk(sprintPlanningPrompt(planning, unit))}
          >
            <AskAiTag /> · Choose what to leave out{' '}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </section>
  )
}

function PointsTime({ view }: { view: PointsTimeView }) {
  // The axis fits what most items take: a few very long items would squeeze
  // every row into the first millimetres. Longer ranges run off the end.
  const longest = Math.max(...view.rows.map((row) => row.to), 1)
  const typical = Math.max(...view.rows.map((row) => row.median), 1) * 3
  const span = Math.min(longest, typical)
  const step = span > 20 ? 10 : 2
  const scale = Math.max(4, Math.ceil(span / step) * step)
  const at = (days: number) => `${(Math.min(days, scale) / scale) * 100}%`
  const days = (value: number) => formatNumber(Math.round(value * 10) / 10)
  const sub =
    view.verdict === 'yes'
      ? `Up to ${formatNumber(view.smallUpTo)} points: about ${days(view.smallMedian)} days. Bigger: about ${days(view.largeMedian)}. The forecast uses this.`
      : view.verdict === 'partly'
        ? `Small and large items differ, about ${days(view.smallMedian)} against ${days(view.largeMedian)} days, but sizes overlap. The forecast groups items as small or large.`
        : 'Bigger estimates don’t take longer here, so the forecast uses each item’s age only.'
  return (
    <section
      className="work-stages points-time sl-rise"
      aria-labelledby="points-time-title"
    >
      <div className="work-stages__header">
        <h2 id="points-time-title" className="work-stages__title">
          Do your points predict time?
        </h2>
        <span className="work-stages__total">
          {view.items} items, last 90 days
        </span>
      </div>
      <p className="code-review__headline">
        {view.verdict === 'yes'
          ? 'Yes'
          : view.verdict === 'partly'
            ? 'Partly'
            : 'Not really'}
      </p>
      <p className="code-review__sub">{sub}</p>
      <ul
        className="points-time__rows"
        aria-label="Days to finish by estimate: the middle 70% and the median"
      >
        {view.rows.map((row) => (
          <li key={row.points}>
            <strong>{formatNumber(row.points)} pt</strong>
            <span className="points-time__track" aria-hidden="true">
              <span
                className="points-time__range"
                style={
                  {
                    left: at(row.from),
                    width: at(
                      Math.max(
                        Math.min(row.to, scale) - Math.min(row.from, scale),
                        0.1,
                      ),
                    ),
                  } as CSSProperties
                }
              />
              <span
                className="points-time__median"
                style={{ left: at(row.median) }}
              />
            </span>
            <small>
              {days(row.median)} days · {row.items} items
            </small>
          </li>
        ))}
      </ul>
      <div className="points-time__axis" aria-hidden="true">
        <span>0</span>
        <span>{scale / 2}</span>
        <span>{scale} days</span>
      </div>
    </section>
  )
}

/** A card that cannot say anything yet, and says why in one line. */
export function NotYet({
  title,
  why,
  tag = 'not yet',
}: {
  title: string
  why: string
  tag?: string
}) {
  return (
    <section className="work-stages sprint-not-yet sl-rise">
      <div className="work-stages__header">
        <h2 className="work-stages__title">{title}</h2>
        <span className="work-stages__total">{tag}</span>
      </div>
      <p className="code-review__sub">{why}</p>
    </section>
  )
}

/** The sprint in Jira's issue search, from any item's link. */
function sprintJiraLink(items: SprintRef[], sprintId: string) {
  const link = items.find((item) => item.browseUrl)?.browseUrl
  if (!link || !/^\d+$/.test(sprintId)) return undefined
  try {
    const url = new URL(link)
    const index = url.pathname.lastIndexOf('/browse/')
    if (index < 0 || !/^https?:$/.test(url.protocol)) return undefined
    url.pathname = `${url.pathname.slice(0, index)}/issues/`
    url.search = ''
    url.searchParams.set('jql', `sprint = ${sprintId}`)
    return url.toString()
  } catch {
    return undefined
  }
}
