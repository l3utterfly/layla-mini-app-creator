import { createToolCallFromUnknown, isKnownToolName } from './registry'
import { materializeToolCatalog } from './registry'
import {
  isFreeformToolCallCandidate,
  parseFreeformToolEnvelope,
  serializeFreeformToolEnvelope,
} from './freeformEnvelope'
import type { ToolCall } from './types'

const textProtocolToolNames = new Set([
  'list_files',
  'read_file',
  'search_files',
  'write_file',
  'apply_patch',
  'edit_file',
  'delete_file',
  'preview_check',
])

function isTextProtocolToolName(name: string) {
  return isKnownToolName(name) && textProtocolToolNames.has(name)
}

export function materializeTextToolCatalog(workspaceRevision: number) {
  return materializeToolCatalog({
    workspaceId: 'active',
    workspaceRevision,
    invoke: async () => {
      throw new Error('The prompt catalog cannot execute tools.')
    },
  }).filter(tool => textProtocolToolNames.has(tool.name))
}

export function isToolCallCandidate(content: string) {
  return isFreeformToolCallCandidate(content)
}

export function serializeToolCall(call: ToolCall): string {
  if (call.name === 'write_file') {
    return serializeFreeformToolEnvelope('write_file', String(call.arguments.content), String(call.arguments.path))
  }

  if (call.name === 'apply_patch') {
    return serializeFreeformToolEnvelope('apply_patch', String(call.arguments.patch))
  }

  if (!isTextProtocolToolName(call.name)) {
    throw new Error(`${call.name} is not available through the text protocol.`)
  }
  return serializeFreeformToolEnvelope(call.name, JSON.stringify(call.arguments, null, 2))
}

export type ParsedToolCall =
  | { ok: true; call: ToolCall }
  | { ok: false; error: string }

export function parseToolCall(content: string, callId?: string): ParsedToolCall {
  try {
    const envelope = parseFreeformToolEnvelope(content)
    if (!envelope) {
      return { ok: false, error: 'Response is not one exact <tool_call> envelope.' }
    }

    const { name, path, payload } = envelope
    if (!isKnownToolName(name)) return { ok: false, error: `Unknown tool: ${name}` }
    if (!isTextProtocolToolName(name)) {
      return { ok: false, error: `${name} is not available through the text protocol.` }
    }

    if (name === 'write_file') {
      if (path === undefined) return { ok: false, error: 'write_file requires a path attribute.' }
      return {
        ok: true,
        call: createToolCallFromUnknown(name, { path, content: payload }, callId),
      }
    }

    if (name === 'apply_patch') {
      if (path !== undefined) return { ok: false, error: 'apply_patch does not accept a path attribute.' }
      return {
        ok: true,
        call: createToolCallFromUnknown(name, { patch: payload }, callId),
      }
    }

    if (path !== undefined) {
      return { ok: false, error: `${name} does not accept a path attribute.` }
    }

    let argumentsValue: unknown
    try {
      argumentsValue = JSON.parse(payload)
    } catch {
      return { ok: false, error: `${name} requires one JSON object in the tool body.` }
    }
    if (typeof argumentsValue !== 'object' || argumentsValue === null || Array.isArray(argumentsValue)) {
      return { ok: false, error: `${name} requires one JSON object in the tool body.` }
    }
    return {
      ok: true,
      call: createToolCallFromUnknown(name, argumentsValue as Record<string, unknown>, callId),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Malformed tool call.' }
  }
}
