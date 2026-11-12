import type { HTMLAttributes, ReactNode } from 'react'
import type { GlassElevation, GlassTone } from './GlassPanel'

interface GlassCardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  elevation?: GlassElevation
  tone?: GlassTone
}

export function GlassCard({
  children,
  className = '',
  elevation = 'base',
  tone = 'adaptive',
  ...props
}: GlassCardProps) {
  return (
    <article
      className={`glass-card ${className}`.trim()}
      data-elevation={elevation}
      data-tone={tone}
      {...props}
    >
      {children}
    </article>
  )
}
