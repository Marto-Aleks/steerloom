import { useEffect, useState, type FormEvent } from 'react'
import { LocalSetupPage } from './LocalExperience'
import { LandingPage } from './landing/LandingPage'
import { entryNavigation } from './entry/navigation'
import { Wordmark } from '../../components/Wordmark'
import { SpotIcon } from '../../components/SpotIcon'
import { GlassButton, GlassInput, StatusMessage } from '../../components/ui'
import { workspaceRequest } from '../../lib/workspace/api'
import { EntryDivider, EntryPage } from './entry/EntryPage'
import { GoogleButton } from './entry/GoogleButton'

interface AccountSession {
  user: { id: string; email: string }
  workspaces: Array<{ id: string; name: string }>
  invitations: Array<{ id: string; workspaceId: string; role: string }>
}
/**
 * A Jira or Trello connection that came back without its workspace: the
 * attempt had expired, or the server restarted while the person was away
 * approving it. The workspace page reads these and says what happened.
 */
const CONNECTION_RETURN = ['jira', 'trello', 'trelloReason'] as const
const connectionFailed = (search: URLSearchParams) =>
  search.get('jira') === 'error' || search.get('trello') === 'error'

function openWorkspace(id: string, keepConnectionReturn = false) {
  const target = new URLSearchParams({ hosted: '1', workspace: id })
  const here = new URLSearchParams(window.location.search)
  if (keepConnectionReturn && connectionFailed(here))
    for (const name of CONNECTION_RETURN) {
      const value = here.get(name)
      if (value && /^[a-z]{1,20}$/.test(value)) target.set(name, value)
    }
  entryNavigation.assign(`/?${target.toString()}`)
}

export function HostedAccountSetup() {
  const productionHosted =
    document
      .querySelector('meta[name="steerloom-mode"]')
      ?.getAttribute('content') === 'hosted'
  const [session, setSession] = useState<AccountSession | null>(null)
  // ?page= picks the public page: none = product landing, signin/signup =
  // the account card, local = local setup (no account needed).
  const [page] = useState(() =>
    new URLSearchParams(window.location.search).get('page'),
  )
  const [destination, setDestination] = useState<'hosted' | 'local'>(() =>
    page === 'local' ? 'local' : 'hosted',
  )
  const [configured, setConfigured] = useState(false)
  const [checking, setChecking] = useState(true)
  // Back from a password reset email: choose a new password first.
  const [resetting, setResetting] = useState(
    () => new URLSearchParams(window.location.search).get('reset') === '1',
  )
  const [newPassword, setNewPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() =>
    page === 'signup' ? 'register' : 'login',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // Set after a successful sign-up: the card switches to "Check your inbox".
  const [sentTo, setSentTo] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(() => {
    const search = new URLSearchParams(window.location.search)
    if (search.get('auth') === 'error')
      return 'Sign-in didn’t finish. If you just confirmed your email, your account is ready: sign in below. Email links work in the browser where you asked for them, within 30 minutes.'
    // With several workspaces there is no single one to open and report in.
    if (connectionFailed(search))
      return 'The board connection didn’t finish. Open your workspace and connect again.'
    return ''
  })
  useEffect(() => {
    const controller = new AbortController()
    const url = new URL(window.location.href)
    url.searchParams.delete('auth')
    window.history.replaceState(null, '', url)
    Promise.all([
      workspaceRequest<{ configured: boolean }>(
        '/api/hosted/config',
        'GET',
        undefined,
        controller.signal,
      ),
      workspaceRequest<{ session: AccountSession | null }>(
        '/api/hosted/session',
        'GET',
        undefined,
        controller.signal,
      ),
    ])
      .then(([config, result]) => {
        if (!controller.signal.aborted) {
          setConfigured(config.configured)
          // One workspace and nothing to decide: go straight in. The
          // navigation's "All workspaces" link (view=hosted) still shows the list.
          const only = result.session?.workspaces
          if (
            only?.length === 1 &&
            // Already on a workspace address that did not open: going there
            // again would loop.
            !new URLSearchParams(window.location.search).get('workspace') &&
            // Back from a reset email: the new password comes first.
            new URLSearchParams(window.location.search).get('reset') !== '1' &&
            !result.session?.invitations.length &&
            page !== 'local' &&
            new URLSearchParams(window.location.search).get('view') !== 'hosted'
          ) {
            // A connection that failed on its way back is reported there.
            openWorkspace(only[0]!.id, true)
            return
          }
          setSession(result.session)
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(message(caught))
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [page])
  const refresh = async () => {
    const result = await workspaceRequest<{ session: AccountSession | null }>(
      '/api/hosted/session',
    )
    setSession(result.session)
  }
  async function action(run: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await run()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void action(async () => {
      const result = await workspaceRequest<{ notice?: string }>(
        `/api/hosted/auth/${mode}`,
        'POST',
        { email, password },
      )
      setPassword('')
      if (result.notice && mode === 'register') {
        setSentTo(email.trim())
        setMode('login')
      } else if (result.notice) {
        setNotice(result.notice)
        setMode('login')
      } else await refresh()
    })
  }
  const sendResetLink = (event: FormEvent) => {
    event.preventDefault()
    void action(async () => {
      const result = await workspaceRequest<{ notice?: string }>(
        '/api/hosted/auth/recover',
        'POST',
        { email },
      )
      setNotice(result.notice ?? '')
    })
  }
  const saveNewPassword = (event: FormEvent) => {
    event.preventDefault()
    void action(async () => {
      await workspaceRequest<{ ok: boolean }>(
        '/api/hosted/auth/password',
        'POST',
        { password: newPassword },
      )
      setNewPassword('')
      setResetting(false)
      const url = new URL(window.location.href)
      url.searchParams.delete('reset')
      window.history.replaceState(null, '', url)
      setNotice('Your password is changed. Use it next time you sign in.')
    })
  }
  const resendConfirmation = () =>
    void action(async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
        throw new Error(
          'Enter the email you signed up with, then send the link again.',
        )
      const result = await workspaceRequest<{ notice?: string }>(
        '/api/hosted/auth/resend',
        'POST',
        { email },
      )
      setNotice(result.notice ?? '')
    })
  const signOut = () =>
    void action(async () => {
      await workspaceRequest('/api/hosted/auth/logout', 'POST', {})
      setSession(null)
      setDestination('hosted')
      setPassword('')
    })
  if (destination === 'local' && (session || page === 'local')) {
    if (checking) return null
    // Signed in, "Back" returns to the workspace list; otherwise to the
    // product page.
    const back = session
      ? () => setDestination('hosted')
      : () => entryNavigation.assign('/?hosted=1')
    return (
      <main className="workspace-entry" id="main-content">
        <div className="workspace-entry__shell">
          <header className="workspace-entry__nav">
            <Wordmark />
            {session && (
              <div className="workspace-entry__account">
                <span title={session.user.email}>{session.user.email}</span>
                <button type="button" disabled={busy} onClick={signOut}>
                  Sign out
                </button>
              </div>
            )}
          </header>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          {notice && <StatusMessage variant="info">{notice}</StatusMessage>}
          <LocalSetupPage
            productionHosted={productionHosted}
            backLabel={
              session ? 'Back to your workspaces' : 'Back to Steerloom'
            }
            onBack={back}
          />
          <footer className="workspace-entry__footer">
            <span>Steerloom reads your boards and never changes them.</span>
            {productionHosted && (
              <span className="workspace-entry__footer-links">
                <a href="/terms.html">Terms</a>
                <a href="/privacy.html">Privacy notice</a>
              </span>
            )}
          </footer>
        </div>
      </main>
    )
  }
  if (!session && !page) {
    if (checking) return null
    return <LandingPage productionHosted={productionHosted} />
  }
  const registering = mode === 'register'
  const forgot = mode === 'forgot'
  const choosingPassword = !!session && resetting
  const entryLinks = (
    <>
      <a href="/?hosted=1">What is Steerloom?</a>
      {productionHosted && (
        <>
          <a href="/terms.html">Terms</a>
          <a href="/privacy.html">Privacy notice</a>
        </>
      )}
      {!productionHosted && <a href="/">Back to your local workspace</a>}
    </>
  )
  return (
    <EntryPage
      title={
        choosingPassword
          ? 'Choose a new password'
          : forgot && !session
            ? 'Forgot your password?'
            : session
              ? 'Your team’s briefings, in one place'
              : sentTo
                ? 'One click left'
                : registering
                  ? 'Your first briefing is five minutes away'
                  : 'Your briefing is waiting'
      }
      lead={
        choosingPassword
          ? 'You’re signed in from the reset link. Set the password you’ll use from now on.'
          : forgot && !session
            ? 'It happens. We’ll email you a link to choose a new one.'
            : session
              ? 'Open a workspace, or create one and connect a board read-only.'
              : sentTo
                ? 'Confirm your email, then create your workspace.'
                : registering
                  ? 'Create an account, then connect a board read-only or run Steerloom on your own computer.'
                  : 'Sign in to see what’s stuck, what needs a decision and when work will land.'
      }
      links={entryLinks}
    >
      {choosingPassword ? (
        <>
          <h2 className="entry-card__title" id="hosted-title">
            Set a new password
          </h2>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          <form
            className="entry-form"
            onSubmit={saveNewPassword}
            aria-labelledby="hosted-title"
            aria-busy={busy}
          >
            <label>
              New password
              <GlassInput
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby="hosted-new-password-help"
              />
            </label>
            <p id="hosted-new-password-help" className="entry-form__help">
              At least 12 characters.
            </p>
            <GlassButton type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </GlassButton>
          </form>
        </>
      ) : forgot && !session ? (
        <>
          <h2 className="entry-card__title" id="hosted-title">
            Reset your password
          </h2>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          {notice && <StatusMessage variant="info">{notice}</StatusMessage>}
          <form
            className="entry-form"
            onSubmit={sendResetLink}
            aria-labelledby="hosted-title"
            aria-busy={busy}
          >
            <label>
              Email
              <GlassInput
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                maxLength={254}
                placeholder="you@company.com"
              />
            </label>
            <p className="entry-form__help">
              Open the link in this browser within 30 minutes.
            </p>
            <GlassButton
              type="submit"
              variant="primary"
              disabled={busy || !configured}
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </GlassButton>
          </form>
          <p className="entry-card__switch">
            <button
              type="button"
              className="entry-link-button"
              disabled={busy}
              onClick={() => {
                setMode('login')
                setNotice('')
                setError('')
              }}
            >
              Back to sign in
            </button>
          </p>
        </>
      ) : sentTo && !session ? (
        <section className="entry-inbox" aria-labelledby="hosted-title">
          <SpotIcon
            name="on-track"
            size={64}
            animate
            className="entry-inbox__icon"
          />
          <h2 className="entry-card__title" id="hosted-title">
            Check your inbox
          </h2>
          <p className="body-copy">
            We sent a confirmation link to <strong>{sentTo}</strong>.
          </p>
          <ol className="entry-inbox__steps">
            <li>Open the email from Steerloom.</li>
            <li>
              Click the link in <strong>this browser</strong> within 30 minutes.
            </li>
            <li>You’ll be signed in and can create your workspace.</li>
            <li>
              Landed on the sign-in page instead? Your email is confirmed: sign
              in with your password. Work email filters sometimes open the link
              first.
            </li>
          </ol>
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          {notice && <StatusMessage variant="info">{notice}</StatusMessage>}
          <p className="metadata-copy">
            Nothing after a few minutes? Check spam or quarantine, or{' '}
            <button
              type="button"
              className="entry-link-button"
              disabled={busy}
              onClick={resendConfirmation}
            >
              send it again
            </button>
            .
          </p>
          <button
            type="button"
            className="entry-link-button"
            onClick={() => {
              setSentTo('')
              setNotice('')
              setError('')
            }}
          >
            Back to sign in
          </button>
        </section>
      ) : (
        <>
          <h2 className="entry-card__title" id="hosted-title">
            {session
              ? 'Your workspaces'
              : registering
                ? 'Create your account'
                : 'Sign in'}
          </h2>
          {checking && (
            <StatusMessage variant="loading">
              Checking your account…
            </StatusMessage>
          )}
          {error && <StatusMessage variant="error">{error}</StatusMessage>}
          {notice && <StatusMessage variant="info">{notice}</StatusMessage>}
          {!checking && !session && (
            <>
              {registering && (
                <p className="body-copy entry-card__intro">
                  Free to start. No invitation needed.
                </p>
              )}
              {!configured && (
                <StatusMessage variant="info">
                  Hosted sign-in isn’t set up on this server yet, so these
                  options are switched off.
                </StatusMessage>
              )}
              <GoogleButton
                label="Continue with Google"
                disabled={busy || !configured}
                onClick={() =>
                  void action(async () => {
                    const result = await workspaceRequest<{ url: string }>(
                      '/api/hosted/auth/google',
                      'POST',
                      {},
                    )
                    window.location.assign(result.url)
                  })
                }
              />
              <EntryDivider>or with email</EntryDivider>
              <form
                className="entry-form"
                onSubmit={submit}
                aria-labelledby="hosted-title"
                aria-busy={busy}
              >
                <label>
                  Email
                  <GlassInput
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                    maxLength={254}
                    placeholder="you@company.com"
                  />
                </label>
                <label>
                  Password
                  <GlassInput
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={registering ? 12 : 1}
                    maxLength={128}
                    autoComplete={
                      registering ? 'new-password' : 'current-password'
                    }
                    aria-describedby={
                      registering ? 'hosted-password-help' : undefined
                    }
                  />
                </label>
                {registering && (
                  <p id="hosted-password-help" className="entry-form__help">
                    At least 12 characters. We’ll email you a link to confirm
                    your address.
                  </p>
                )}
                <GlassButton
                  type="submit"
                  variant="primary"
                  disabled={busy || !configured}
                >
                  {busy
                    ? registering
                      ? 'Creating your account…'
                      : 'Signing in…'
                    : registering
                      ? 'Create account'
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
                    setPassword('')
                    setError('')
                  }}
                >
                  {registering ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              {productionHosted && (
                <p className="metadata-copy entry-card__switch">
                  By continuing you agree to the <a href="/terms.html">terms</a>{' '}
                  and the <a href="/privacy.html">privacy notice</a>.
                </p>
              )}
              {!registering && (
                <p className="metadata-copy entry-card__switch">
                  Forgot your password?{' '}
                  <button
                    type="button"
                    className="entry-link-button"
                    disabled={busy || !configured}
                    onClick={() => {
                      setMode('forgot')
                      setPassword('')
                      setError('')
                      setNotice('')
                    }}
                  >
                    Reset it
                  </button>
                </p>
              )}
              {!registering && (
                <p className="metadata-copy entry-card__switch">
                  Didn&apos;t get the confirmation email?{' '}
                  <button
                    type="button"
                    className="entry-link-button"
                    disabled={busy || !configured}
                    onClick={resendConfirmation}
                  >
                    Send it again
                  </button>
                </p>
              )}
            </>
          )}
          {!checking && session && (
            <>
              <p className="body-copy entry-card__intro">
                Signed in as <strong>{session.user.email}</strong>
              </p>
              {session.workspaces.length > 0 && (
                <>
                  <ul className="entry-workspaces">
                    {session.workspaces.map((workspace) => (
                      <li key={workspace.id}>
                        <strong>{workspace.name}</strong>{' '}
                        <a
                          className="workspace-open-link"
                          href={`/?hosted=1&workspace=${encodeURIComponent(workspace.id)}`}
                        >
                          Open workspace
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="metadata-copy">
                    Open a workspace to connect boards and read your briefings.
                  </p>
                </>
              )}
              {session.invitations.map((invitation, index) => (
                <GlassButton
                  key={invitation.id}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await workspaceRequest(
                        '/api/hosted/invitations/accept',
                        'POST',
                        { id: invitation.id },
                      )
                      await refresh()
                      setNotice('You joined the workspace.')
                    })
                  }
                >
                  Accept team invitation{' '}
                  {session.invitations.length > 1 ? index + 1 : ''}
                </GlassButton>
              ))}
              <form
                className="entry-form"
                aria-label="Create a workspace"
                aria-busy={busy}
                onSubmit={(event) => {
                  event.preventDefault()
                  void action(async () => {
                    const created = await workspaceRequest<{ id?: string }>(
                      '/api/hosted/workspaces',
                      'POST',
                      { name },
                    )
                    if (created.id) {
                      openWorkspace(created.id)
                      return
                    }
                    await refresh()
                    setNotice('Your workspace was created.')
                  })
                }}
              >
                <p className="metadata-copy">
                  {session.workspaces.length > 0
                    ? 'Or start another workspace. Only you can open it.'
                    : 'Create your workspace and connect your boards. Only you can open it.'}
                </p>
                <label>
                  Workspace name
                  <GlassInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="My delivery team"
                    required
                    maxLength={100}
                    autoComplete="organization"
                  />
                </label>
                <GlassButton variant="primary" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create workspace'}
                </GlassButton>
              </form>
              <div className="entry-card__actions">
                <GlassButton
                  variant="quiet"
                  onClick={() => setDestination('local')}
                >
                  Run Steerloom on your computer
                </GlassButton>
                <GlassButton variant="quiet" disabled={busy} onClick={signOut}>
                  Sign out
                </GlassButton>
              </div>
            </>
          )}
        </>
      )}
    </EntryPage>
  )
}
function message(caught: unknown) {
  return caught instanceof Error
    ? caught.message
    : 'Could not complete this request.'
}
