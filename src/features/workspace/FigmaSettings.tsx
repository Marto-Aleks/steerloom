import { useState, type FormEvent } from 'react'
import { CircleCheck } from 'lucide-react'
import { UiIcon } from '../../components/UiIcon'
import {
  GlassButton,
  GlassInput,
  GlassPanel,
  StatusBadge,
  StatusMessage,
} from '../../components/ui'
import { workspaceRequest } from '../../lib/workspace/api'
import type { WorkspaceSession } from '../../lib/workspace/model'

/** The read-only scopes Steerloom needs; everything else stays unticked. */
const SCOPES = [
  'current_user:read',
  'file_content:read',
  'file_metadata:read',
  'file_versions:read',
  'file_dev_resources:read',
  'folders:read',
]

/**
 * Workspace Figma: owners and admins connect one read-only token, like the
 * GitHub token. Dashboards then name the design files that belong to them.
 */
export function FigmaSettings({
  session,
  onSession,
  disabled,
}: {
  session: WorkspaceSession
  onSession: (session: WorkspaceSession) => void
  disabled?: boolean
}) {
  const current = session.figma
  const editing = session.workspaceRole !== 'member'
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function send(method: 'PUT' | 'DELETE', done: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/figma-settings',
        method,
        method === 'PUT' ? { token } : {},
      )
      setToken('')
      setOpen(false)
      setNotice(done)
      onSession(result.session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  function save(event: FormEvent) {
    event.preventDefault()
    void send(
      'PUT',
      'Saved. The token works. Name the design files in each dashboard’s report settings.',
    )
  }

  return (
    <GlassPanel
      id="figma"
      className="home-ai"
      elevation="base"
      aria-labelledby="figma-title"
    >
      <div className="home-ai__intro">
        <div className="home-ai__lead">
          <div className="home-ai__heading">
            <div>
              <h3 id="figma-title" className="home-ai__title">
                Figma
              </h3>
              <p className="metadata-copy">
                {current
                  ? 'figma.com'
                  : 'See where design work stands, next to the board.'}
              </p>
            </div>
            <StatusBadge tone={current ? 'success' : 'neutral'}>
              {current ? 'Connected' : 'Not connected'}
            </StatusBadge>
          </div>
          {!editing && !current && (
            <p className="body-copy">
              Ask a workspace owner or admin to connect Figma.
            </p>
          )}
          {editing && !open && (
            <div className="home-ai__actions">
              <GlassButton
                size="compact"
                disabled={disabled || busy}
                onClick={() => {
                  setOpen(true)
                  setNotice('')
                }}
              >
                {current ? 'Change token' : 'Connect Figma'}
              </GlassButton>
              {current && (
                <GlassButton
                  variant="quiet"
                  size="compact"
                  disabled={disabled || busy}
                  onClick={() => void send('DELETE', 'Removed.')}
                >
                  Remove token
                </GlassButton>
              )}
            </div>
          )}
        </div>
        {/* The same slot as the AI services' marks, so the cards line up. */}
        <div className="ai-marks" data-count="1" aria-hidden="true">
          <span
            className="ai-marks__disc ai-marks__mark"
            data-position="center"
            data-active={current ? true : undefined}
          >
            <img src={`${import.meta.env.BASE_URL}brands/figma.svg`} alt="" />
          </span>
        </div>
      </div>
      {editing && open && (
        <form
          className="workspace-form home-form home-ai__form"
          onSubmit={save}
          aria-busy={busy}
        >
          <label>
            Token
            <GlassInput
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={current ? 'Leave empty to keep the saved token' : ''}
              autoComplete="off"
              required={!current}
              maxLength={400}
            />
          </label>
          <p className="metadata-copy home-form__hint">
            In Figma, open{' '}
            <strong>Settings → Security → Personal access tokens</strong> and
            tick only these read scopes:{' '}
            {SCOPES.map((scope, index) => (
              <span key={scope}>
                {index > 0 && ', '}
                <code>{scope}</code>
              </span>
            ))}
            .
          </p>
          <p className="metadata-copy">
            Steerloom reads branch names, edit dates and links to tickets, never
            the designs themselves. It checks the token once, stores it
            encrypted and never shows it again.
          </p>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          <div className="home-ai__actions">
            <GlassButton type="submit" variant="primary" disabled={busy}>
              {busy ? 'Checking token…' : 'Check and save'}
            </GlassButton>
            <GlassButton
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setToken('')
                setError('')
              }}
            >
              Cancel
            </GlassButton>
          </div>
        </form>
      )}
      <p className="home-saved" role="status">
        {notice && (
          <>
            <UiIcon icon={CircleCheck} size={16} className="home-saved__icon" />
            {notice}
          </>
        )}
      </p>
      {!open && error && <StatusMessage variant="error">{error}</StatusMessage>}
    </GlassPanel>
  )
}
