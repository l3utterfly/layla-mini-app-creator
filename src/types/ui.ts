export type Tab = 'chat' | 'preview' | 'files'

export type RunState = 'ready' | 'thinking' | 'complete' | 'cancelled' | 'error'

export type WorkspaceOption = {
  name: string
  edited: string
  colorClass: string
}

export type WorkspaceFile = {
  name: string
  type: string
  size: string
  color: string
  content: string
}
