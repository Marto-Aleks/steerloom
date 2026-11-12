import type { HTMLAttributes, ReactNode } from 'react'
import {
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { UiIcon } from '../UiIcon'

export type StatusMessageVariant =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'loading'

export interface StatusMessageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  children: ReactNode
  icon?: ReactNode
  title?: ReactNode
  variant?: StatusMessageVariant
}

export function StatusMessage({
  children,
  className = '',
  icon,
  role,
  title,
  variant = 'info',
  ...props
}: StatusMessageProps) {
  const isError = variant === 'error'
  const isLoading = variant === 'loading'

  return (
    <div
      className={`status-message ${className}`.trim()}
      data-variant={variant}
      role={role ?? (isError ? 'alert' : 'status')}
      aria-atomic="true"
      aria-busy={isLoading || undefined}
      aria-live={isError ? 'assertive' : 'polite'}
      {...props}
    >
      <span className="status-message__icon" aria-hidden="true">
        {icon ?? <StatusIcon variant={variant} />}
      </span>
      <div className="status-message__content">
        {title && <p className="status-message__title">{title}</p>}
        <div className="status-message__body">{children}</div>
      </div>
    </div>
  )
}

const statusIcons: Record<
  Exclude<StatusMessageVariant, 'loading'>,
  LucideIcon
> = {
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
  info: Info,
}

function StatusIcon({ variant }: { variant: StatusMessageVariant }) {
  if (variant === 'loading') {
    return <span className="status-message__spinner" />
  }

  return (
    <UiIcon icon={statusIcons[variant]} className="status-message__symbol" />
  )
}
