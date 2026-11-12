import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../analysis/motion'

/**
 * True once the element has been on screen; it never turns back off, so
 * scroll reveals fire once. Without IntersectionObserver (tests, very old
 * browsers) the content is shown straight away.
 */
export function useRevealOnce<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    if (seen || !ref.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { threshold },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [seen, threshold])
  return [ref, seen] as const
}

/**
 * Counts from zero to `target` once `run` turns true, easing out like the
 * reveal animations. Reduced motion shows the final value at once.
 */
export function useCountUp(
  target: number,
  run: boolean,
  { duration = 1200, delay = 0, decimals = 0 } = {},
) {
  const reducedMotion = usePrefersReducedMotion()
  // Starts at zero where a reveal will play, so the number never flashes.
  const [value, setValue] = useState(() =>
    typeof IntersectionObserver === 'undefined' ? target : 0,
  )
  useEffect(() => {
    if (!run || reducedMotion) return
    let frame = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration))
      setValue(target * (1 - (1 - t) ** 3))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [run, reducedMotion, target, duration, delay])
  return (reducedMotion ? target : value).toFixed(decimals)
}
