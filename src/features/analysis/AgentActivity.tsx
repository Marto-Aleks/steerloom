import { useEffect, useState } from 'react'
import type { ProgressEvent } from '../../lib/progress'

/** Older steps fold into a count so the log stays short. */
const SHOWN = 8

/**
 * What Steerloom AI is doing, as a running log: each read as a line with its
 * detail under it, the model's own notes as plain text, and the current
 * activity last, with the time so far. A log, not a checklist: nothing here
 * is a step to tick off.
 */
export function AgentActivity({
  event,
  history,
}: {
  event?: ProgressEvent | null
  /** What already happened, oldest first. */
  history: ReadonlyArray<ProgressEvent>
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
  const shown = history.slice(-SHOWN)
  const label = event?.label ?? 'Starting'
  return (
    <div
      className="agent-activity"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {history.length > SHOWN && (
        <p className="agent-activity__more">
          {history.length - SHOWN} earlier steps
        </p>
      )}
      {shown.map((item, index) =>
        item.step === 'note' ? (
          <p key={`${index}-${item.label}`} className="agent-activity__note">
            {item.label}
          </p>
        ) : (
          <ActivityLine key={`${index}-${item.label}`} item={item} />
        ),
      )}
      <div className="agent-activity__now">
        <span className="agent-activity__spark" aria-hidden="true">
          ✻
        </span>
        <span className="agent-activity__label">{label}…</span>
        {seconds >= 2 && (
          <span className="agent-activity__time" aria-hidden="true">
            {seconds}s
          </span>
        )}
      </div>
      {event?.detail && (
        <p className="agent-activity__sub agent-activity__sub--now">
          {event.detail}
        </p>
      )}
    </div>
  )
}

/**
 * One read on one line: "Read FICT-12 in detail · Jira". A search keeps what
 * it looked for; the rest of the description stays in the confirmation.
 */
function ActivityLine({ item }: { item: ProgressEvent }) {
  const split = item.label.indexOf(': ')
  const action = split > 0 ? item.label.slice(0, split) : item.label
  const what =
    /^Search\b/.test(action) && split > 0 ? item.label.slice(split + 2) : ''
  const source = (item.detail ?? '')
    .replace(/^Read-only · /, '')
    .replace(/, already loaded$/, '')
  return (
    <p className="agent-activity__action">
      <span className="agent-activity__dot" aria-hidden="true" />
      <span>
        {what ? `Search: ${what}` : action}
        {source && <span className="agent-activity__source"> · {source}</span>}
      </span>
    </p>
  )
}
