import { useEffect, useState } from 'react'
import { ChatPane } from './components/chat/ChatPane'
import { DebugPanel } from './components/debug/DebugPanel'
import { FilesPane } from './components/files/FilesPane'
import { MobileNav } from './components/layout/MobileNav'
import { TopBar } from './components/layout/TopBar'
import { PreviewPane } from './components/preview/PreviewPane'
import { RenameWorkspaceDialog } from './components/layout/RenameWorkspaceDialog'
import { executeToolCall } from './tools/runtime'
import { layla } from './lib/layla'
import { attachWorkspaceAutosave } from './persistence'
import { saveWorkspaceZip } from './workspace/exportWorkspace'
import type { WorkspaceRepository } from './persistence'
import type { ToolCall, ToolResultEnvelope } from './tools/types'
import type { ConversationMessage, RunState, Tab } from './types/ui'
import type { VirtualWorkspace } from './workspace'

type AppProps = {
  repository: WorkspaceRepository
  workspaceId: string
  workspaceName: string
  virtualWorkspace: VirtualWorkspace
}

type ImageAssetKind = 'icon' | 'background'

const imageExtensions: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

const imageMimeTypes: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error(`Unable to read ${file.name}.`))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error(`Unable to read ${file.name}.`)))
    reader.readAsDataURL(file)
  })
}

function App({ repository, workspaceId, workspaceName, virtualWorkspace }: AppProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [runState, setRunState] = useState<RunState>('ready')
  const [workspace, setWorkspace] = useState(workspaceName)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [files, setFiles] = useState(() => virtualWorkspace.listFiles())
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [debugOpen, setDebugOpen] = useState(false)
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(
    () => virtualWorkspace.subscribe(snapshot => setFiles(snapshot.files)),
    [virtualWorkspace],
  )

  // Every workspace mutation is written back to the Layla host. Backgrounding
  // the WebView can suspend timers, so a pending save is forced out as soon as
  // the page is hidden rather than waiting for the debounce.
  useEffect(() => {
    const { autosave, stop } = attachWorkspaceAutosave(repository, workspaceId, virtualWorkspace, {
      onStateChange: state => {
        setSaveError(state.status === 'error' ? state.error?.message ?? 'Unable to save.' : null)
      },
    })

    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void autosave.flush().catch(() => undefined)
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      stop()
    }
  }, [repository, workspaceId, virtualWorkspace])

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setWorkspaceMenuOpen(false)
    setOptionsMenuOpen(false)
  }

  const renameWorkspace = async (name: string) => {
    const summary = await repository.renameWorkspace(workspaceId, name)
    setWorkspace(summary.name)
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

  const importImage = async (kind: ImageAssetKind, file: File) => {
    const reportedMimeType = file.type.toLowerCase()
    const originalExtension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const extension = imageExtensions[reportedMimeType] ?? (imageMimeTypes[originalExtension] ? originalExtension : undefined)
    if (!extension) throw new Error('Choose a PNG, JPEG, WebP, GIF, SVG, AVIF, BMP, or ICO image.')
    const mimeType = imageMimeTypes[extension] ?? reportedMimeType

    const path = `${kind === 'icon' ? 'icon' : 'bg'}.${extension}`
    const metadataField = kind === 'icon' ? 'iconUri' : 'backgroundImgUri'
    const content = await readFileAsDataUrl(file)

    await virtualWorkspace.transaction(draft => {
      const manifestFile = draft.readFile('app.json')
      let manifest: Record<string, unknown>
      try {
        manifest = JSON.parse(manifestFile.content) as Record<string, unknown>
      } catch {
        throw new Error('app.json must contain valid JSON before an image can be imported.')
      }

      const previousPath = typeof manifest[metadataField] === 'string' ? manifest[metadataField] : undefined
      draft.writeFile(path, content, { mimeType })
      manifest[metadataField] = path
      draft.writeFile('app.json', `${JSON.stringify(manifest, null, 2)}\n`, {
        expectedRevision: manifestFile.revision,
        mimeType: manifestFile.mimeType,
      })

      const replaceableName = new RegExp(`^${kind === 'icon' ? 'icon' : 'bg'}\\.[a-z0-9]+$`, 'i')
      if (previousPath && previousPath !== path && replaceableName.test(previousPath) && draft.hasFile(previousPath)) {
        draft.deleteFile(previousPath)
      }
    })

    return path
  }

  const exportWorkspace = async () => {
    return saveWorkspaceZip(virtualWorkspace.snapshot().files, layla.utils)
  }

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
      <TopBar
        activeTab={activeTab}
        workspace={workspace}
        workspaceMenuOpen={workspaceMenuOpen}
        optionsMenuOpen={optionsMenuOpen}
        onToggleWorkspaceMenu={() => {
          setOptionsMenuOpen(false)
          setWorkspaceMenuOpen(value => !value)
        }}
        onToggleOptionsMenu={() => {
          setWorkspaceMenuOpen(false)
          setOptionsMenuOpen(value => !value)
        }}
        onRenameWorkspace={() => {
          setOptionsMenuOpen(false)
          setRenameOpen(true)
        }}
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
        <FilesPane
          active={activeTab === 'files'}
          files={files}
          onImportImage={importImage}
          onExport={exportWorkspace}
        />
      </main>

      {saveError && <p className="save-alert" role="alert">Not saved to Layla: {saveError}</p>}

      <MobileNav activeTab={activeTab} runState={runState} onSelect={selectTab} />
      {debugOpen && <DebugPanel messages={messages} onClose={() => setDebugOpen(false)} />}
      {renameOpen && (
        <RenameWorkspaceDialog
          currentName={workspace}
          onRename={renameWorkspace}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </div>
  )
}

export default App
