import { useId } from 'react'

/**
 * The Steerloom mark: two stacks of tickets on a board. One ticket has moved
 * from the left stack to the top of the right stack, and a fading trail shows
 * where it came from.
 *
 * Geometry lives on an 84 × 66 grid (columns 38 wide, 8 apart; tickets 18
 * tall, 6 apart). The trail is decoration: drop it below about 16 px high,
 * where it turns to noise. Colours come from the --brand-mark-* tokens, so the
 * mark follows the light and dark theme. `tone="white"` is for filled brand
 * buttons and other coloured backgrounds.
 */
export type SteerloomMarkTone = 'brand' | 'white'

interface SteerloomMarkProps {
  className?: string
  /** Rendered height in px. Width follows the 84:66 ratio. */
  size?: number
  /** Show the fading trail. Defaults to true from 16 px high. */
  trail?: boolean
  tone?: SteerloomMarkTone
  /** Accessible name. Leave empty when the mark sits next to visible text. */
  title?: string
}

const TICKET = { width: 38, height: 18, radius: 9 }
const RESTING = [
  [0, 24],
  [0, 48],
  [46, 24],
  [46, 48],
] as const
const MOVED = [46, 0] as const
const TRAIL = 'M0 9C0 7.5 14 3 49 0H55V18H49C14 15 0 10.5 0 9Z'

export function SteerloomMark({
  className = '',
  size = 20,
  trail,
  tone = 'brand',
  title,
}: SteerloomMarkProps) {
  const id = useId().replace(/:/g, '')
  const showTrail = trail ?? size >= 16
  const white = tone === 'white'
  const ink = white ? '#ffffff' : 'var(--brand-mark-ink)'
  const ticketFill = white ? '#ffffff' : `url(#${id}-ticket)`

  return (
    <svg
      className={`steerloom-mark ${className}`.trim()}
      width={(size * 84) / 66}
      height={size}
      viewBox="0 0 84 66"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-ticket`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-mark-start)' }} />
          <stop
            offset="0.5"
            style={{ stopColor: 'var(--brand-mark-middle)' }}
          />
          <stop offset="1" style={{ stopColor: 'var(--brand-mark-end)' }} />
        </linearGradient>
        <linearGradient
          id={`${id}-trail`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="55"
          y2="0"
        >
          <stop
            offset="0"
            style={{
              stopColor: white ? '#ffffff' : 'var(--brand-mark-start)',
              stopOpacity: 0,
            }}
          />
          <stop
            offset="1"
            style={{
              stopColor: white ? '#ffffff' : 'var(--brand-mark-middle)',
              stopOpacity: 0.85,
            }}
          />
        </linearGradient>
      </defs>
      {RESTING.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={TICKET.width}
          height={TICKET.height}
          rx={TICKET.radius}
          fill={ink}
          fillOpacity={white ? 0.55 : undefined}
        />
      ))}
      {showTrail && <path d={TRAIL} fill={`url(#${id}-trail)`} />}
      <rect
        x={MOVED[0]}
        y={MOVED[1]}
        width={TICKET.width}
        height={TICKET.height}
        rx={TICKET.radius}
        fill={ticketFill}
      />
    </svg>
  )
}
