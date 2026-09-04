import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ChatPane } from './components/chat/ChatPane'
import { ChatSidebar } from './components/chat/ChatSidebar'
import { DebugPanel } from './components/debug/DebugPanel'
import { FilesPane } from './components/files/FilesPane'
import { MobileNav } from './components/layout/MobileNav'
import { TopBar } from './components/layout/TopBar'
import { PreviewPane } from './components/preview/PreviewPane'
import { RenameWorkspaceDialog } from './components/layout/RenameWorkspaceDialog'
import { DeleteWorkspaceDialog } from './components/layout/DeleteWorkspaceDialog'
import { nextWorkspaceName } from './data/bootstrapWorkspace'
import { scaffoldWorkspaceFiles } from './data/scaffoldWorkspace'
import { executeToolCall } from './tools/runtime'
import { layla } from './lib/layla'
import { ChatAutosave, attachWorkspaceAutosave, createChat, titleFromMessages } from './persistence'
import { saveWorkspaceZip } from './workspace/exportWorkspace'
import type {
  PersistedChats,
  WorkspaceAutosave,
  WorkspaceRepository,
  WorkspaceSummary,
} from './persistence'
import type { ToolCall, ToolResultEnvelope } from './tools/types'
import type { ConversationMessage, RunState, Tab, WorkspaceMenuEntry } from './types/ui'
import type { VirtualWorkspace, VirtualWorkspaceFileInput } from './workspace'

type AppProps = {
  repository: WorkspaceRepository
  workspaceId: string
  workspaceName: string
  virtualWorkspace: VirtualWorkspace
  derivedFiles: VirtualWorkspaceFileInput[]
  initialChats: PersistedChats
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
    updatedAt: summary.updatedAt,
  }))
}

/** The workspace to fall back to when `excludedId` goes away: the most recently edited one. */
function mostRecentlyEdited<TEntry extends { id: string; updatedAt: number }>(
  entries: TEntry[],
  excludedId: string,
) {
  return entries
    .filter(entry => entry.id !== excludedId)
    .reduce<TEntry | null>(
      (best, entry) => (best && best.updatedAt >= entry.updatedAt ? best : entry),
      null,
    )
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

function App({
  repository,
  workspaceId,
  workspaceName,
  virtualWorkspace,
  derivedFiles,
  initialChats,
}: AppProps) {
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [files, setFiles] = useState(() => virtualWorkspace.listFiles())
  const [chatDocument, setChatDocument] = useState(initialChats)
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [chatSaveError, setChatSaveError] = useState<string | null>(null)
  const autosaveRef = useRef<WorkspaceAutosave | null>(null)
  const chatAutosaveRef = useRef<ChatAutosave | null>(null)
  const chatDocumentRef = useRef(initialChats)
  // React state lags a rapid second click, so the in-flight guard is a ref.
  const changingWorkspaceRef = useRef(false)

  const workspace = session.name
  const activeWorkspace = session.workspace
  const activeChat = chatDocument.chats.find(chat => chat.id === chatDocument.activeChatId)
    ?? chatDocument.chats[0]!
  const messages = activeChat.messages

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
      if (document.visibilityState === 'hidden') {
        void autosave.flush().catch(() => undefined)
        void chatAutosaveRef.current?.flush().catch(() => undefined)
      }
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      autosaveRef.current = null
      stop()
    }
  }, [repository, session.id, session.workspace])

  useEffect(() => {
    const autosave = new ChatAutosave(repository, session.id, {
      onError: error => setChatSaveError(error?.message ?? null),
    })
    chatAutosaveRef.current = autosave
    return () => {
      chatAutosaveRef.current = null
      autosave.stop()
    }
  }, [repository, session.id])

  const commitChats = (next: PersistedChats) => {
    chatDocumentRef.current = next
    setChatDocument(next)
    chatAutosaveRef.current?.update(next)
  }

  const updateMessages: Dispatch<SetStateAction<ConversationMessage[]>> = update => {
    const current = chatDocumentRef.current
    const chat = current.chats.find(entry => entry.id === current.activeChatId) ?? current.chats[0]!
    const nextMessages = typeof update === 'function' ? update(chat.messages) : update
    const now = Date.now()
    const nextChat = {
      ...chat,
      title: titleFromMessages(nextMessages),
      updatedAt: now,
      messages: nextMessages,
    }
    commitChats({
      ...current,
      chats: current.chats.map(entry => entry.id === chat.id ? nextChat : entry),
    })
  }

  const selectTab = (tab: Tab) => {
    setActiveTab(tab)
    setWorkspaceMenuOpen(false)
    setOptionsMenuOpen(false)
    setChatSidebarOpen(false)
  }

  const renameWorkspace = async (name: string) => {
    const summary = await repository.renameWorkspace(session.id, name)
    setSession(current => ({ ...current, name: summary.name }))
  }

  const refreshWorkspaces = async () => {
    const summaries = await repository.listWorkspaces()
    setWorkspaces(describeWorkspaces(summaries))
    return summaries
  }

  const openWorkspaceMenu = async () => {
    setOptionsMenuOpen(false)
    setChatSidebarOpen(false)
    setWorkspaceMenuOpen(value => !value)
    // The list is read when the menu opens so it never shows a stale name or
    // a workspace another surface created.
    await refreshWorkspaces()
  }

  const openDeleteDialog = async () => {
    setOptionsMenuOpen(false)
    // The dialog names the workspace that will replace this one, so the list
    // is refreshed before it renders. The index is cached, so this is instant.
    await refreshWorkspaces().catch(() => undefined)
    setDeleteOpen(true)
  }

  /** Rebinds the whole UI to a workspace that is already in the index. */
  const bindWorkspace = async (targetId: string) => {
    console.log('TRACE bind:start', targetId, 'derived', derivedFiles.length)
    const [workspace, chats] = await Promise.all([
      repository.hydrateWorkspace(targetId, { derivedFiles }),
      repository.loadChats(targetId),
    ])
    console.log('TRACE bind:hydrated')
    await repository.setActiveWorkspace(targetId)
    const summaries = await repository.listWorkspaces()

    setWorkspaces(describeWorkspaces(summaries))
    setSession({
      id: targetId,
      name: summaries.find(entry => entry.id === targetId)?.name ?? 'Workspace',
      workspace,
    })
    chatDocumentRef.current = chats
    setChatDocument(chats)
    setChatSaveError(null)
    setRunState('ready')
    setPreviewRefreshToken(value => value + 1)
    setActiveTab('chat')
    setWorkspaceMenuOpen(false)
    setChatSidebarOpen(false)
  }

  /**
   * Runs a change of active workspace. The outgoing workspace is flushed
   * first: autosave debounces its writes, and its own teardown flush would
   * only run after React had already swapped the session out.
   */
  const changeWorkspace = async (change: () => Promise<void>) => {
    if (changingWorkspaceRef.current) return
    changingWorkspaceRef.current = true
    setSwitching(true)
    try {
      console.log('TRACE change:flushing')
      await autosaveRef.current?.flush()
      await chatAutosaveRef.current?.flush()
      console.log('TRACE change:flushed')
      await change()
      console.log('TRACE change:changed')
    } finally {
      changingWorkspaceRef.current = false
      setSwitching(false)
    }
  }

  const reportFailure = (failure: string) => (error: unknown) => {
    setSaveError(error instanceof Error ? error.message : failure)
  }

  const scaffoldNewWorkspace = async () => {
    const summaries = await repository.listWorkspaces()
    const created = await repository.createWorkspace({
      name: nextWorkspaceName(summaries.map(entry => entry.name)),
      files: scaffoldWorkspaceFiles,
    })
    await bindWorkspace(created.id)
  }

  const openWorkspace = (targetId: string) => {
    if (targetId === session.id) {
      setWorkspaceMenuOpen(false)
      return
    }
    void changeWorkspace(() => bindWorkspace(targetId))
      .catch(reportFailure('Unable to open that workspace.'))
  }

  const createWorkspace = () => {
    void changeWorkspace(scaffoldNewWorkspace).catch(reportFailure('Unable to create a workspace.'))
  }

  const createChatSession = () => {
    if (runState === 'thinking') return
    const current = chatDocumentRef.current
    const chat = createChat(Date.now())
    commitChats({ ...current, activeChatId: chat.id, chats: [chat, ...current.chats] })
    setRunState('ready')
    setChatSidebarOpen(false)
    setActiveTab('chat')
  }

  const openChatSession = (chatId: string) => {
    if (runState === 'thinking') return
    const current = chatDocumentRef.current
    if (chatId === current.activeChatId) {
      setChatSidebarOpen(false)
      return
    }
    if (!current.chats.some(chat => chat.id === chatId)) return
    commitChats({ ...current, activeChatId: chatId })
    setRunState('ready')
    setChatSidebarOpen(false)
    setActiveTab('chat')
  }

  /**
   * Deletion is irreversible and always leaves the app on some workspace, so
   * the UI never has to render an empty state: the most recently edited
   * survivor if there is one, a fresh scaffold otherwise. Errors are rethrown
   * for the confirmation dialog to show in place.
   */
  const deleteWorkspace = () => changeWorkspace(async () => {
    console.log('TRACE delete:start', session.id)
    await repository.deleteWorkspace(session.id)
    console.log('TRACE delete:deleted')
    const remaining = await repository.listWorkspaces()
    console.log('TRACE delete:listed', remaining.length)
    const successor = mostRecentlyEdited(remaining, session.id)
    console.log('TRACE delete:successor', successor && successor.id)
    if (successor) await bindWorkspace(successor.id)
    else await scaffoldNewWorkspace()
    console.log('TRACE delete:done')
  })

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
        onToggleChats={() => {
          setWorkspaceMenuOpen(false)
          setOptionsMenuOpen(false)
          setChatSidebarOpen(value => !value)
        }}
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
        onDeleteWorkspace={() => void openDeleteDialog()}
        onToggleFiles={() => selectTab(activeTab === 'files' ? 'chat' : 'files')}
        onOpenDebug={() => setDebugOpen(true)}
        debugCount={messages.filter(message => message.role === 'assistant' && message.rawOutput).length}
      />

      <main className="workspace-layout">
        <ChatPane
          // ChatPane owns model-facing context in refs. Each persisted chat
          // gets its own component lifecycle and reconstructed context.
          key={`${session.id}:${activeChat.id}`}
          active={activeTab === 'chat'}
          workspace={workspace}
          runState={runState}
          messages={messages}
          onMessagesChange={updateMessages}
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

      {(saveError || chatSaveError) && (
        <p className="save-alert" role="alert">Not saved to Layla: {saveError || chatSaveError}</p>
      )}

      <MobileNav activeTab={activeTab} runState={runState} onSelect={selectTab} />
      <ChatSidebar
        open={chatSidebarOpen}
        chats={chatDocument.chats}
        activeChatId={activeChat.id}
        busy={switching || runState === 'thinking'}
        onClose={() => setChatSidebarOpen(false)}
        onCreateChat={createChatSession}
        onSelectChat={openChatSession}
      />
      {debugOpen && <DebugPanel messages={messages} onClose={() => setDebugOpen(false)} />}
      {renameOpen && (
        <RenameWorkspaceDialog
          currentName={workspace}
          onRename={renameWorkspace}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteWorkspaceDialog
          workspaceName={workspace}
          successorName={mostRecentlyEdited(workspaces, session.id)?.name ?? null}
          onDelete={deleteWorkspace}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}

export default App
