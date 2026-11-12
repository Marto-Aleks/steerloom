import { useEffect, useState } from 'react'
import { Circle, CircleCheck, CircleDot, type LucideIcon } from 'lucide-react'
import type { ProgressEvent } from '../../lib/progress'
import { UiIcon } from '../UiIcon'

const stepIcons: Record<'done' | 'current' | 'next', LucideIcon> = {
  done: CircleCheck,
  current: CircleDot,
  next: Circle,
}

/**
 * Shows what a long operation is doing right now: the step list, the current
 * detail, a bar when the total is known and the time so far. Falls back to
 * the first step while no event has arrived yet.
 */
export function ProgressStatus({
  steps,
  event,
  className = '',
}: {
  /** Ordered steps: id and plain-language label. */
  steps: ReadonlyArray<{ step: string; label: string }>
  /** Latest event from the server, if any. */
  event?: ProgressEvent | null
  className?: string
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [])
  const currentIndex = Math.max(
    0,
    steps.findIndex((item) => item.step === event?.step),
  )
  const label = event?.label ?? steps[0]?.label ?? 'Working…'
  const fraction =
    event?.total && event.done !== undefined
      ? Math.min(1, event.done / event.total)
      : null
  return (
    <div
      className={`progress-status ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="progress-status__current">
        <span className="progress-status__spinner" aria-hidden="true" />
        <strong>{label}</strong>
        {event?.detail && (
          <span className="progress-status__detail">{event.detail}</span>
        )}
        {seconds >= 3 && (
          <span className="progress-status__time" aria-hidden="true">
            {seconds}s
          </span>
        )}
      </div>
      {fraction !== null && (
        <div
          className="progress-status__bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={event?.total}
          aria-valuenow={event?.done}
        >
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}
      {steps.length > 1 && (
        <ol className="progress-status__steps">
          {steps.map((item, index) => {
            const state =
              index < currentIndex
                ? 'done'
                : index === currentIndex
                  ? 'current'
                  : 'next'
            return (
              <li key={item.step} data-state={state}>
                <UiIcon
                  icon={stepIcons[state]}
                  size={16}
                  className="progress-status__step-icon"
                />
                {item.label}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
