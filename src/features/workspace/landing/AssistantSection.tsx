import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ChartColumn,
  ChevronDown,
  Funnel,
  Hourglass,
  SendHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { SteerloomMark } from '../../../components/SteerloomMark'
import { UiIcon } from '../../../components/UiIcon'
import { usePrefersReducedMotion } from '../../analysis/motion'
import { useRevealOnce } from './reveal'

/* Timings for the product-window demo, in milliseconds. */
const TIMING = {
  start: 500, // calm board before the question starts
  typeChar: 30, // question typing, per character
  think: 700, // thinking dots
  word: 70, // answer streaming, per word
  evidence: 650, // gap between evidence chips (each lights up the board)
  link: 1100, // dashed connector visible before it fades
  hold: 3000, // finished exchange stays before the next one
} as const

type Evidence = {
  icon: LucideIcon
  label: string
  /** What lights up on the board when this chip appears. */
  target?: 'review' | 'api-212'
}

const EXCHANGES: ReadonlyArray<{
  model: string
  question: string
  lead: string
  rest: string
  forecast?: boolean
  evidence: Evidence[]
}> = [
  {
    model: 'Claude',
    question: 'What’s blocking the mobile team?',
    lead: 'Review is the bottleneck.',
    rest: 'It holds 6 of 12 active items. Start with API‑212.',
    evidence: [
      { icon: Funnel, label: 'Review column', target: 'review' },
      {
        icon: Hourglass,
        label: 'API-212 · 11 days in progress',
        target: 'api-212',
      },
    ],
  },
  {
    model: 'OpenAI',
    question: 'When will our current work be done?',
    lead: '85% likely by Nov 21.',
    rest: '',
    forecast: true,
    evidence: [{ icon: ChartColumn, label: 'Based on 8 weeks of throughput' }],
  },
]

const LANES: ReadonlyArray<{
  id: string
  name: string
  chips: Array<string | null>
}> = [
  { id: 'todo', name: 'To do', chips: ['MOB-91', null] },
  { id: 'progress', name: 'In progress', chips: ['MOB-88', null, null] },
  {
    id: 'review',
    name: 'Review',
    chips: ['API-212', null, null, null, null, null],
  },
]

type Phase = 'idle' | 'typing' | 'thinking' | 'streaming' | 'evidence' | 'done'

/**
 * Landing section for Steerloom AI. A product window plays a short exchange;
 * as each evidence chip appears, the matching part of the board lights up,
 * proving "answers with evidence" without saying it. Starts once on screen;
 * reduced motion shows the first exchange finished.
 */
export function AssistantSection({ signUpHref }: { signUpHref: string }) {
  const [ref, revealed] = useRevealOnce<HTMLElement>(0.3)
  const reducedMotion = usePrefersReducedMotion()
  const animate = revealed && !reducedMotion
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [typed, setTyped] = useState(0)
  const [words, setWords] = useState(0)
  const [shown, setShown] = useState(0)
  const [linkOn, setLinkOn] = useState(false)
  const [enterprise, setEnterprise] = useState(false)

  const exchange = EXCHANGES[round % EXCHANGES.length]!
  const answerWords = [exchange.lead, exchange.rest]
    .filter(Boolean)
    .join(' ')
    .split(' ')
  const leadWords = exchange.lead.split(' ').length

  useEffect(() => {
    if (!animate) return
    let cancelled = false
    const timers: number[] = []
    const at = (ms: number, fn: () => void) =>
      timers.push(window.setTimeout(() => !cancelled && fn(), ms))
    setPhase('idle')
    setTyped(0)
    setWords(0)
    setShown(0)
    setLinkOn(false)
    let clock = TIMING.start
    at(clock, () => setPhase('typing'))
    for (let index = 1; index <= exchange.question.length; index++)
      at(clock + index * TIMING.typeChar, () => setTyped(index))
    clock += exchange.question.length * TIMING.typeChar + 200
    at(clock, () => setPhase('thinking'))
    clock += TIMING.think
    at(clock, () => setPhase('streaming'))
    for (let index = 1; index <= answerWords.length; index++)
      at(clock + index * TIMING.word, () => setWords(index))
    clock += answerWords.length * TIMING.word + 250
    at(clock, () => setPhase('evidence'))
    exchange.evidence.forEach((item, index) => {
      at(clock + index * TIMING.evidence, () => setShown(index + 1))
      if (item.target === 'api-212') {
        at(clock + index * TIMING.evidence + 150, () => setLinkOn(true))
        at(clock + index * TIMING.evidence + 150 + TIMING.link, () =>
          setLinkOn(false),
        )
      }
    })
    clock += exchange.evidence.length * TIMING.evidence + TIMING.link
    at(clock, () => setPhase('done'))
    at(clock + TIMING.hold, () => setRound((value) => value + 1))
    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
    // exchange and answerWords derive from round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, round])

  // Without animation: the first exchange, finished, board highlighted.
  const still = !animate
  const view = still ? EXCHANGES[0]! : exchange
  const viewPhase: Phase = still ? 'done' : phase
  const viewWords = still ? Number.POSITIVE_INFINITY : words
  const viewShown = still ? view.evidence.length : shown
  const lit = new Set(
    view.evidence.slice(0, viewShown).flatMap((item) => item.target ?? []),
  )
  const question = still ? view.question : view.question.slice(0, typed)
  const streamed = (still ? answerWordsOf(view) : answerWords).slice(
    0,
    viewWords,
  )
  const viewLead = still ? view.lead.split(' ').length : leadWords
  const answerVisible =
    viewPhase === 'streaming' ||
    viewPhase === 'evidence' ||
    viewPhase === 'done'

  return (
    <section
      ref={ref}
      className="assistant"
      data-revealed={revealed ? 'true' : undefined}
      aria-labelledby="landing-assistant"
    >
      <div className="assistant__copy">
        <p className="assistant__eyebrow">Steerloom assistant</p>
        <h2 id="landing-assistant" className="assistant__title">
          Ask your board anything.
        </h2>
        <p className="assistant__lead">
          Plain answers from your real board data, with the work behind them.
        </p>
        <p className="assistant__meta">
          Read-only · Bring your own AI key: Claude, OpenAI or your company’s
          model
        </p>
        <div className="assistant__actions">
          <a className="glass-button" data-variant="primary" href={signUpHref}>
            Try the assistant
          </a>
          <button
            type="button"
            className="assistant__link"
            aria-expanded={enterprise}
            aria-controls="assistant-enterprise"
            onClick={() => setEnterprise((value) => !value)}
          >
            See enterprise setup →
          </button>
        </div>
        <p
          id="assistant-enterprise"
          className="assistant__enterprise"
          hidden={!enterprise}
        >
          A workspace owner adds your company’s OpenAI-compatible endpoint and
          key in workspace settings. Questions and the board data behind them
          then go to that endpoint only, and the key stays encrypted on the
          server.
        </p>
      </div>

      <div
        className="aw"
        role="img"
        aria-label="Steerloom product window: someone asks what is blocking the mobile team; the assistant answers that Review is the bottleneck, holding 6 of 12 active items, and points at the Review column and item API-212 on the board."
      >
        <div className="aw__bar" aria-hidden="true">
          <span className="aw__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="aw__title">Briefing · Mobile team</span>
        </div>
        <AwBody linkOn={!still && linkOn} lit={lit}>
          <aside className="aw-panel" aria-hidden="true">
            <header className="aw-panel__head">
              <SteerloomMark size={17} />
              <strong>Ask Steerloom</strong>
              <span className="aw-model" key={view.model}>
                {view.model}
                <UiIcon icon={ChevronDown} size={14} />
              </span>
            </header>
            <div className="aw-thread">
              {question && (
                <div className="aw-msg aw-msg--user">
                  <p>
                    {question}
                    {viewPhase === 'typing' && <span className="aw-caret" />}
                  </p>
                  <time>now</time>
                </div>
              )}
              {viewPhase === 'thinking' && (
                <p className="aw-thinking">
                  <span />
                  <span />
                  <span />
                </p>
              )}
              {answerVisible && (
                <div className="aw-msg aw-msg--ai">
                  <p>
                    <b>{streamed.slice(0, viewLead).join(' ')}</b>
                    {streamed.length > viewLead &&
                      ` ${streamed.slice(viewLead).join(' ')}`}
                    {viewPhase === 'streaming' && <span className="aw-caret" />}
                  </p>
                  {view.forecast &&
                    (viewPhase === 'evidence' || viewPhase === 'done') && (
                      <span className="aw-track">
                        <span className="aw-track__fill" />
                        <span className="aw-track__runner">
                          <span className="aw-track__dot" />
                        </span>
                      </span>
                    )}
                  {viewShown > 0 && (
                    <div className="aw-evidence">
                      {view.evidence.slice(0, viewShown).map((item) => (
                        <span
                          key={item.label}
                          className="aw-chip"
                          data-target={item.target}
                        >
                          <UiIcon icon={item.icon} size={16} />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="aw-input">
              Ask about this board…
              <UiIcon icon={SendHorizontal} size={16} />
            </p>
          </aside>
        </AwBody>
      </div>
    </section>
  )
}

function answerWordsOf(exchange: (typeof EXCHANGES)[number]) {
  return [exchange.lead, exchange.rest].filter(Boolean).join(' ').split(' ')
}

/**
 * The window body: a muted mini board on the left, the assistant panel on the
 * right, and an overlay that briefly draws a dashed line from the API-212
 * evidence chip to the API-212 item on the board.
 */
function AwBody({
  lit,
  linkOn,
  children,
}: {
  lit: Set<string>
  linkOn: boolean
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [path, setPath] = useState('')

  useLayoutEffect(() => {
    if (!linkOn || !bodyRef.current) return
    const body = bodyRef.current
    const chip = body.querySelector('.aw-chip[data-target="api-212"]')
    const item = body.querySelector('.aw-board__chip[data-key="API-212"]')
    if (!chip || !item) return
    const box = body.getBoundingClientRect()
    const from = chip.getBoundingClientRect()
    const to = item.getBoundingClientRect()
    const x1 = from.left - box.left
    const y1 = from.top + from.height / 2 - box.top
    const x2 = to.right - box.left + 4
    const y2 = to.top + to.height / 2 - box.top
    const bend = Math.max(40, (x1 - x2) / 2)
    setPath(
      `M${x1} ${y1} C ${x1 - bend} ${y1}, ${x2 + bend} ${y2}, ${x2} ${y2}`,
    )
  }, [linkOn])

  return (
    <div className="aw__body" ref={bodyRef}>
      <div className="aw-board" aria-hidden="true">
        <p className="aw-board__title">Where work sits now</p>
        <div className="aw-board__lanes">
          {LANES.map((lane) => (
            <div
              key={lane.id}
              className="aw-board__lane"
              data-lit={
                lane.id === 'review' && lit.has('review') ? 'true' : undefined
              }
            >
              <div className="aw-board__stack">
                {lane.chips.map((key, index) => (
                  <span
                    key={key ?? `${lane.id}-${index}`}
                    className="aw-board__chip"
                    data-key={key ?? undefined}
                    data-lit={
                      key === 'API-212' && lit.has('api-212')
                        ? 'true'
                        : undefined
                    }
                    style={{ '--i': index } as CSSProperties}
                  >
                    {key}
                  </span>
                ))}
              </div>
              <span className="aw-board__name">{lane.name}</span>
            </div>
          ))}
        </div>
      </div>
      {children}
      {linkOn && path && (
        <svg className="aw-link" aria-hidden="true">
          <path d={path} pathLength={1} />
        </svg>
      )}
    </div>
  )
}
