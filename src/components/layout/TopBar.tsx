import type { Tab, WorkspaceMenuEntry } from '../../types/ui'
import { Icon } from '../common/Icon'

type TopBarProps = {
  activeTab: Tab
  workspace: string
  workspaceMenuOpen: boolean
  optionsMenuOpen: boolean
  workspaces: WorkspaceMenuEntry[]
  activeWorkspaceId: string
  /** Blocks workspace changes while a save, a switch, or an agent run is in flight. */
  busy: boolean
  onToggleWorkspaceMenu: () => void
  onToggleOptionsMenu: () => void
  onCreateWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onRenameWorkspace: () => void
  onToggleFiles: () => void
  onOpenDebug: () => void
  debugCount: number
}

export function TopBar({
  activeTab,
  workspace,
  workspaceMenuOpen,
  optionsMenuOpen,
  workspaces,
  activeWorkspaceId,
  busy,
  onToggleWorkspaceMenu,
  onToggleOptionsMenu,
  onCreateWorkspace,
  onSelectWorkspace,
  onRenameWorkspace,
  onToggleFiles,
  onOpenDebug,
  debugCount,
}: TopBarProps) {
  // The list is read when the menu opens; this keeps the menu from ever
  // rendering empty if that read has not landed or failed.
  const entries = workspaces.length
    ? workspaces
    : [{ id: activeWorkspaceId, name: workspace, subtitle: 'Edited just now' }]

  return (
    <header className="topbar">
      <button className="workspace-trigger" onClick={onToggleWorkspaceMenu} aria-expanded={workspaceMenuOpen} aria-label="Switch workspace">
        <span className="brand-mark"><Icon name="sparkles" size={17} /></span>
        <span className="workspace-copy"><small>Workspace</small><strong>{workspace}</strong></span>
        <Icon name="chevron" size={17} />
      </button>

      <div className="topbar-actions">
        <button className="debug-button" aria-label="Show raw model outputs" onClick={onOpenDebug}>
          <Icon name="bug" size={16} /><span>Debug</span>{debugCount > 0 && <small>{debugCount}</small>}
        </button>
        <button className="icon-button desktop-files-button" aria-label={activeTab === 'files' ? 'Close files' : 'Open files'} onClick={onToggleFiles}>
          <Icon name="folder" />
        </button>
        <button className="icon-button" aria-label="More workspace options" aria-expanded={optionsMenuOpen} onClick={onToggleOptionsMenu}>
          <Icon name="more" />
        </button>
      </div>

      {workspaceMenuOpen && (
        <div className="workspace-menu">
          <button type="button" onClick={onCreateWorkspace} disabled={busy}>
            <span className="workspace-icon"><Icon name="plus" size={16} /></span>
            <span><strong>New workspace</strong></span>
          </button>
          <p>Your workspaces</p>
          {entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === activeWorkspaceId ? 'active' : undefined}
              disabled={busy && entry.id !== activeWorkspaceId}
              onClick={() => onSelectWorkspace(entry.id)}
            >
              <span className="workspace-icon">{entry.name[0]?.toUpperCase() ?? '?'}</span>
              <span><strong>{entry.name}</strong><small>{entry.subtitle}</small></span>
              {entry.id === activeWorkspaceId && <Icon name="check" size={16} />}
            </button>
          ))}
          {busy && <p className="workspace-menu-hint">Finish the current run before switching.</p>}
        </div>
      )}

      {optionsMenuOpen && (
        <div className="workspace-menu options-menu" role="menu">
          <button type="button" role="menuitem" onClick={onRenameWorkspace}>
            <span className="workspace-icon"><Icon name="pencil" size={15} /></span>
            <span><strong>Rename workspace</strong></span>
          </button>
        </div>
      )}
    </header>
  )
}
