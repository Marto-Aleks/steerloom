import { useEffect, useState, type CSSProperties } from 'react'

/*
 * Briefing motion (Focused volume). One place for the timings so the whole
 * screen can be tuned together; motion.css reads `--sl-delay`.
 *
 *  - The hero enters first, everything else follows STAGGER_MS apart.
 *  - Staggering stops after STAGGER_CAP steps; the rest arrives together.
 *  - No element animates for longer than 500ms.
 */
export const STAGGER_MS = 60
export const STAGGER_CAP = 8
export const COUNT_UP_MS = 500

// Staggers the shared `sl-*` entrance animations via the `--sl-delay` custom
// property. Animations run once when the element mounts.
export function stagger(
  step: number,
  interval = STAGGER_MS,
  base = 0,
): CSSProperties {
  const capped = Math.min(Math.max(0, step), STAGGER_CAP)
  return { '--sl-delay': `${base + capped * interval}ms` } as CSSProperties
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// Recharts does not read the media query itself; charts animate in once on
// mount unless the viewer asked for reduced motion.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(REDUCED_MOTION).matches,
  )
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return
    const query = window.matchMedia(REDUCED_MOTION)
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

const COUNTED_KEY = 'steerloom:briefing-counted'

function readCounted(): boolean {
  try {
    return window.sessionStorage.getItem(COUNTED_KEY) === '1'
  } catch {
    return true
  }
}

function markCounted() {
  try {
    window.sessionStorage.setItem(COUNTED_KEY, '1')
  } catch {
    /* Storage blocked: the number simply counts again next time. */
  }
}

// Counting needs a real browser with motion allowed; tests, reduced motion and
// later visits in the same session show the final value straight away.
function shouldCountUp(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  if (typeof window.requestAnimationFrame !== 'function') return false
  if (window.matchMedia(REDUCED_MOTION).matches) return false
  return !readCounted()
}

/**
 * The briefing's hero number counts up once per browser session, easing out,
 * and always lands on the exact value.
 */
export function useCountUpOncePerSession(
  target: number,
  { duration = COUNT_UP_MS, delay = 0, enabled = true } = {},
): number {
  const [running, setRunning] = useState(() => enabled && shouldCountUp())
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!running) return
    markCounted()
    let frame = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration))
      setValue(target * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else setRunning(false)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, target, duration, delay])

  return running ? Math.round(value) : target
}

export const chartAnimation = {
  animationDuration: 500,
  animationEasing: 'ease-out',
  animationBegin: 120,
} as const
