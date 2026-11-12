import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { SpotIcon } from '../../../components/SpotIcon'
import type { SpotName } from '../../../components/spot-icons'
import { usePrefersReducedMotion } from '../../analysis/motion'

/*
 * Every timing in the showcase, in milliseconds. They reach the CSS as
 * --sc-* custom properties, so this object is the one place to tweak them.
 */
const TIMING = {
  advance: 6000, // time on each tab; the progress line fills over this
  panelIn: 520, // incoming panel rises in
  panelOut: 320, // outgoing panel fades and shrinks to 0.98
  stagger: 55, // gap between items in a staggered group
  chipDrop: 520, // one chip dropping into its column
  aging: 1500, // late chips shifting from blue to orange
  noise: 1300, // noise cards jitter, then collapse
  borderDraw: 420, // a signal card's top edge drawing in
  travel: 1600, // forecast dot travelling from Today to 85%
} as const

const timingVars = {
  '--sc-advance': `${TIMING.advance}ms`,
  '--sc-panel-in': `${TIMING.panelIn}ms`,
  '--sc-panel-out': `${TIMING.panelOut}ms`,
  '--sc-stagger': `${TIMING.stagger}ms`,
  '--sc-chip': `${TIMING.chipDrop}ms`,
  '--sc-aging': `${TIMING.aging}ms`,
  '--sc-noise': `${TIMING.noise}ms`,
  '--sc-border': `${TIMING.borderDraw}ms`,
  '--sc-travel': `${TIMING.travel}ms`,
} as CSSProperties

const vars = (values: Record<string, number | string>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties

/* Panel 1: the pile forming. To do and Review fill first; In progress keeps
   receiving chips, then its oldest four age from blue to orange. */
function StagesVisual() {
  const lanes: ReadonlyArray<{
    name: string
    chips: string[]
    late?: number
    start: number
  }> = [
    { name: 'To do', chips: ['WEB-118', 'API-231', 'OPS-42'], start: 0 },
    {
      name: 'In progress',
      chips: [
        'API-212',
        'WEB-104',
        'API-198',
        'WEB-97',
        'API-207',
        'OPS-39',
        'WEB-112',
      ],
      late: 4,
      start: 5,
    },
    { name: 'Review', chips: ['API-205', 'WEB-109'], start: 3 },
  ]
  const landed = 12 * TIMING.stagger + TIMING.chipDrop
  return (
    <div
      className="showcase-visual sc-stages"
      style={vars({
        'sc-aging-at': `${landed}ms`,
        'sc-note-at': `${landed + TIMING.aging}ms`,
      })}
    >
      <div className="sc-stages__lanes">
        {lanes.map((lane) => (
          <div
            className="sc-stages__lane"
            data-focus={lane.late ? 'true' : undefined}
            key={lane.name}
          >
            {lane.late ? <span className="sc-stages__band" /> : null}
            <div className="sc-stages__stack">
              {lane.chips.map((chip, index) => (
                <span
                  className="sc-chip"
                  key={chip}
                  data-late={index < (lane.late ?? 0) ? 'true' : undefined}
                  style={vars({ i: lane.start + index })}
                >
                  <span className="sc-chip__label">{chip}</span>
                </span>
              ))}
            </div>
            <span className="sc-stages__name">{lane.name}</span>
          </div>
        ))}
      </div>
      <p className="sc-stages__note">
        <strong>Bottleneck:</strong> 4 items aging &gt; 5 days
      </p>
    </div>
  )
}

/* Panel 2: noise collapses away and three findings remain. */
const NOISE: ReadonlyArray<[number, number, number]> = [
  [6, 8, -6],
  [30, 4, 4],
  [58, 10, -3],
  [80, 6, 7],
  [12, 38, 5],
  [38, 32, -8],
  [66, 36, 3],
  [86, 42, -5],
  [4, 70, -4],
  [28, 76, 6],
  [56, 72, -7],
  [78, 78, 4],
]

function DecisionsVisual() {
  const signals: ReadonlyArray<{
    kind: SpotName
    label: string
    finding: string
    tone: string
  }> = [
    {
      kind: 'at-risk',
      label: 'At risk',
      finding: 'Checkout redesign: 9 days in progress, 3x the usual',
      tone: 'danger',
    },
    {
      kind: 'bottleneck',
      label: 'Bottleneck',
      finding: 'Review has 6 items waiting, the oldest for 11 days',
      tone: 'warning',
    },
    {
      kind: 'rework',
      label: 'Rework',
      finding: '4 tickets bounced back from QA since Monday',
      tone: 'info',
    },
  ]
  return (
    <div className="showcase-visual sc-decisions">
      <div className="sc-noise" aria-hidden="true">
        {NOISE.map(([x, y, rotate], index) => (
          <span
            key={index}
            style={vars({
              x: `${x}%`,
              y: `${y}%`,
              r: `${rotate}deg`,
              dx: `${((50 - x) / 100) * 460}px`,
              dy: `${((45 - y) / 100) * 280}px`,
              i: index,
            })}
          />
        ))}
      </div>
      {signals.map((signal, index) => (
        <div
          className="sc-signal"
          data-tone={signal.tone}
          key={signal.label}
          style={vars({ i: index })}
        >
          <SpotIcon name={signal.kind} className="sc-signal__icon" />
          <strong>{signal.label}</strong>
          <span className="sc-signal__text">{signal.finding}</span>
        </div>
      ))}
    </div>
  )
}

/* Panel 3: the dot travels, the number counts, the date lands last. */
const TARGET = 85
const TARGET_AT = 0.76 // position of the 85% mark along the track
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
// When the eased dot passes a mark, so marks light up as it goes by.
const passAt = (position: number) =>
  `${Math.round((1 - Math.cbrt(1 - position / TARGET_AT)) * TIMING.travel)}ms`

function ForecastVisual({ playing }: { playing: boolean }) {
  const [shown, setShown] = useState(TARGET)

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TIMING.travel)
      setShown(Math.round(easeOutCubic(t) * TARGET))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      setShown(TARGET)
    }
  }, [playing])

  const marks: ReadonlyArray<{ label: string; at: number }> = [
    { label: '50%', at: 0.52 },
    { label: '70%', at: 0.64 },
    { label: '85%', at: TARGET_AT },
    { label: '95%', at: 0.9 },
  ]
  return (
    <div
      className="showcase-visual sc-forecast"
      style={vars({ 'sc-target': TARGET_AT })}
    >
      <p className="sc-forecast__title">
        <span className="sc-forecast__count">{shown}%</span> likely by{' '}
        <span className="sc-forecast__date">Nov 14</span>
      </p>
      <svg
        className="sc-forecast__curve"
        viewBox="0 0 520 64"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 62 C 156 62, 208 8, 302 6 S 416 50, 520 60"
          pathLength={1}
        />
      </svg>
      <div className="sc-forecast__track">
        <span className="sc-forecast__fill" />
        {marks.map((mark) => (
          <span
            key={mark.label}
            className="sc-forecast__mark"
            data-target={mark.at === TARGET_AT ? 'true' : undefined}
            style={vars({
              at: `${mark.at * 100}%`,
              'pass-at': mark.at <= TARGET_AT ? passAt(mark.at) : '0ms',
            })}
          >
            <span>{mark.label}</span>
          </span>
        ))}
        <span className="sc-forecast__runner">
          <span className="sc-forecast__dot" />
        </span>
      </div>
      <div className="sc-forecast__foot">
        <span>Today</span>
        <span>Based on 8 weeks of your team’s throughput</span>
      </div>
    </div>
  )
}

const slides: ReadonlyArray<{
  id: string
  title: string
  body: string
  description: string
  render: (playing: boolean) => ReactNode
}> = [
  {
    id: 'stages',
    title: 'See where work piles up',
    body: 'Spot the stage slowing your team down before it turns into a delay.',
    description:
      'Work items drop into To do, In progress and Review. In progress keeps filling and its four oldest items turn orange: a bottleneck of 4 items aging more than 5 days.',
    render: () => <StagesVisual />,
  },
  {
    id: 'decisions',
    title: 'Get decisions, not noise',
    body: 'Only the signals that need you today, each with the work behind it.',
    description:
      'A scatter of noise collapses into three findings: a checkout redesign at 3x the usual time, 6 items waiting in Review, and 4 tickets bounced back from QA.',
    render: () => <DecisionsVisual />,
  },
  {
    id: 'forecast',
    title: 'Know when current work will finish',
    body: 'Dates with odds, not guesses.',
    description:
      'A forecast: 85% likely by November 14, based on 8 weeks of the team’s throughput.',
    render: (playing) => <ForecastVisual playing={playing} />,
  },
]

/**
 * One frame cycling through the three capabilities. The progress line beside
 * the active tab drives the rotation, so pausing it (hovering the card or
 * focusing inside) pauses everything. Nothing plays until the showcase is on
 * screen, and with reduced motion the tabs never advance on their own.
 */
export function CapabilityShowcase() {
  const [active, setActive] = useState(0)
  const tabsRef = useRef<HTMLDivElement>(null)
  // On narrow screens the tabs scroll sideways: keep the selected one in view
  // (inside the row only, never scrolling the page).
  useEffect(() => {
    const row = tabsRef.current
    const tab = row?.querySelectorAll<HTMLElement>('[role="tab"]')[active]
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return
    const left = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2
    row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [active])
  const [cycle, setCycle] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [started, setStarted] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  const reducedMotion = usePrefersReducedMotion()
  const rootRef = useRef<HTMLElement>(null)
  const autoplay = started && !reducedMotion

  useEffect(() => {
    if (started || !rootRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setStarted(true)
      },
      { threshold: 0.35 },
    )
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [started])

  const show = (index: number) => {
    setActive(index)
    setCycle((value) => value + 1)
  }

  return (
    <section
      ref={rootRef}
      className="showcase"
      aria-label="What Steerloom shows"
      style={timingVars}
      data-paused={hovered || focused ? 'true' : undefined}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false)
      }}
    >
      <div
        ref={tabsRef}
        className="showcase__tabs"
        role="tablist"
        aria-label="Capabilities"
      >
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            id={`showcase-tab-${slide.id}`}
            aria-selected={index === active}
            aria-controls="showcase-frame"
            tabIndex={index === active ? 0 : -1}
            className="showcase__tab"
            onClick={() => show(index)}
            onKeyDown={(event) => {
              const step =
                event.key === 'ArrowDown' || event.key === 'ArrowRight'
                  ? 1
                  : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                    ? -1
                    : 0
              if (!step) return
              event.preventDefault()
              const next = (index + step + slides.length) % slides.length
              show(next)
              document
                .getElementById(`showcase-tab-${slides[next]?.id ?? ''}`)
                ?.focus()
            }}
          >
            <strong>{slide.title}</strong>
            <span className="showcase__body">{slide.body}</span>
            {index === active && autoplay && (
              <span
                className="showcase__progress"
                aria-hidden="true"
                key={cycle}
                onAnimationEnd={() => show((active + 1) % slides.length)}
              />
            )}
          </button>
        ))}
      </div>
      <p className="showcase__caption">{slides[active]?.body}</p>
      <div
        className="showcase__frame"
        id="showcase-frame"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${slides[active]?.id ?? ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {slides.map((slide, index) => {
          const playing = started && index === active
          return (
            <div
              key={slide.id}
              className="showcase__slide"
              role="img"
              aria-label={slide.description}
              aria-hidden={index === active ? undefined : true}
              data-active={playing ? 'true' : undefined}
            >
              {slide.render(playing && !reducedMotion)}
            </div>
          )
        })}
      </div>
    </section>
  )
}
