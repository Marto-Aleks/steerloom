import { useEffect, useState } from 'react'
import { workspaceRequest } from '../../lib/workspace/api'
import type { WorkspaceSession } from '../../lib/workspace/model'
import { StatusMessage } from '../../components/ui'
import { EntryDivider } from './entry/EntryPage'
import { GoogleButton } from './entry/GoogleButton'

export function GoogleSignIn({
  session,
  showPasswordAlternative = false,
}: {
  session?: WorkspaceSession
  showPasswordAlternative?: boolean
}) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.search).get('google') === 'error'
      ? 'Google sign-in could not be completed. Try again, or use your password. If you were linking an account, check that it is not already linked elsewhere.'
      : '',
  )
  useEffect(() => {
    const controller = new AbortController()
    workspaceRequest<{ google: boolean }>(
      '/api/auth/providers',
      'GET',
      undefined,
      controller.signal,
    )
      .then((result) => setAvailable(result.google))
      .catch(() => {
        /* Password sign-in remains available. */
      })
    const url = new URL(window.location.href)
    if (url.searchParams.has('google')) {
      url.searchParams.delete('google')
      window.history.replaceState(null, '', url)
    }
    return () => controller.abort()
  }, [])
  async function start() {
    setBusy(true)
    setError('')
    try {
      const result = await workspaceRequest<{ url: string }>(
        '/api/auth/google/start',
        'POST',
        { mode: session ? 'link' : 'login' },
      )
      window.location.assign(result.url)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Google sign-in could not start.',
      )
      setBusy(false)
    }
  }
  return (
    <div className="workspace-google-auth">
      {error && <StatusMessage variant="error">{error}</StatusMessage>}
      {session?.user.googleLinked ? (
        <p className="metadata-copy">
          Linked to Google as {session.user.googleEmail}
        </p>
      ) : available ? (
        <>
          {session && (
            <p className="metadata-copy">
              Already using a password? Link your Google account here to use
              either sign-in method with this same workspace.
            </p>
          )}
          <GoogleButton
            label={
              session ? 'Link Google to this account' : 'Continue with Google'
            }
            disabled={busy}
            onClick={() => void start()}
          />
          {busy && (
            <p role="status" className="metadata-copy">
              Opening Google…
            </p>
          )}
          {!session && showPasswordAlternative && (
            <>
              <p className="metadata-copy">
                Google creates a new account. Already have a username? Sign in
                with it below, then link Google from your workspace.
              </p>
              <EntryDivider>or with a username</EntryDivider>
            </>
          )}
        </>
      ) : !session ? (
        <p className="metadata-copy">
          Google sign-in isn’t available here. Use your username and password
          below.
        </p>
      ) : null}
    </div>
  )
}
