import type { Tab } from '../../types/ui'
import { Icon } from '../common/Icon'

type TopBarProps = {
  activeTab: Tab
  workspace: string
  workspaceMenuOpen: boolean
  optionsMenuOpen: boolean
  onToggleWorkspaceMenu: () => void
  onToggleOptionsMenu: () => void
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
  onToggleWorkspaceMenu,
  onToggleOptionsMenu,
  onRenameWorkspace,
  onToggleFiles,
  onOpenDebug,
  debugCount,
}: TopBarProps) {
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
          <button type="button">
            <span className="workspace-icon"><Icon name="plus" size={16} /></span>
            <span><strong>New workspace</strong></span>
          </button>
          <p>Your workspaces</p>
          <button className="active" onClick={onToggleWorkspaceMenu}>
            <span className="workspace-icon">{workspace[0]}</span>
            <span><strong>{workspace}</strong><small>Edited just now</small></span>
            <Icon name="check" size={16} />
          </button>
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
