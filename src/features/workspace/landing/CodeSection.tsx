import type { CSSProperties } from 'react'
import { useRevealOnce } from './reveal'

/*
 * "Board and code, read together": what GitHub adds, and that it runs on the
 * visitor's own computer. Three tickets from the open demo, each with what
 * the board says and what the code says, in the briefing's own words, so the
 * page promises nothing the product lacks.
 */
type Tone = 'merged' | 'danger' | 'waiting'

/** The code trail has four steps: branch, pull request, review, merged. */
const STEPS = 4

const TICKETS: ReadonlyArray<{
  key: string
  code: string
  tone: Tone
  /** How many of the four steps the code has passed. */
  reached: number
}> = [
  { key: 'DEMO-31', code: 'Merged 4 days ago', tone: 'merged', reached: 4 },
  { key: 'DEMO-33', code: 'Approved, checks fail', tone: 'danger', reached: 3 },
  {
    key: 'DEMO-34',
    code: 'No first look · 5 days',
    tone: 'waiting',
    reached: 2,
  },
]

export function CodeSection({
  localHref,
  demoHref,
}: {
  localHref: string
  demoHref: string
}) {
  const [ref, revealed] = useRevealOnce<HTMLElement>(0.25)
  return (
    <section
      ref={ref}
      className="codeview"
      data-revealed={revealed ? 'true' : undefined}
      aria-labelledby="landing-code"
    >
      <div
        className="codeview__tickets"
        role="img"
        aria-label="Three items from the demo board, all in progress on the board. In the code, DEMO-31 was merged 4 days ago, DEMO-33 is approved but its checks fail, and DEMO-34 has waited 5 days for a first look."
      >
        {TICKETS.map((ticket, index) => (
          <div
            key={ticket.key}
            className="ct"
            data-tone={ticket.tone}
            data-hero={index === 0 ? 'true' : undefined}
            style={{ '--i': index } as CSSProperties}
            aria-hidden="true"
          >
            <span className="ct__key">{ticket.key}</span>
            <span className="ct__side">
              <span className="ct__label">Board</span>
              <span className="ct__state">In progress</span>
            </span>
            <span className="ct__side ct__side--code">
              <span className="ct__label">Code</span>
              <span className="ct__state">{ticket.code}</span>
              <span className="ct__trail">
                {Array.from({ length: STEPS }, (_, step) => (
                  <i
                    key={step}
                    data-on={step < ticket.reached ? 'true' : undefined}
                    data-last={step === ticket.reached - 1 ? 'true' : undefined}
                    style={{ '--s': step } as CSSProperties}
                  />
                ))}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="codeview__copy">
        <p className="assistant__eyebrow">Board and code, read together</p>
        <h2 id="landing-code" className="assistant__title">
          The board says in progress.{' '}
          <span className="codeview__accent">The code says merged.</span>
        </h2>
        <p className="assistant__lead">
          Connect GitHub and Steerloom shows where the two disagree.
        </p>
        <p className="assistant__meta">
          Read-only · Your token stays on your computer
        </p>
        <div className="assistant__actions">
          <a className="glass-button" data-variant="primary" href={localHref}>
            Run it on your computer
          </a>
          <a className="assistant__link" href={demoHref}>
            See it in the demo →
          </a>
        </div>
      </div>
    </section>
  )
}
