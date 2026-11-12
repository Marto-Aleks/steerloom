import { useId, useState } from 'react'
import { GlassButton } from '../../components/ui'
import { TEAM_NOTES_LIMIT } from '../../lib/workspace/model'

interface TeamNotesProps {
  notes?: string
  /** Owners and admins; members see the notes without editing them. */
  onSave?: (notes: string) => void
}

/**
 * Facts the team writes once, such as "We don't run stand-ups", which
 * Steerloom AI reads with every question on this board.
 */
export function TeamNotes({ notes = '', onSave }: TeamNotesProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(notes)
  const fieldId = useId()
  const hintId = useId()
  if (!notes && !onSave) return null

  if (editing && onSave)
    return (
      <form
        className="ai-team-notes ai-team-notes--editing"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft.trim())
          setEditing(false)
        }}
      >
        <label className="ai-team-notes__label" htmlFor={fieldId}>
          Team notes
        </label>
        <p className="ai-team-notes__hint" id={hintId}>
          Facts the AI should always know about this team. For example: We
          don&apos;t run stand-ups. Review limit is 4. The API team is external.
          Everyone in the workspace sees them.
        </p>
        <textarea
          id={fieldId}
          className="glass-input ai-team-notes__field"
          aria-describedby={hintId}
          rows={4}
          maxLength={TEAM_NOTES_LIMIT}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoFocus
        />
        <div className="ai-team-notes__actions">
          <span className="ai-team-notes__count">
            {draft.length} / {TEAM_NOTES_LIMIT}
          </span>
          <GlassButton
            type="button"
            variant="quiet"
            size="compact"
            onClick={() => {
              setDraft(notes)
              setEditing(false)
            }}
          >
            Cancel
          </GlassButton>
          <GlassButton type="submit" variant="primary" size="compact">
            Save notes
          </GlassButton>
        </div>
      </form>
    )

  return (
    <p className="ai-team-notes">
      {notes ? (
        <>
          <span className="ai-team-notes__label">Team notes:</span>{' '}
          <span className="ai-team-notes__preview" title={notes}>
            {notes}
          </span>
        </>
      ) : (
        <span>The AI doesn&apos;t know how this team works yet.</span>
      )}{' '}
      {onSave && (
        <button
          type="button"
          onClick={() => {
            setDraft(notes)
            setEditing(true)
          }}
        >
          {notes ? 'Edit' : 'Add team notes'}
        </button>
      )}
    </p>
  )
}
