import type { HTMLAttributes, ReactNode, Ref } from 'react'

export type GlassElevation = 'base' | 'raised' | 'floating'
export type GlassTone = 'adaptive' | 'clear' | 'solid'

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
  children: ReactNode
  elevation?: GlassElevation
  tone?: GlassTone
}

export function GlassPanel({
  children,
  className = '',
  elevation = 'raised',
  tone = 'adaptive',
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={`glass-panel ${className}`.trim()}
      data-elevation={elevation}
      data-tone={tone}
      {...props}
    >
      {children}
    </div>
  )
}
