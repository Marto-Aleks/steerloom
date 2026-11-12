import type { CSSProperties, ReactNode } from 'react'
import { useRevealOnce } from './reveal'

function LockIcon() {
  return (
    <svg viewBox="0 0 48 48" className="trust-icon trust-icon--lock">
      <path className="trust-icon__shackle" d="M15 22v-6a9 9 0 0 1 18 0v6" />
      <rect x="10" y="22" width="28" height="20" rx="5" />
      <path d="M24 30v5" />
    </svg>
  )
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 48 48" className="trust-icon trust-icon--receipt">
      <path d="M9 9h30" className="trust-icon__roller" />
      <g className="trust-icon__paper">
        <path d="M13 10v29l4-3 4 3 3-3 3 3 4-3 4 3V10" />
        <path d="M18 18h12M18 24h12M18 30h7" />
      </g>
    </svg>
  )
}

function ToggleIcon() {
  return (
    <svg viewBox="0 0 64 48" className="trust-icon trust-icon--toggle">
      <path
        className="trust-icon__cloud"
        d="M10 18a5 5 0 0 1 1-10 6 6 0 0 1 11 2 4 4 0 0 1 0 8z"
      />
      <g className="trust-icon__server">
        <rect x="44" y="6" width="14" height="6" rx="2" />
        <rect x="44" y="14" width="14" height="6" rx="2" />
      </g>
      <rect x="14" y="28" width="36" height="16" rx="8" />
      <circle className="trust-icon__knob" cx="22" cy="36" r="5" />
    </svg>
  )
}

const points: ReadonlyArray<{
  icon: ReactNode
  title: string
  body: string
}> = [
  {
    icon: <LockIcon />,
    title: 'Read-only. Always.',
    body: 'Steerloom reads your board and never changes a thing.',
  },
  {
    icon: <ReceiptIcon />,
    title: 'Every number shows its math.',
    body: 'Open any figure to see exactly how it was calculated.',
  },
  {
    icon: <ToggleIcon />,
    title: 'Cloud, or your own machine.',
    body: 'Run it locally: only the AI you choose sees board data.',
  },
]

/** Full-width dark band: the page's one change of mood, for trust. */
export function TrustSection() {
  const [ref, revealed] = useRevealOnce<HTMLElement>(0.35)
  return (
    <section
      ref={ref}
      className="trust"
      data-revealed={revealed ? 'true' : undefined}
      aria-labelledby="landing-trust"
    >
      <div className="trust__inner">
        <h2 id="landing-trust" className="trust__title">
          Your board stays yours
        </h2>
        <ul className="trust__points">
          {points.map((point, index) => (
            <li key={point.title} style={{ '--i': index } as CSSProperties}>
              <span className="trust__icon" aria-hidden="true">
                {point.icon}
              </span>
              <strong>{point.title}</strong>
              <span>{point.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
