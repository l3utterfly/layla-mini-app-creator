import { useEffect, useState } from 'react'
import { ChatPane } from './components/chat/ChatPane'
import { DebugPanel } from './components/debug/DebugPanel'
import { FilesPane } from './components/files/FilesPane'
import { MobileNav } from './components/layout/MobileNav'
import { TopBar } from './components/layout/TopBar'
import { PreviewPane } from './components/preview/PreviewPane'
import { scaffoldWorkspaceFiles } from './data/scaffoldWorkspace'
import { executeToolCall } from './tools/runtime'
import { createVirtualWorkspace } from './workspace'
import type { ToolCall, ToolResultEnvelope } from './tools/types'
import type { ConversationMessage, RunState, Tab } from './types/ui'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [runState, setRunState] = useState<RunState>('ready')
  const [workspace, setWorkspace] = useState('Quiet Weather')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [virtualWorkspace] = useState(() => createVirtualWorkspace(scaffoldWorkspaceFiles))
  const [files, setFiles] = useState(() => virtualWorkspace.listFiles())
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [debugOpen, setDebugOpen] = useState(false)
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0)

  useEffect(
    () => virtualWorkspace.subscribe(snapshot => setFiles(snapshot.files)),
    [virtualWorkspace],
  )

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setWorkspaceMenuOpen(false)
  }

  const selectWorkspace = (name: string) => {
    setWorkspace(name)
    setWorkspaceMenuOpen(false)
  }

  const runTool = async (call: ToolCall): Promise<ToolResultEnvelope> => {
    const execution = await executeToolCall(call, virtualWorkspace)
    return execution.result
  }

  const updateRunState = (state: RunState) => {
    setRunState(state)
    if (state === 'complete' || state === 'cancelled' || state === 'error') {
      setPreviewRefreshToken(value => value + 1)
    }
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
          onRunStateChange={updateRunState}
          onRunTool={runTool}
          getWorkspaceSnapshot={() => virtualWorkspace.snapshot()}
        />
        <PreviewPane
          active={activeTab === 'preview'}
          indexHtml={files.find(file => file.name === 'index.html')?.content ?? ''}
          refreshToken={previewRefreshToken}
          workspace={workspace}
        />
        <FilesPane active={activeTab === 'files'} files={files} />
      </main>

      <MobileNav activeTab={activeTab} runState={runState} onSelect={selectTab} />
      {debugOpen && <DebugPanel messages={messages} onClose={() => setDebugOpen(false)} />}
    </div>
  )
}

export default App
