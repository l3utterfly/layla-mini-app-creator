import { useState } from 'react'
import { Icon } from '../common/Icon'

type RenameWorkspaceDialogProps = {
  currentName: string
  onRename: (name: string) => Promise<void>
  onClose: () => void
}

export function RenameWorkspaceDialog({ currentName, onRename, onClose }: RenameWorkspaceDialogProps) {
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const canSave = Boolean(trimmed) && !saving

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) return

    setSaving(true)
    setError(null)
    try {
      await onRename(trimmed)
      onClose()
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Unable to rename this workspace.')
      setSaving(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <form
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        onSubmit={submit}
        onKeyDown={event => {
          if (event.key === 'Escape' && !saving) onClose()
        }}
      >
        <header>
          <div><span className="eyebrow">Workspace</span><h2 id="rename-title">Rename</h2></div>
          <button type="button" className="icon-button" aria-label="Close rename" onClick={onClose} disabled={saving}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <label htmlFor="rename-input">Workspace name</label>
        <input
          id="rename-input"
          value={name}
          maxLength={80}
          autoFocus
          disabled={saving}
          onChange={event => setName(event.target.value)}
        />

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="primary" disabled={!canSave}>
            {saving ? 'Saving…' : 'Rename'}
          </button>
        </div>
      </form>
    </div>
  )
}
