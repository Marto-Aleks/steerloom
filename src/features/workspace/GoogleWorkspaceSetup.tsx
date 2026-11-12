import { useState, type FormEvent } from 'react'
import { GlassButton, GlassInput, StatusMessage } from '../../components/ui'
import { workspaceRequest } from '../../lib/workspace/api'
import type { WorkspaceSession } from '../../lib/workspace/model'
import { EntryPage } from './entry/EntryPage'

export function GoogleWorkspaceSetup({
  onSession,
}: {
  onSession: (session: WorkspaceSession) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await workspaceRequest<{ session: WorkspaceSession }>(
        '/api/workspace/name',
        'PUT',
        { name },
      )
      onSession(result.session)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not name your workspace.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <EntryPage
      title="One name, then your first briefing"
      lead="You’re signed in with Google. Name your workspace, then try the sample report or connect your first board read-only."
    >
      <h2 className="entry-card__title" id="name-title">
        Name your workspace
      </h2>
      <form
        className="entry-form"
        onSubmit={submit}
        aria-labelledby="name-title"
        aria-busy={busy}
      >
        <label>
          Workspace name
          <GlassInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
            autoComplete="organization"
            placeholder="My delivery team"
            aria-describedby="name-help"
          />
        </label>
        <p id="name-help" className="entry-form__help">
          Shown at the top of your workspace. Your team or product name works
          well.
        </p>
        {error && <StatusMessage variant="error">{error}</StatusMessage>}
        <GlassButton
          type="submit"
          variant="primary"
          disabled={busy || !name.trim()}
        >
          {busy ? 'Saving…' : 'Open my workspace'}
        </GlassButton>
      </form>
    </EntryPage>
  )
}
