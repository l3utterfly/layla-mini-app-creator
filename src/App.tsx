import { useEffect, useRef, useState } from 'react'
import { ChatPane } from './components/chat/ChatPane'
import { DebugPanel } from './components/debug/DebugPanel'
import { FilesPane } from './components/files/FilesPane'
import { MobileNav } from './components/layout/MobileNav'
import { TopBar } from './components/layout/TopBar'
import { PreviewPane } from './components/preview/PreviewPane'
import { RenameWorkspaceDialog } from './components/layout/RenameWorkspaceDialog'
import { nextWorkspaceName } from './data/bootstrapWorkspace'
import { scaffoldWorkspaceFiles } from './data/scaffoldWorkspace'
import { executeToolCall } from './tools/runtime'
import { layla } from './lib/layla'
import { attachWorkspaceAutosave } from './persistence'
import { saveWorkspaceZip } from './workspace/exportWorkspace'
import type { WorkspaceAutosave, WorkspaceRepository, WorkspaceSummary } from './persistence'
import type { ToolCall, ToolResultEnvelope } from './tools/types'
import type { ConversationMessage, RunState, Tab, WorkspaceMenuEntry } from './types/ui'
import type { VirtualWorkspace, VirtualWorkspaceFileInput } from './workspace'

type AppProps = {
  repository: WorkspaceRepository
  workspaceId: string
  workspaceName: string
  virtualWorkspace: VirtualWorkspace
  derivedFiles: VirtualWorkspaceFileInput[]
}

/** The workspace the whole UI is currently bound to. */
type WorkspaceSession = {
  id: string
  name: string
  workspace: VirtualWorkspace
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

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

function formatEdited(timestamp: number, now: number) {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < minute) return 'Edited just now'
  if (elapsed < hour) return `Edited ${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day) return `Edited ${Math.floor(elapsed / hour)}h ago`
  return `Edited ${Math.floor(elapsed / day)}d ago`
}

function describeWorkspaces(summaries: WorkspaceSummary[]): WorkspaceMenuEntry[] {
  const now = Date.now()
  return summaries.map(summary => ({
    id: summary.id,
    name: summary.name,
    subtitle: formatEdited(summary.updatedAt, now),
  }))
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

function App({ repository, workspaceId, workspaceName, virtualWorkspace, derivedFiles }: AppProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [runState, setRunState] = useState<RunState>('ready')
  const [session, setSession] = useState<WorkspaceSession>(
    () => ({ id: workspaceId, name: workspaceName, workspace: virtualWorkspace }),
  )
  const [workspaces, setWorkspaces] = useState<WorkspaceMenuEntry[]>([])
  const [switching, setSwitching] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [files, setFiles] = useState(() => virtualWorkspace.listFiles())
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [debugOpen, setDebugOpen] = useState(false)
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const autosaveRef = useRef<WorkspaceAutosave | null>(null)
  // React state lags a rapid second click, so the in-flight guard is a ref.
  const changingWorkspaceRef = useRef(false)

  const workspace = session.name
  const activeWorkspace = session.workspace

  // Resetting during render rather than in an effect avoids showing the
  // previous workspace's files for a frame after a switch.
  const [listedWorkspace, setListedWorkspace] = useState(activeWorkspace)
  if (listedWorkspace !== activeWorkspace) {
    setListedWorkspace(activeWorkspace)
    setFiles(activeWorkspace.listFiles())
  }

  useEffect(
    () => activeWorkspace.subscribe(snapshot => setFiles(snapshot.files)),
    [activeWorkspace],
  )

  // Every workspace mutation is written back to the Layla host. Backgrounding
  // the WebView can suspend timers, so a pending save is forced out as soon as
  // the page is hidden rather than waiting for the debounce.
  useEffect(() => {
    const { autosave, stop } = attachWorkspaceAutosave(repository, session.id, session.workspace, {
      onStateChange: state => {
        setSaveError(state.status === 'error' ? state.error?.message ?? 'Unable to save.' : null)
      },
    })
    autosaveRef.current = autosave

    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void autosave.flush().catch(() => undefined)
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      autosaveRef.current = null
      stop()
    }
  }, [repository, session.id, session.workspace])

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setWorkspaceMenuOpen(false)
    setOptionsMenuOpen(false)
  }

  const renameWorkspace = async (name: string) => {
    const summary = await repository.renameWorkspace(session.id, name)
    setSession(current => ({ ...current, name: summary.name }))
  }

  const openWorkspaceMenu = async () => {
    setOptionsMenuOpen(false)
    setWorkspaceMenuOpen(value => !value)
    // The list is read when the menu opens so it never shows a stale name or
    // a workspace another surface created.
    setWorkspaces(describeWorkspaces(await repository.listWorkspaces()))
  }

  /** Rebinds the whole UI to a workspace that is already in the index. */
  const bindWorkspace = async (targetId: string) => {
    const workspace = await repository.hydrateWorkspace(targetId, { derivedFiles })
    await repository.setActiveWorkspace(targetId)
    const summaries = await repository.listWorkspaces()

    setWorkspaces(describeWorkspaces(summaries))
    setSession({
      id: targetId,
      name: summaries.find(entry => entry.id === targetId)?.name ?? 'Workspace',
      workspace,
    })
    // A conversation is about the project it was held in, so chat and preview
    // start clean rather than carrying the previous workspace's context.
    setMessages([])
    setRunState('ready')
    setPreviewRefreshToken(value => value + 1)
    setActiveTab('chat')
    setWorkspaceMenuOpen(false)
  }

  /**
   * Runs a change of active workspace. The outgoing workspace is flushed
   * first: autosave debounces its writes, and its own teardown flush would
   * only run after React had already swapped the session out.
   */
  const changeWorkspace = async (change: () => Promise<void>, failure: string) => {
    if (changingWorkspaceRef.current) return
    changingWorkspaceRef.current = true
    setSwitching(true)
    try {
      await autosaveRef.current?.flush()
      await change()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : failure)
    } finally {
      changingWorkspaceRef.current = false
      setSwitching(false)
    }
  }

  const openWorkspace = (targetId: string) => {
    if (targetId === session.id) {
      setWorkspaceMenuOpen(false)
      return
    }
    void changeWorkspace(() => bindWorkspace(targetId), 'Unable to open that workspace.')
  }

  const createWorkspace = () => {
    void changeWorkspace(async () => {
      const summaries = await repository.listWorkspaces()
      const created = await repository.createWorkspace({
        name: nextWorkspaceName(summaries.map(entry => entry.name)),
        files: scaffoldWorkspaceFiles,
      })
      await bindWorkspace(created.id)
    }, 'Unable to create a workspace.')
  }

  const runTool = async (call: ToolCall): Promise<ToolResultEnvelope> => {
    const execution = await executeToolCall(call, activeWorkspace)
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

    await activeWorkspace.transaction(draft => {
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
    return saveWorkspaceZip(activeWorkspace.snapshot().files, layla.utils)
  }

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
      <TopBar
        activeTab={activeTab}
        workspace={workspace}
        workspaceMenuOpen={workspaceMenuOpen}
        optionsMenuOpen={optionsMenuOpen}
        workspaces={workspaces}
        activeWorkspaceId={session.id}
        busy={switching || runState === 'thinking'}
        onToggleWorkspaceMenu={() => void openWorkspaceMenu()}
        onCreateWorkspace={createWorkspace}
        onSelectWorkspace={openWorkspace}
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
          getWorkspaceSnapshot={() => activeWorkspace.snapshot()}
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
