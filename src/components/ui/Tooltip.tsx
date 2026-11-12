import { useId, type ReactNode } from 'react'

interface TooltipProps {
  children: ReactNode
  content: string
  placement?: 'top' | 'right' | 'bottom' | 'left'
}

export function Tooltip({
  children,
  content,
  placement = 'right',
}: TooltipProps) {
  const tooltipId = useId()
  return (
    <span
      className="tooltip-anchor"
      data-placement={placement}
      aria-describedby={tooltipId}
    >
      {children}
      <span id={tooltipId} role="tooltip" className="glass-tooltip">
        {content}
      </span>
    </span>
  )
}
