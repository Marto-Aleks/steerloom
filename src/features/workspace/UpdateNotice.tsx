import { useEffect, useState } from 'react'
import { ArrowDownToLine, Check, CircleCheck, Copy } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import { GlassButton, GlassModal } from '../../components/ui'

/*
 * The installed app's "Update available" pill. The local server asks
 * steerloom.app for the current version (server/local/update-check.ts); this
 * only reads its answer. Never shown on the hosted site, which is always
 * current, or when the check could not reach steerloom.app.
 *
 * "Update now" asks the local server to run the installer itself
 * (server/local/self-update.ts). Steerloom closes for a moment and reopens
 * in its own window, signed in. The pasted command stays one click away, and is
 * what the sheet falls back to when the update cannot start or finish.
 */
export interface LocalUpdate {
  current: string
  available: boolean
  latest?: string
  notes?: string[]
  updateUrl: string
}

interface UpdateCommand {
  command: string
  windowsCommand: string
}

export type UpdatePhase = 'ready' | 'updating' | 'done' | 'failed'

const LATER_KEY = 'steerloom:update-later'
const LATER_DAYS = 3
const HOUR = 60 * 60 * 1000
/** While it updates, ask every two seconds whether the new version answers. */
const ASK_EVERY = 2000
/** Longer than this and something went wrong: offer the command instead. */
const GIVE_UP_AFTER = 3 * 60 * 1000

function hiddenFor(version: string): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(LATER_KEY) ?? 'null') as {
      version?: unknown
      until?: unknown
    } | null
    return (
      saved?.version === version &&
      typeof saved.until === 'number' &&
      saved.until > Date.now()
    )
  } catch {
    return false
  }
}

function hideFor(version: string) {
  try {
    localStorage.setItem(
      LATER_KEY,
      JSON.stringify({ version, until: Date.now() + LATER_DAYS * 24 * HOUR }),
    )
  } catch {
    /* No storage: the pill simply stays. */
  }
}

const readUpdate = (refresh: boolean) =>
  fetch(`/api/local/update${refresh ? '?refresh=1' : ''}`, {
    headers: { Accept: 'application/json' },
  }).then((response) =>
    response.ok ? (response.json() as Promise<LocalUpdate>) : null,
  )

export function UpdateNotice() {
  const [update, setUpdate] = useState<LocalUpdate | null>(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<UpdatePhase>('ready')
  const hosted =
    document
      .querySelector('meta[name="steerloom-mode"]')
      ?.getAttribute('content') === 'hosted'

  useEffect(() => {
    if (hosted) return
    const read = (refresh: boolean) =>
      readUpdate(refresh)
        .then((value) => {
          if (!value?.available || !value.latest) return
          setUpdate(value)
          setHidden(hiddenFor(value.latest))
        })
        // The development server has no update check; nothing to show.
        .catch(() => undefined)
    // Ask on load (the server lets a fresh check through once a minute),
    // then hourly, and again as soon as the computer is back online.
    void read(true)
    const timer = window.setInterval(() => void read(true), HOUR)
    const online = () => void read(true)
    window.addEventListener('online', online)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', online)
    }
  }, [hosted])

  // While the installer runs the server is gone for a moment: keep asking
  // until a copy that is no longer behind answers.
  useEffect(() => {
    if (phase !== 'updating') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      if (Date.now() - started > GIVE_UP_AFTER) {
        setPhase('failed')
        return
      }
      readUpdate(false)
        .then((value) => {
          if (value && !value.available) setPhase('done')
        })
        .catch(() => undefined)
    }, ASK_EVERY)
    return () => window.clearInterval(timer)
  }, [phase])

  if (!update?.latest || hidden) return null
  const latest = update.latest
  const start = () => {
    setPhase('updating')
    fetch('/api/local/update-now', {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Steerloom-Update': '1' },
    })
      .then((response) => {
        if (!response.ok) setPhase('failed')
      })
      .catch(() => setPhase('failed'))
  }
  return (
    <>
      <button
        type="button"
        className="update-pill"
        onClick={() => {
          if (phase === 'failed') setPhase('ready')
          setOpen(true)
        }}
      >
        <UiIcon
          icon={ArrowDownToLine}
          size={16}
          className="update-pill__icon"
        />
        <span className="update-pill__label">Update available</span>
      </button>
      {open && (
        <UpdateSheet
          update={update}
          phase={phase}
          onUpdate={start}
          onLater={() => {
            hideFor(latest)
            setHidden(true)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The sheet itself, so the design preview can show each state. */
export function UpdateSheet({
  update,
  phase,
  onUpdate,
  onLater,
  onClose,
}: {
  update: LocalUpdate
  phase: UpdatePhase
  onUpdate: () => void
  onLater: () => void
  onClose: () => void
}) {
  const failed = phase === 'failed'
  return (
    <GlassModal
      open
      className="update-sheet"
      title={
        phase === 'done'
          ? 'Steerloom is up to date'
          : phase === 'updating'
            ? 'Updating Steerloom…'
            : failed
              ? 'The update did not finish'
              : 'A new version of Steerloom is ready'
      }
      description={
        phase === 'done'
          ? `You now have version ${update.latest}.`
          : `Version ${update.latest}. You have ${update.current}.`
      }
      onClose={onClose}
    >
      <div className="update-sheet__body">
        {phase === 'ready' && update.notes && update.notes.length > 0 && (
          <>
            <p className="field-label">What’s new</p>
            <ul className="update-sheet__notes">
              {update.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        )}
        {phase === 'updating' && (
          <p className="update-sheet__status" role="status">
            <span className="update-sheet__spinner" aria-hidden="true" />
            Steerloom closes for a moment, then reopens by itself. It takes
            about a minute.
          </p>
        )}
        {phase === 'done' && (
          <p className="update-sheet__status" role="status">
            <UiIcon
              icon={CircleCheck}
              size={20}
              className="update-sheet__done"
            />
            Steerloom has reopened. You can close this window.
          </p>
        )}
        {failed && (
          <p className="update-sheet__status" role="alert">
            Nothing was lost. Paste the command below instead.
          </p>
        )}
        {(phase === 'ready' || failed) && (
          <UpdateByCommand
            key={phase}
            updateUrl={update.updateUrl}
            open={failed}
          />
        )}
        {phase === 'ready' && (
          <p className="metadata-copy">
            Your boards, dashboards and settings are kept, and a copy is saved
            first.
          </p>
        )}
        {phase !== 'updating' && (
          <div className="update-sheet__actions">
            {phase === 'ready' && (
              <>
                <GlassButton variant="quiet" onClick={onLater}>
                  Later
                </GlassButton>
                <GlassButton variant="primary" onClick={onUpdate}>
                  Update now
                </GlassButton>
              </>
            )}
            {phase !== 'ready' && (
              <GlassButton variant="quiet" onClick={onClose}>
                Close
              </GlassButton>
            )}
          </div>
        )}
      </div>
    </GlassModal>
  )
}

/**
 * The pasted command, for anyone who prefers it and for when "Update now"
 * cannot run. Fetched when it is opened, since its link lasts 30 minutes.
 */
function UpdateByCommand({
  updateUrl,
  open: startOpen,
}: {
  updateUrl: string
  open: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const [command, setCommand] = useState<UpdateCommand | null | 'failed'>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!open) return
    fetch('/api/local/update-command', {
      headers: { Accept: 'application/json' },
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<UpdateCommand>) : null,
      )
      .then((value) => setCommand(value ?? 'failed'))
      .catch(() => setCommand('failed'))
  }, [open])
  const windows = /Windows/i.test(navigator.userAgent)
  const text =
    command && command !== 'failed'
      ? windows
        ? command.windowsCommand
        : command.command
      : ''
  return (
    <details
      className="update-sheet__manual"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Or paste a command instead</summary>
      {command === 'failed' ? (
        <p className="body-copy">
          Steerloom could not fetch the update command right now. You can copy
          it from{' '}
          <a href={updateUrl} target="_blank" rel="noreferrer">
            steerloom.app
          </a>{' '}
          instead.
        </p>
      ) : (
        <>
          <p className="field-label">
            Paste this into {windows ? 'PowerShell' : 'Terminal'}
          </p>
          <div className="update-sheet__command">
            <code aria-live="polite">{text || 'Fetching the command…'}</code>
            <GlassButton
              variant="secondary"
              size="compact"
              disabled={!text}
              onClick={() => {
                navigator.clipboard
                  ?.writeText(text)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }}
              aria-label={copied ? 'Copied' : 'Copy the update command'}
            >
              <UiIcon icon={copied ? Check : Copy} size={16} />
              {copied ? 'Copied' : 'Copy'}
            </GlassButton>
          </div>
          <p className="metadata-copy">The command works for 30 minutes.</p>
        </>
      )}
    </details>
  )
}
