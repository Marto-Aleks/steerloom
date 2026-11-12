import type { CSSProperties } from 'react'

/* Inline `--sl-delay` for the shared motion classes in src/styles/motion.css. */
export function stagger(delayMs: number): CSSProperties {
  return { '--sl-delay': `${delayMs}ms` } as CSSProperties
}
