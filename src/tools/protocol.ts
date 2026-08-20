import { createToolCallFromUnknown, isKnownToolName } from './registry'
import {
  isFreeformToolCallCandidate,
  parseFreeformToolEnvelope,
  serializeFreeformToolEnvelope,
} from './freeformEnvelope'
import type { ToolCall } from './types'

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

  throw new Error(`${call.name} does not have a freeform text envelope.`)
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

    return { ok: false, error: `${name} is not available through the freeform text protocol.` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Malformed tool call.' }
  }
}
