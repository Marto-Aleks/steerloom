import type { HTMLAttributes, ReactNode } from 'react'

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  tone?: StatusTone
  showDot?: boolean
}

export function StatusBadge({
  children,
  className = '',
  tone = 'neutral',
  showDot = false,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={`status-badge ${className}`.trim()}
      data-tone={tone}
      {...props}
    >
      {showDot && <span className="status-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
