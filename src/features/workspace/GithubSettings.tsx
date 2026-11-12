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
import type {
  GithubRepositoryCheck,
  WorkspaceSession,
} from '../../lib/workspace/model'

/** Where a fine-grained token is made, on github.com or a company GitHub. */
function tokenPage(address: string): string {
  try {
    const origin = new URL(address || 'https://github.com').origin
    return `${origin}/settings/personal-access-tokens/new`
  } catch {
    return 'https://github.com/settings/personal-access-tokens/new'
  }
}

/** "Classic token · expires 13 Nov 2026", so owners see what they connected. */
function tokenLine(github: NonNullable<WorkspaceSession['github']>): string {
  const kind = github.classic ? 'Classic token' : 'Fine-grained token'
  if (!github.expiresAt) return `${github.host} · ${kind}`
  const at = new Date(github.expiresAt)
  const date = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${github.host} · ${kind} · ${at.getTime() < Date.now() ? 'expired' : 'expires'} ${date}`
}

/** "87 pull requests in the last year · 12 name an item key". */
function checkLine(check: GithubRepositoryCheck): string {
  if (!check.read) return 'No pull requests in the last year'
  const all = `${check.read} pull request${check.read === 1 ? '' : 's'} in the last year`
  if (!check.linked) return `${all} · none names an item key`
  return `${all} · ${check.linked} name${check.linked === 1 ? 's' : ''} an item key`
}

/**
 * Workspace GitHub: owners and admins connect one read-only token and the
 * repositories it reads, checked together. Every dashboard uses them: a pull
 * request shows on the board whose item key it names.
 */
export function GithubSettings({
  session,
  onSession,
  disabled,
}: {
  session: WorkspaceSession
  onSession: (session: WorkspaceSession) => void
  disabled?: boolean
}) {
  const current = session.github
  const editing = session.workspaceRole !== 'member'
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState(
    current ? `https://${current.host}` : '',
  )
  const [token, setToken] = useState('')
  const [repositories, setRepositories] = useState(
    current?.repositories.join(', ') ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const sameHost = (() => {
    try {
      return (
        !!current &&
        new URL(address || 'https://github.com').host === current.host
      )
    } catch {
      return false
    }
  })()

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/github-settings',
        'PUT',
        { baseUrl: address, token, repositories },
      )
      setToken('')
      setOpen(false)
      const saved = result.session.github
      setRepositories(saved?.repositories.join(', ') ?? repositories)
      const linked = (saved?.checks ?? []).reduce((n, c) => n + c.linked, 0)
      setNotice(
        linked
          ? 'Saved. The token works and every repository was found. Dashboards show pull requests from the next load.'
          : 'Saved, but no pull request in the last year names an item key, so nothing will show yet. See below.',
      )
      onSession(result.session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/github-settings',
        'DELETE',
        {},
      )
      setNotice('Removed.')
      onSession(result.session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassPanel
      id="github"
      className="home-ai"
      elevation="base"
      aria-labelledby="github-title"
    >
      <div className="home-ai__intro">
        <div className="home-ai__lead">
          <div className="home-ai__heading">
            <div>
              <h3 id="github-title" className="home-ai__title">
                GitHub
              </h3>
              <p className="metadata-copy">
                {current
                  ? tokenLine(current)
                  : 'See what happens inside Review, from your pull requests.'}
              </p>
            </div>
            <StatusBadge tone={current ? 'success' : 'neutral'}>
              {current ? 'Connected' : 'Not connected'}
            </StatusBadge>
          </div>
          {!editing && !current && (
            <p className="body-copy">
              Ask a workspace owner or admin to connect GitHub.
            </p>
          )}
          {current?.expiresAt && Date.parse(current.expiresAt) < Date.now() && (
            <StatusMessage variant="warning">
              This token has expired. Pull requests no longer load: change the
              token or remove it.
            </StatusMessage>
          )}
          {current && !current.repositories.length && (
            <StatusMessage variant="warning">
              No repositories yet, so no pull requests load. Choose{' '}
              <strong>Edit</strong> and name them.
            </StatusMessage>
          )}
          {current && current.repositories.length > 0 && !open && (
            <ul className="github-repos" aria-label="Repositories">
              {current.repositories.map((name) => {
                const check = current.checks?.find((c) => c.name === name)
                return (
                  <li
                    key={name}
                    data-unlinked={check && !check.linked ? true : undefined}
                  >
                    <strong>{name}</strong>
                    {check && (
                      <span className="metadata-copy">{checkLine(check)}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {current?.checks?.some((check) => check.read && !check.linked) &&
            !open && (
              <p className="metadata-copy">
                A pull request counts when its title or branch names an item
                key, such as <code>FLOW-123 fix login</code> or{' '}
                <code>feature/FLOW-123-login</code>.
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
                {current ? 'Edit' : 'Connect GitHub'}
              </GlassButton>
              {current && (
                <GlassButton
                  variant="quiet"
                  size="compact"
                  disabled={disabled || busy}
                  onClick={() => void remove()}
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
            <img src={`${import.meta.env.BASE_URL}brands/github.svg`} alt="" />
          </span>
        </div>
      </div>
      {editing && open && (
        <form
          className="workspace-form home-form home-ai__form"
          onSubmit={(event) => void save(event)}
          aria-busy={busy}
        >
          <label>
            GitHub address
            <GlassInput
              type="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://github.com, or your company’s GitHub"
              maxLength={300}
            />
          </label>
          <label>
            Token
            <GlassInput
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                sameHost ? 'Leave empty to keep the saved token' : ''
              }
              autoComplete="off"
              required={!sameHost}
              maxLength={400}
            />
          </label>
          <label>
            Repositories
            <GlassInput
              value={repositories}
              onChange={(event) => setRepositories(event.target.value)}
              placeholder="owner/repository, owner/another"
              required
              maxLength={4000}
              spellCheck={false}
            />
            <span className="metadata-copy">
              Up to 10, as owner/name or pasted links. Every dashboard reads
              them; a pull request shows on the board whose item key it names.
            </span>
          </label>
          <p className="metadata-copy home-form__hint">
            <a href={tokenPage(address)} target="_blank" rel="noreferrer">
              Create a fine-grained token
            </a>{' '}
            with read access to Pull requests and Metadata, for the repositories
            your team works in (add Contents: read to see branches too). A
            classic token is accepted only with nothing but “repo” ticked and an
            expiry date.
          </p>
          <p className="metadata-copy">
            Steerloom reads when pull requests were reviewed and merged, never
            the code. It checks the token once, stores it encrypted and never
            shows it again.
          </p>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          <div className="home-ai__actions">
            <GlassButton type="submit" variant="primary" disabled={busy}>
              {busy ? 'Checking token and repositories…' : 'Check and save'}
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
