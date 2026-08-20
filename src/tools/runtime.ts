import { getToolDefinition } from './registry'
import {
  VirtualWorkspace,
  VirtualWorkspaceError,
  type VirtualWorkspaceSnapshot,
} from '../workspace'
import type { JsonObject, ToolCall, ToolResultEnvelope } from './types'

export type WorkspaceSnapshot = VirtualWorkspaceSnapshot

export type ToolExecution = {
  workspace: WorkspaceSnapshot
  result: ToolResultEnvelope
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function executeOperation(
  name: string,
  args: JsonObject,
  workspace: VirtualWorkspace,
): { data: JsonObject; changedPaths: string[]; diagnostics: string[] } {
  const unchanged = { changedPaths: [] as string[], diagnostics: [] as string[] }

  if (name === 'list_files') {
    return {
      data: { paths: workspace.listFiles(optionalString(args.path)).map(file => file.name) },
      ...unchanged,
    }
  }

  if (name === 'read_file') {
    return {
      data: workspace.readFile(String(args.path), {
        startLine: optionalNumber(args.startLine),
        endLine: optionalNumber(args.endLine),
      }),
      ...unchanged,
    }
  }

  if (name === 'search_files') {
    return {
      data: {
        matches: workspace.searchFiles(String(args.query), {
          path: optionalString(args.path),
          isRegex: args.isRegex === true,
        }),
      },
      ...unchanged,
    }
  }

  if (name === 'write_file') {
    const path = String(args.path)
    const existed = workspace.hasFile(path)
    const file = workspace.writeFile(path, String(args.content), {
      expectedRevision: optionalString(args.expectedRevision),
    })
    return {
      data: {
        path: file.name,
        revision: file.revision,
        changeSummary: existed ? 'Replaced file' : 'Created file',
      },
      changedPaths: [file.name],
      diagnostics: [],
    }
  }

  if (name === 'apply_patch') {
    const applied = workspace.applyPatch(String(args.patch))
    return {
      data: {
        paths: applied.changedPaths,
        changeSummary: `Changed ${applied.changedPaths.length} ${applied.changedPaths.length === 1 ? 'file' : 'files'}`,
      },
      changedPaths: applied.changedPaths,
      diagnostics: [],
    }
  }

  if (name === 'edit_file') {
    const replacements = args.replacements as Array<{ oldText: string; newText: string }>
    const file = workspace.editFile(
      String(args.path),
      String(args.expectedRevision),
      replacements,
    )
    return {
      data: {
        path: file.name,
        revision: file.revision,
        changeSummary: `${replacements.length} replacements`,
      },
      changedPaths: [file.name],
      diagnostics: [],
    }
  }

  if (name === 'delete_file') {
    const file = workspace.deleteFile(String(args.path), String(args.expectedRevision))
    return {
      data: { path: file.name, revision: file.revision, changeSummary: 'Deleted file' },
      changedPaths: [file.name],
      diagnostics: [],
    }
  }

  if (name === 'preview_check') {
    return { data: { issueCount: 0, status: 'loaded' }, ...unchanged }
  }

  throw new VirtualWorkspaceError(
    'TOOL_UNAVAILABLE',
    `${name} is not available in this workspace runtime.`,
  )
}

export async function executeToolCall(
  call: ToolCall,
  workspaceInput: VirtualWorkspace | WorkspaceSnapshot,
): Promise<ToolExecution> {
  const workspace = workspaceInput instanceof VirtualWorkspace
    ? workspaceInput
    : VirtualWorkspace.fromSnapshot(workspaceInput)
  const before = workspace.snapshot()
  const changedPaths: string[] = []
  const diagnostics: string[] = []

  try {
    const definition = getToolDefinition(call.name as Parameters<typeof getToolDefinition>[0])
    const data = await workspace.transaction(async transactionWorkspace => definition.handler(
      call.arguments as never,
      {
        workspaceId: 'active',
        workspaceRevision: before.revision,
        invoke: async <TResult extends JsonObject>(toolName: string, argumentsValue: JsonObject) => {
          const execution = executeOperation(toolName, argumentsValue, transactionWorkspace)
          for (const path of execution.changedPaths) {
            if (!changedPaths.includes(path)) changedPaths.push(path)
          }
          diagnostics.push(...execution.diagnostics)
          return execution.data as TResult
        },
      },
    ))
    const snapshot = workspace.snapshot()

    return {
      workspace: snapshot,
      result: {
        callId: call.callId,
        tool: call.name,
        ok: true,
        workspaceRevision: snapshot.revision,
        changedPaths,
        data,
        diagnostics,
      },
    }
  } catch (error) {
    return {
      workspace: before,
      result: {
        callId: call.callId,
        tool: call.name,
        ok: false,
        workspaceRevision: before.revision,
        changedPaths: [],
        diagnostics: [],
        error: {
          code: error instanceof VirtualWorkspaceError ? error.code : 'TOOL_ERROR',
          message: error instanceof Error ? error.message : 'The tool call failed.',
        },
      },
    }
  }
}
