import { workspaceOptions } from '../../data/mockWorkspace'
import type { Tab } from '../../types/ui'
import { Icon } from '../common/Icon'

type TopBarProps = {
  activeTab: Tab
  workspace: string
  workspaceMenuOpen: boolean
  onToggleWorkspaceMenu: () => void
  onSelectWorkspace: (workspace: string) => void
  onToggleFiles: () => void
  onOpenDebug: () => void
  debugCount: number
}

export function TopBar({
  activeTab,
  workspace,
  workspaceMenuOpen,
  onToggleWorkspaceMenu,
  onSelectWorkspace,
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
        <button className="icon-button" aria-label="Create workspace" onClick={onToggleWorkspaceMenu}><Icon name="plus" /></button>
        <button className="icon-button" aria-label="More workspace options"><Icon name="more" /></button>
      </div>

      {workspaceMenuOpen && (
        <div className="workspace-menu">
          <p>Your workspaces</p>
          {workspaceOptions.map(option => (
            <button key={option.name} className={option.name === workspace ? 'active' : ''} onClick={() => onSelectWorkspace(option.name)}>
              <span className={`workspace-icon ${option.colorClass}`}>{option.name[0]}</span>
              <span><strong>{option.name}</strong><small>{option.edited}</small></span>
              {option.name === workspace && <Icon name="check" size={16} />}
            </button>
          ))}
          <button className="new-workspace"><Icon name="plus" size={16} /> New workspace</button>
        </div>
      )}
    </header>
  )
}
