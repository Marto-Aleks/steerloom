import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * primary: the one main action per view (accent fill).
 * secondary: plain surface with a strong line.
 * quiet: accent text link style for low-emphasis actions.
 * danger: destructive action; secondary shape with danger text.
 * icon: round, icon-only; always pass an aria-label.
 */
export type GlassButtonVariant =
  | 'primary'
  | 'secondary'
  | 'quiet'
  | 'danger'
  | 'icon'

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: GlassButtonVariant
  size?: 'regular' | 'compact'
}

export function GlassButton({
  children,
  className = '',
  type = 'button',
  variant = 'secondary',
  size = 'regular',
  ...props
}: GlassButtonProps) {
  return (
    <button
      type={type}
      className={`glass-button ${className}`.trim()}
      data-size={size}
      data-variant={variant}
      {...props}
    >
      {children}
    </button>
  )
}
