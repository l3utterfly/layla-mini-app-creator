import { useState } from 'react'
import { ChatPane } from './components/chat/ChatPane'
import { FilesPane } from './components/files/FilesPane'
import { MobileNav } from './components/layout/MobileNav'
import { TopBar } from './components/layout/TopBar'
import { PreviewPane } from './components/preview/PreviewPane'
import type { RunState, Tab } from './types/ui'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [runState, setRunState] = useState<RunState>('complete')
  const [workspace, setWorkspace] = useState('Quiet Weather')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setWorkspaceMenuOpen(false)
  }

  const selectWorkspace = (name: string) => {
    setWorkspace(name)
    setWorkspaceMenuOpen(false)
  }

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
      <TopBar
        activeTab={activeTab}
        workspace={workspace}
        workspaceMenuOpen={workspaceMenuOpen}
        onToggleWorkspaceMenu={() => setWorkspaceMenuOpen(value => !value)}
        onSelectWorkspace={selectWorkspace}
        onToggleFiles={() => selectTab(activeTab === 'files' ? 'chat' : 'files')}
      />

      <main className="workspace-layout">
        <ChatPane active={activeTab === 'chat'} runState={runState} onRunStateChange={setRunState} onShowPreview={() => selectTab('preview')} />
        <PreviewPane active={activeTab === 'preview'} workspace={workspace} />
        <FilesPane active={activeTab === 'files'} />
      </main>

      <MobileNav activeTab={activeTab} runState={runState} onSelect={selectTab} />
    </div>
  )
}

export default App
