import { useState } from 'react'
import { GlassInput, StatusMessage } from '../../components/ui'
import { workspaceRequest } from '../../lib/workspace/api'
import { FIGMA_FILE_LIMIT, parseFigmaFiles } from '../../lib/workspace/model'

/**
 * The Figma files a dashboard reads design progress from. Links are pasted
 * freely and become file keys when the field is left; Steerloom then names
 * each file, so a wrong link shows before the dashboard is saved.
 */
export function FigmaFileField({
  value,
  onChange,
}: {
  value: string[]
  onChange: (files: string[]) => void
}) {
  const [text, setText] = useState(value.join(', '))
  const [names, setNames] = useState<string[]>([])
  const [error, setError] = useState('')

  async function commit() {
    const files = parseFigmaFiles(text)
    setText(files.join(', '))
    onChange(files)
    setNames([])
    setError('')
    if (!files.length) return
    try {
      const result = await workspaceRequest<{
        files: Array<{ key: string; name: string }>
      }>('/api/workspace/figma/files', 'POST', { files })
      setNames(result.files.map((file) => file.name))
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not open the files.',
      )
    }
  }

  return (
    <label className="workspace-dashboard-name">
      Designs from
      <GlassInput
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void commit()}
        placeholder="Paste Figma file links"
        maxLength={4000}
        spellCheck={false}
      />
      <span className="metadata-copy">
        {names.length
          ? `Found: ${names.join(', ')}.`
          : `Up to ${FIGMA_FILE_LIMIT} Figma files. Branches and links that name an item key show where its design stands.`}
      </span>
      {error && <StatusMessage variant="warning">{error}</StatusMessage>}
    </label>
  )
}
