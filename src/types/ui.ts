import type { ToolRunGroup } from '../tools/types'
import type { VirtualWorkspaceFile } from '../workspace'

export type Tab = 'chat' | 'preview' | 'files'

export type RunState = 'ready' | 'thinking' | 'complete' | 'cancelled' | 'error'

export type WorkspaceFile = VirtualWorkspaceFile

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
