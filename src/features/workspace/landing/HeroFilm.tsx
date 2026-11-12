import { Play } from 'lucide-react'
import { UiIcon } from '../../../components/UiIcon'

/*
 * The film in the hero: a wide, flat product window below the copy,
 * showing a poster frame from the film with a play button, two labels
 * overlapping its edges, and a soft thread ribbon behind it. Clicking it
 * opens the modal player (FilmPlayer).
 */

export const FILM_POSTER = `${import.meta.env.BASE_URL}video/loomy-poster-6.jpg`

export function HeroFilm({
  onOpen,
  onHover,
}: {
  /** Called with the card, so focus can come back to it afterwards. */
  onOpen: (opener: HTMLElement) => void
  onHover: (over: boolean) => void
}) {
  return (
    <div className="hfilm">
      <button
        type="button"
        className="hfilm__card"
        aria-label="Watch the film, with sound"
        onClick={(event) => onOpen(event.currentTarget)}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
      >
        <span className="hfilm__bar" aria-hidden="true">
          <span className="hfilm__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="hfilm__title">steerloom · the film</span>
        </span>
        <span className="hfilm__screen">
          <img
            src={FILM_POSTER}
            alt=""
            width={1280}
            height={720}
            loading="lazy"
            decoding="async"
          />
          <span className="hfilm__play" aria-hidden="true">
            <UiIcon icon={Play} size={26} />
          </span>
        </span>
      </button>
      <span className="hfilm__label hfilm__label--tr" aria-hidden="true">
        <small>The film</small>
        <strong>Sound on</strong>
      </span>
      <span className="hfilm__label hfilm__label--bl" aria-hidden="true">
        <small>Meet Loomy</small>
        <strong>faster code isn’t faster delivery</strong>
      </span>
    </div>
  )
}

/** Three twisted strands along a curve, as SVG path data. */
function strands(
  curve: Array<[number, number]>,
  amplitude = 2.6,
  period = 64,
): string[] {
  // Sample the Catmull-Rom spline through the curve's points.
  const points: Array<[number, number]> = []
  const at = (i: number) => curve[Math.max(0, Math.min(curve.length - 1, i))]!
  for (let i = 0; i < curve.length - 1; i += 1) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    for (let s = 0; s < 24; s += 1) {
      const t = s / 24
      const t2 = t * t
      const t3 = t2 * t
      points.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  points.push(at(curve.length - 1))
  let length = 0
  const lengths = points.map((p, i) => {
    if (i > 0) {
      const q = points[i - 1]!
      length += Math.hypot(p[0] - q[0], p[1] - q[1])
    }
    return length
  })
  return [0, 1, 2].map((k) =>
    points
      .map((p, i) => {
        const a = points[Math.max(0, i - 1)]!
        const b = points[Math.min(points.length - 1, i + 1)]!
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const d = Math.hypot(dx, dy) || 1
        const offset =
          amplitude *
          Math.sin((lengths[i]! / period) * Math.PI * 2 + (k / 3) * Math.PI * 2)
        const x = p[0] + (-dy / d) * offset
        const y = p[1] + (dx / d) * offset
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' '),
  )
}

// From the left margin beside the headline, down behind the film, out
// through the right edge.
const RIBBON: Array<[number, number]> = [
  [-40, 120],
  [200, 60],
  [420, 160],
  [620, 400],
  [900, 560],
  [1240, 520],
  [1480, 420],
]

const RIBBON_MOBILE: Array<[number, number]> = [
  [-40, 300],
  [300, 180],
  [760, 240],
  [1200, 420],
  [1480, 380],
]

/** The thread ribbon behind the hero: draws once, then stays still. */
export function HeroRibbon() {
  const wide = strands(RIBBON, 2.6, 64)
  const short = strands(RIBBON_MOBILE, 2.4, 56)
  return (
    <svg
      className="hero-ribbon"
      viewBox="0 0 1440 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hero-ribbon-tone" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8fb3ef" />
          <stop offset="1" stopColor="#c3b5ff" />
        </linearGradient>
        <filter
          id="hero-ribbon-soft"
          x="-10%"
          y="-40%"
          width="120%"
          height="180%"
        >
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {[wide, short].map((set, which) => (
        <g
          key={which}
          className={which === 0 ? 'hero-ribbon__wide' : 'hero-ribbon__short'}
        >
          <path
            d={set[1]}
            className="hero-ribbon__glow"
            pathLength={1}
            filter="url(#hero-ribbon-soft)"
          />
          {set.map((d, k) => (
            <path
              key={k}
              d={d}
              className="hero-ribbon__strand"
              pathLength={1}
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
