import { getToolDefinition } from './registry'
import { applyWorkspacePatch, ApplyPatchError } from './applyPatch'
import type { JsonObject, ToolCall, ToolResultEnvelope } from './types'
import type { WorkspaceFile } from '../types/ui'

export type WorkspaceSnapshot = {
  files: WorkspaceFile[]
  revision: number
}

export type ToolExecution = {
  workspace: WorkspaceSnapshot
  result: ToolResultEnvelope
}

class WorkspaceToolError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function normalizePath(input: unknown) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new WorkspaceToolError('INVALID_PATH', 'A non-empty workspace-relative path is required.')
  }

  const normalized = input.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new WorkspaceToolError('INVALID_PATH', 'Paths must stay inside the active workspace.')
  }
  return normalized
}

function hashContent(content: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function formatSize(content: string) {
  const bytes = new TextEncoder().encode(content).byteLength
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function fileAppearance(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'html') return { type: 'HTML', color: '#ff7b72' }
  if (extension === 'css') return { type: 'CSS', color: '#47a6ff' }
  if (extension === 'js' || extension === 'mjs') return { type: 'JS', color: '#e9d34f' }
  if (extension === 'json') return { type: 'JSON', color: '#f5c451' }
  return { type: extension?.toUpperCase() || 'TEXT', color: '#a8a8b0' }
}

function makeWorkspaceFile(path: string, content: string): WorkspaceFile {
  return { name: path, content, size: formatSize(content), ...fileAppearance(path) }
}

function findFile(files: WorkspaceFile[], path: string) {
  return files.find(file => file.name === path)
}

function requireFile(files: WorkspaceFile[], path: string) {
  const file = findFile(files, path)
  if (!file) throw new WorkspaceToolError('FILE_NOT_FOUND', `${path} does not exist.`)
  return file
}

function requireRevision(file: WorkspaceFile, expectedRevision: unknown) {
  const actualRevision = hashContent(file.content)
  if (typeof expectedRevision !== 'string' || expectedRevision !== actualRevision) {
    throw new WorkspaceToolError(
      'REVISION_CONFLICT',
      `${file.name} changed after revision ${String(expectedRevision)}; read it again (current revision ${actualRevision}).`,
    )
  }
}

function executeOperation(
  name: string,
  args: JsonObject,
  workspace: WorkspaceSnapshot,
): { data: JsonObject; workspace: WorkspaceSnapshot; changedPaths: string[]; diagnostics: string[] } {
  const unchanged = { workspace, changedPaths: [] as string[], diagnostics: [] as string[] }

  if (name === 'list_files') {
    const prefix = args.path ? `${normalizePath(args.path).replace(/\/$/, '')}/` : ''
    return { data: { paths: workspace.files.map(file => file.name).filter(path => path.startsWith(prefix)) }, ...unchanged }
  }

  if (name === 'read_file') {
    const path = normalizePath(args.path)
    const file = requireFile(workspace.files, path)
    const lines = file.content.split('\n')
    const start = typeof args.startLine === 'number' ? Math.max(1, Math.floor(args.startLine)) : 1
    const end = typeof args.endLine === 'number' ? Math.max(start, Math.floor(args.endLine)) : lines.length
    return {
      data: { path, revision: hashContent(file.content), content: lines.slice(start - 1, end).join('\n') },
      ...unchanged,
    }
  }

  if (name === 'search_files') {
    const prefix = args.path ? `${normalizePath(args.path).replace(/\/$/, '')}/` : ''
    let matcher: RegExp
    try {
      matcher = args.isRegex ? new RegExp(String(args.query)) : new RegExp(String(args.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    } catch (error) {
      throw new WorkspaceToolError('INVALID_PATTERN', error instanceof Error ? error.message : 'Invalid search pattern.')
    }
    const matches = workspace.files
      .filter(file => file.name.startsWith(prefix))
      .flatMap(file => file.content.split('\n').flatMap((text, index) => matcher.test(text) ? [{ path: file.name, line: index + 1, text }] : []))
      .slice(0, 100)
    return { data: { matches }, ...unchanged }
  }

  if (name === 'write_file') {
    const path = normalizePath(args.path)
    const content = String(args.content)
    const existing = findFile(workspace.files, path)
    if (existing && args.expectedRevision !== undefined) requireRevision(existing, args.expectedRevision)
    const files = existing
      ? workspace.files.map(file => file.name === path ? makeWorkspaceFile(path, content) : file)
      : [...workspace.files, makeWorkspaceFile(path, content)]
    const nextWorkspace = { files, revision: workspace.revision + 1 }
    return {
      data: { path, revision: hashContent(content), changeSummary: existing ? 'Replaced file' : 'Created file' },
      workspace: nextWorkspace,
      changedPaths: [path],
      diagnostics: [],
    }
  }

  if (name === 'apply_patch') {
    const applied = applyWorkspacePatch(workspace.files, String(args.patch), normalizePath, makeWorkspaceFile)
    return {
      data: {
        paths: applied.changedPaths,
        changeSummary: `Changed ${applied.changedPaths.length} ${applied.changedPaths.length === 1 ? 'file' : 'files'}`,
      },
      workspace: { files: applied.files, revision: workspace.revision + 1 },
      changedPaths: applied.changedPaths,
      diagnostics: [],
    }
  }

  if (name === 'edit_file') {
    const path = normalizePath(args.path)
    const file = requireFile(workspace.files, path)
    requireRevision(file, args.expectedRevision)
    const replacements = args.replacements as Array<{ oldText: string; newText: string }>
    let content = file.content
    for (const replacement of replacements) {
      if (!content.includes(replacement.oldText)) {
        throw new WorkspaceToolError('TEXT_NOT_FOUND', `An exact replacement target was not found in ${path}.`)
      }
      content = content.replace(replacement.oldText, replacement.newText)
    }
    const files = workspace.files.map(entry => entry.name === path ? makeWorkspaceFile(path, content) : entry)
    return {
      data: { path, revision: hashContent(content), changeSummary: `${replacements.length} replacements` },
      workspace: { files, revision: workspace.revision + 1 },
      changedPaths: [path],
      diagnostics: [],
    }
  }

  if (name === 'delete_file') {
    const path = normalizePath(args.path)
    const file = requireFile(workspace.files, path)
    requireRevision(file, args.expectedRevision)
    return {
      data: { path, revision: hashContent(file.content), changeSummary: 'Deleted file' },
      workspace: { files: workspace.files.filter(entry => entry.name !== path), revision: workspace.revision + 1 },
      changedPaths: [path],
      diagnostics: [],
    }
  }

  if (name === 'preview_check') {
    return { data: { issueCount: 0, status: 'loaded' }, ...unchanged }
  }

  throw new WorkspaceToolError('TOOL_UNAVAILABLE', `${name} is not available in this workspace runtime.`)
}

export async function executeToolCall(call: ToolCall, workspace: WorkspaceSnapshot): Promise<ToolExecution> {
  let nextWorkspace = workspace
  let changedPaths: string[] = []
  let diagnostics: string[] = []

  try {
    const definition = getToolDefinition(call.name as Parameters<typeof getToolDefinition>[0])
    const data = await definition.handler(call.arguments as never, {
      workspaceId: 'active',
      workspaceRevision: workspace.revision,
      invoke: async <TResult extends JsonObject>(toolName: string, argumentsValue: JsonObject) => {
        const execution = executeOperation(toolName, argumentsValue, nextWorkspace)
        nextWorkspace = execution.workspace
        changedPaths = execution.changedPaths
        diagnostics = execution.diagnostics
        return execution.data as TResult
      },
    })

    return {
      workspace: nextWorkspace,
      result: {
        callId: call.callId,
        tool: call.name,
        ok: true,
        workspaceRevision: nextWorkspace.revision,
        changedPaths,
        data,
        diagnostics,
      },
    }
  } catch (error) {
    return {
      workspace,
      result: {
        callId: call.callId,
        tool: call.name,
        ok: false,
        workspaceRevision: workspace.revision,
        changedPaths: [],
        diagnostics: [],
        error: {
          code: error instanceof WorkspaceToolError || error instanceof ApplyPatchError ? error.code : 'TOOL_ERROR',
          message: error instanceof Error ? error.message : 'The tool call failed.',
        },
      },
    }
  }
}
