import type { CSSProperties } from 'react'
import { useRevealOnce } from './reveal'

const rows: ReadonlyArray<{ tone: string; label: string; text: string }> = [
  {
    tone: 'danger',
    label: 'At risk',
    text: 'Checkout redesign: 9 days in progress, 3x the usual',
  },
  {
    tone: 'warning',
    label: 'Bottleneck',
    text: 'Review has 6 items waiting, the oldest for 11 days',
  },
  {
    tone: 'info',
    label: 'Forecast',
    text: 'Current work: 85% likely done by Nov 21',
  },
]

/** The loudest block on the page, with a briefing peeking up from below. */
export function ClosingCta({
  signUpHref,
  localHref,
}: {
  signUpHref: string
  localHref: string
}) {
  const [ref, revealed] = useRevealOnce<HTMLElement>(0.3)
  return (
    <section
      ref={ref}
      className="cta"
      data-revealed={revealed ? 'true' : undefined}
      aria-labelledby="landing-closing"
    >
      <span className="cta__blob cta__blob--one" aria-hidden="true" />
      <span className="cta__blob cta__blob--two" aria-hidden="true" />
      <div className="cta__copy">
        <h2 id="landing-closing" className="cta__title">
          Your first briefing is five minutes away
        </h2>
        <p className="cta__lead">
          Connect your board read-only and see what’s stuck, what needs a
          decision, and when work will land.
        </p>
        <div className="cta__actions">
          <a className="cta__button" href={signUpHref}>
            Connect my board
          </a>
          <a className="cta__link" href={localHref}>
            Run it locally →
          </a>
        </div>
        <p className="cta__trust">Read-only · Self-host option</p>
      </div>
      <div className="cta__peek" aria-hidden="true">
        <div className="cta__card">
          <p className="cta__card-title">
            <strong>Monday briefing</strong>
            <span>3 things need you today</span>
          </p>
          {rows.map((row, index) => (
            <p
              className="cta__row"
              data-tone={row.tone}
              key={row.label}
              style={{ '--i': index } as CSSProperties}
            >
              <b>{row.label}</b>
              <span>{row.text}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
