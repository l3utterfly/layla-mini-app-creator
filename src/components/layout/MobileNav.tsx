import type { RunState, Tab } from '../../types/ui'
import { Icon, type IconName } from '../common/Icon'

const destinations: Array<{ id: Tab; icon: IconName; label: string }> = [
  { id: 'chat', icon: 'message', label: 'Chat' },
  { id: 'preview', icon: 'eye', label: 'Preview' },
  { id: 'files', icon: 'file', label: 'Files' },
]

type MobileNavProps = {
  activeTab: Tab
  runState: RunState
  onSelect: (tab: Tab) => void
}

export function MobileNav({ activeTab, runState, onSelect }: MobileNavProps) {
  return (
    <nav className="mobile-nav" aria-label="Primary navigation">
      {destinations.map(destination => (
        <button key={destination.id} className={activeTab === destination.id ? 'active' : ''} onClick={() => onSelect(destination.id)}>
          <span>
            <Icon name={destination.icon} size={20} />
            {destination.id === 'chat' && runState === 'thinking' && <i className="nav-run-dot" />}
          </span>
          <small>{destination.label}</small>
        </button>
      ))}
    </nav>
  )
}
