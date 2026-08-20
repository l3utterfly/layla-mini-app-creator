import { useRef, useState } from 'react'
import { ChatPane } from './components/chat/ChatPane'
import { DebugPanel } from './components/debug/DebugPanel'
import { FilesPane } from './components/files/FilesPane'
import { MobileNav } from './components/layout/MobileNav'
import { TopBar } from './components/layout/TopBar'
import { PreviewPane } from './components/preview/PreviewPane'
import { workspaceFiles } from './data/mockWorkspace'
import { executeToolCall } from './tools/runtime'
import type { ToolCall, ToolResultEnvelope } from './tools/types'
import type { ConversationMessage, RunState, Tab, WorkspaceFile } from './types/ui'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [runState, setRunState] = useState<RunState>('ready')
  const [workspace, setWorkspace] = useState('Quiet Weather')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [files, setFiles] = useState<WorkspaceFile[]>(() => workspaceFiles.map(file => ({ ...file })))
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [debugOpen, setDebugOpen] = useState(false)
  const workspaceSnapshot = useRef({ files, revision: 1 })

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setWorkspaceMenuOpen(false)
  }

  const selectWorkspace = (name: string) => {
    setWorkspace(name)
    setWorkspaceMenuOpen(false)
  }

  const runTool = async (call: ToolCall): Promise<ToolResultEnvelope> => {
    const execution = await executeToolCall(call, workspaceSnapshot.current)
    workspaceSnapshot.current = execution.workspace
    setFiles(execution.workspace.files)
    return execution.result
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
        onOpenDebug={() => setDebugOpen(true)}
        debugCount={messages.filter(message => message.role === 'assistant' && message.rawOutput).length}
      />

      <main className="workspace-layout">
        <ChatPane
          active={activeTab === 'chat'}
          workspace={workspace}
          runState={runState}
          messages={messages}
          onMessagesChange={setMessages}
          onRunStateChange={setRunState}
          onRunTool={runTool}
        />
        <PreviewPane active={activeTab === 'preview'} workspace={workspace} />
        <FilesPane active={activeTab === 'files'} files={files} />
      </main>

      <MobileNav activeTab={activeTab} runState={runState} onSelect={selectTab} />
      {debugOpen && <DebugPanel messages={messages} onClose={() => setDebugOpen(false)} />}
    </div>
  )
}

export default App
