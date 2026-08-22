import type { ToolRunGroup } from '../tools/types'
import type { VirtualWorkspaceFile } from '../workspace'

export type Tab = 'chat' | 'preview' | 'files'

export type RunState = 'ready' | 'thinking' | 'complete' | 'cancelled' | 'error'

export type WorkspaceFile = VirtualWorkspaceFile

/** One row of the workspace switcher, formatted for display. */
export type WorkspaceMenuEntry = {
  id: string
  name: string
  subtitle: string
  /** Kept unformatted so callers can rank workspaces by recency. */
  updatedAt: number
}

export type ConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  rawOutput: string
  state: 'complete' | 'streaming' | 'cancelled' | 'error'
  toolRun?: ToolRunGroup
  error?: string
}
