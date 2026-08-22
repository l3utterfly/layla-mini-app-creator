import { useState } from 'react'
import { Icon } from '../common/Icon'

type DeleteWorkspaceDialogProps = {
  workspaceName: string
  /** The workspace that will be opened instead, or null when a new one will be created. */
  successorName: string | null
  onDelete: () => Promise<void>
  onClose: () => void
}

export function DeleteWorkspaceDialog({
  workspaceName,
  successorName,
  onDelete,
  onClose,
}: DeleteWorkspaceDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
      onClose()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this workspace.')
      setDeleting(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !deleting) onClose()
      }}
    >
      <section
        className="dialog-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-body"
        onKeyDown={event => {
          if (event.key === 'Escape' && !deleting) onClose()
        }}
      >
        <header>
          <div><span className="eyebrow">Workspace</span><h2 id="delete-title">Delete</h2></div>
          <button type="button" className="icon-button" aria-label="Close delete" onClick={onClose} disabled={deleting}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <p className="dialog-message" id="delete-body">
          <strong>{workspaceName}</strong> and all of its files will be permanently removed. This
          cannot be undone.{' '}
          {successorName
            ? <>Your most recently edited workspace, <strong>{successorName}</strong>, will open instead.</>
            : 'A new empty workspace will be created and opened.'}
        </p>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={deleting}>Cancel</button>
          <button type="button" className="danger" autoFocus disabled={deleting} onClick={() => void confirm()}>
            {deleting ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </section>
    </div>
  )
}
