import { SteerloomMark } from './SteerloomMark'

interface WordmarkProps {
  className?: string
  compact?: boolean
}

export function Wordmark({ className = '', compact = false }: WordmarkProps) {
  return (
    <div
      className={`wordmark ${className}`.trim()}
      data-compact={compact || undefined}
    >
      <SteerloomMark className="wordmark__mark" size={21} />
      <span className="wordmark__label">Steerloom</span>
    </div>
  )
}
