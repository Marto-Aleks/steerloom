import { useId } from 'react'

/**
 * Loomy, the dot from the film: a smooth, glossy blue blob with two eyes and
 * no mouth. This is the film's drawing (the video project's src/dot/Dot.tsx)
 * as a still: the same body, eyes, cheeks and highlights, with the motion
 * left to CSS. Expression lives in the eyes.
 *
 * Geometry lives on a 260 × 232 grid; Loomy stands on the bottom edge.
 * Colours come from the --loomy-* tokens.
 */
interface Face {
  /** −1 lowered … 1 raised */
  browRaise: number
  /** Inner ends up */
  browWorry: number
  /** One eye a little bigger */
  browAsym: number
  /** 0.2 … 1.2 */
  eyeOpen: number
  /** −1 … 1 */
  lookX: number
  lookY: number
  /** Above 0.55 the eyes close into smiling arcs */
  mouthCurve: number
  cheeks: number
}

const FACES = {
  calm: face(0, 0, 0, 1, 0.2, 0, 0.3, 0),
  overwhelmed: face(0.9, 0.55, 0, 1.2, 0, -0.2, -0.4, 0),
  curious: face(0.6, 0, 0.6, 1.08, 0.9, -0.2, 0.2, 0),
  focused: face(-0.35, 0.25, 0, 0.7, 0.9, 0.1, 0.05, 0),
  relieved: face(0.2, 0.1, 0, 0.6, 0.2, 0.2, 0.7, 0.5),
  proud: face(0.2, 0, 0, 0.95, 0, -0.2, 1, 0.7),
  delighted: face(0.35, 0, 0, 1, 0, -0.1, 1, 0.8),
  surprised: face(1, 0, 0, 1.25, 0.3, -0.35, 0, 0),
  confident: face(-0.15, 0, 0.2, 0.95, 0.5, -0.05, 0.5, 0.45),
  worried: face(0.25, 1, 0, 0.95, 0.4, 0.1, -0.3, 0),
  reading: face(-0.2, 0, 0, 0.85, 0.8, 0.4, 0.1, 0),
} satisfies Record<string, Face>

function face(
  browRaise: number,
  browWorry: number,
  browAsym: number,
  eyeOpen: number,
  lookX: number,
  lookY: number,
  mouthCurve: number,
  cheeks: number,
): Face {
  return {
    browRaise,
    browWorry,
    browAsym,
    eyeOpen,
    lookX,
    lookY,
    mouthCurve,
    cheeks,
  }
}

export type LoomyFace = keyof typeof FACES
export const LOOMY_FACES = Object.keys(FACES) as LoomyFace[]

/* The body: a symmetric squircle, a little wider than tall, with a slightly
 * flatter base. Centre (0, CY); it stands on y = 0. */
const CY = -104
const RX = 122
const RY = 104
const EYE_Y = -112
const BODY = (() => {
  const count = 96
  const points: Array<{ x: number; y: number }> = []
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const exponent = 2.6
    points.push({
      x: Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent) * RX,
      y:
        CY -
        Math.sign(sin) *
          Math.pow(Math.abs(sin), 2 / exponent) *
          RY *
          (sin > 0 ? 1.08 : 0.92),
    })
  }
  const at = (index: number) => points[(index + count) % count]!
  let path = `M ${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`
  for (let index = 0; index < count; index++) {
    const p0 = at(index - 1)
    const p1 = at(index)
    const p2 = at(index + 1)
    const p3 = at(index + 2)
    path += ` C ${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return `${path} Z`
})()

interface LoomyProps {
  face?: LoomyFace
  /** Rendered width in px. Height follows the 260:232 ratio. */
  size?: number
  /** Where the eyes look, −1 … 1 on each axis. Defaults to the face's own. */
  look?: { x: number; y: number }
  className?: string
  /** Accessible name. Leave empty when Loomy is decoration. */
  title?: string
}

export function Loomy({
  face: name = 'calm',
  size = 48,
  look,
  className = '',
  title,
}: LoomyProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const value = FACES[name]
  const lookX = look?.x ?? value.lookX
  const lookY = look?.y ?? value.lookY
  const px = lookX * 15
  const py = lookY * 10
  const happy = Math.max(0, value.mouthCurve - 0.55) / 0.45
  const worry = value.browWorry
  const narrow = Math.max(0, -value.browRaise)
  const wide = Math.max(0, value.browRaise) * 0.25
  const open = Math.min(1.2, value.eyeOpen)
  const rx = 17 * (1 + Math.max(0, value.eyeOpen - 1.05) * 0.9)
  const ryBase = 22 * Math.min(1.25, open + wide) * (1 - narrow * 0.6)

  const eye = (cx: number, side: 1 | -1) => {
    const x = cx + px
    const y = EYE_Y + py
    const ry = ryBase * (1 + (side < 0 ? value.browAsym * 0.22 : 0))
    const tilt = worry * 5 * side - narrow * 4 * side
    // The upper lid cuts the eye along a slanted line (worry droops the outer
    // corner, focus lowers the inner one); cheeks push up from below.
    const drop = worry * 0.32 + narrow * 0.3
    const slope = (narrow - worry) * 0.55 * side
    const top = y - ry + drop * 2 * ry
    const lid = (at: number) => top + slope * (at - x)
    const bottom = y + ry - value.cheeks * 0.45 * ry
    const clip = `${id}-lid${side}`
    return (
      <g transform={`rotate(${tilt} ${cx} ${EYE_Y})`}>
        <clipPath id={clip}>
          <path
            d={`M ${x - 40} ${lid(x - 40)} L ${x + 40} ${lid(x + 40)} L ${x + 40} ${bottom} L ${x - 40} ${bottom} Z`}
          />
        </clipPath>
        {happy < 0.7 && (
          <g
            clipPath={`url(#${clip})`}
            opacity={1 - Math.max(0, happy - 0.3) / 0.4}
          >
            <ellipse
              cx={x}
              cy={y}
              rx={rx * (1 + (side < 0 ? value.browAsym * 0.12 : 0))}
              ry={ry}
              fill={`url(#${id}-eye)`}
            />
            <ellipse
              cx={x - 5}
              cy={y - ry * 0.5}
              rx={4.8}
              ry={Math.min(3.6, ry * 0.3)}
              fill="var(--loomy-shine)"
              opacity={0.95}
            />
          </g>
        )}
        {happy > 0.3 && (
          <path
            d={`M ${cx - 16 + px} ${EYE_Y + 5 + py} Q ${cx + px} ${EYE_Y - 22 + py} ${cx + 16 + px} ${EYE_Y + 5 + py}`}
            stroke="var(--loomy-smile)"
            strokeWidth={6.5}
            strokeLinecap="round"
            fill="none"
            opacity={Math.min(1, (happy - 0.3) / 0.4)}
          />
        )}
      </g>
    )
  }

  return (
    <svg
      className={`loomy ${className}`.trim()}
      width={size}
      height={(size * 232) / 260}
      viewBox="-130 -224 260 232"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="22%" r="85%">
          <stop offset="0%" stopColor="var(--loomy-body-light)" />
          <stop offset="35%" stopColor="var(--loomy-body)" />
          <stop offset="75%" stopColor="var(--loomy-body-deep)" />
          <stop offset="100%" stopColor="var(--loomy-body-shade)" />
        </radialGradient>
        <radialGradient id={`${id}-eye`} cx="42%" cy="38%" r="68%">
          <stop offset="0%" stopColor="var(--loomy-eye-light)" />
          <stop offset="65%" stopColor="var(--loomy-eye)" />
          <stop offset="100%" stopColor="var(--loomy-eye-deep)" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${id}-blush`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <clipPath id={`${id}-clip`}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <path d={BODY} fill={`url(#${id}-body)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <ellipse
          cx={0}
          cy={-14}
          rx={96}
          ry={22}
          fill="var(--loomy-bounce)"
          opacity={0.28}
          filter={`url(#${id}-soft)`}
        />
      </g>
      <ellipse
        cx={-56}
        cy={-190}
        rx={17}
        ry={9}
        fill="var(--loomy-shine)"
        opacity={0.9}
        transform="rotate(-24 -56 -190)"
      />
      <ellipse
        cx={-36}
        cy={-200}
        rx={5}
        ry={3}
        fill="var(--loomy-shine)"
        opacity={0.7}
        transform="rotate(-24 -36 -200)"
      />
      {value.cheeks > 0 && (
        <>
          <ellipse
            cx={-58}
            cy={-86}
            rx={19}
            ry={10}
            fill="var(--loomy-blush)"
            opacity={value.cheeks * 0.5}
            filter={`url(#${id}-blush)`}
          />
          <ellipse
            cx={58}
            cy={-86}
            rx={19}
            ry={10}
            fill="var(--loomy-blush)"
            opacity={value.cheeks * 0.5}
            filter={`url(#${id}-blush)`}
          />
        </>
      )}
      {eye(-30, 1)}
      {eye(30, -1)}
      {value.browRaise > 0.6 && value.browWorry > 0.35 && (
        <path
          d="M 92 -196 C 84 -182 80 -174 80 -168 A 12 12 0 0 0 104 -168 C 104 -174 100 -182 92 -196 Z"
          fill="var(--loomy-drop)"
          stroke="var(--loomy-drop-edge)"
          strokeWidth={2}
          opacity={Math.min(1, (value.browRaise - 0.6) / 0.25) * 0.95}
        />
      )}
    </svg>
  )
}
