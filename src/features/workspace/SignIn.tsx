import { GoogleSignIn } from './GoogleSignIn'
import { useEffect, useState, type FormEvent } from 'react'
import { GlassButton, GlassInput, StatusMessage } from '../../components/ui'
import { authenticate, workspaceRequest } from '../../lib/workspace/api'
import type { WorkspaceSession } from '../../lib/workspace/model'
import { EntryPage } from './entry/EntryPage'

export function SignIn({
  onSession,
}: {
  onSession: (session: WorkspaceSession) => void
}) {
  const [hostedAvailable, setHostedAvailable] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    workspaceRequest<{ configured: boolean }>(
      '/api/hosted/config',
      'GET',
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setHostedAvailable(result.configured)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  // ?page=signin opens on sign-in; anything else on creating a workspace.
  const [mode, setMode] = useState<'login' | 'register'>(() =>
    new URLSearchParams(window.location.search).get('page') === 'signin'
      ? 'login'
      : 'register',
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await authenticate(mode, {
        username,
        password,
        workspaceName,
      })
      setPassword('')
      onSession(result.session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }
  const registering = mode === 'register'
  return (
    <EntryPage
      title={
        registering
          ? 'Your first briefing is five minutes away'
          : 'Your briefing is waiting'
      }
      lead={
        registering
          ? 'Create a workspace on this computer, then try the sample report or connect a board read-only.'
          : 'Sign in to see what’s stuck, what needs a decision and when work will land.'
      }
    >
      <h2 className="entry-card__title" id="signin-title">
        {registering ? 'Create your workspace' : 'Sign in'}
      </h2>
      <p className="body-copy entry-card__intro">
        {registering
          ? 'Takes a minute. No invitation or approval needed.'
          : 'Your boards and connections are saved in this workspace.'}
      </p>
      <p className="metadata-copy entry-card__intro">
        Opening Steerloom from its app icon signs you in automatically.
      </p>
      <GoogleSignIn showPasswordAlternative />
      <form
        onSubmit={submit}
        className="entry-form"
        aria-labelledby="signin-title"
        aria-busy={busy}
      >
        {registering && (
          <label>
            Workspace name
            <GlassInput
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="My delivery team"
              maxLength={100}
              required
              autoComplete="organization"
            />
          </label>
        )}
        <label>
          Username
          <GlassInput
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            minLength={3}
            maxLength={40}
            required
            placeholder="Your username"
          />
        </label>
        <label>
          Password
          <GlassInput
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? 12 : 1}
            maxLength={128}
            required
            aria-describedby="password-help"
          />
        </label>
        <p id="password-help" className="entry-form__help">
          {registering
            ? 'At least 12 characters. A short phrase is easiest to remember.'
            : 'The password you chose when you created this workspace.'}
        </p>
        {error && <StatusMessage variant="error">{error}</StatusMessage>}
        <GlassButton type="submit" variant="primary" disabled={busy}>
          {busy
            ? 'Opening workspace…'
            : registering
              ? 'Create workspace'
              : 'Sign in'}
        </GlassButton>
      </form>
      <p className="entry-card__switch">
        {registering ? 'Already have an account? ' : 'New here? '}
        <button
          type="button"
          className="entry-link-button"
          disabled={busy}
          onClick={() => {
            setMode(registering ? 'login' : 'register')
            setError('')
            setPassword('')
          }}
        >
          {registering ? 'Sign in' : 'Create your workspace'}
        </button>
      </p>
      <p className="metadata-copy entry-card__footnote">
        Your account stores your workspace and connections. Board data stays in
        memory and is never saved.
        {hostedAvailable && (
          <>
            {' '}
            Prefer a shared online workspace?{' '}
            <a href="/?hosted=1">Set up a hosted account</a>
          </>
        )}
      </p>
    </EntryPage>
  )
}
