import { createToolCallFromUnknown, isKnownToolName } from './registry'
import type { JsonObject, ToolCall } from './types'

const envelopePattern = /^<tool_call>(\{[\s\S]*\})<\/tool_call>$/

export function serializeToolCall(call: ToolCall): string {
  return `<tool_call>${JSON.stringify({ name: call.name, arguments: call.arguments })}</tool_call>`
}

export type ParsedToolCall =
  | { ok: true; call: ToolCall }
  | { ok: false; error: string }

export function parseToolCall(content: string, callId?: string): ParsedToolCall {
  const match = content.trim().match(envelopePattern)
  if (!match?.[1]) return { ok: false, error: 'Response is not an exact tool-call envelope.' }

  try {
    const payload = JSON.parse(match[1]) as { name?: unknown; arguments?: unknown }
    if (typeof payload.name !== 'string' || !isKnownToolName(payload.name)) {
      return { ok: false, error: `Unknown tool: ${String(payload.name)}` }
    }
    if (typeof payload.arguments !== 'object' || payload.arguments === null || Array.isArray(payload.arguments)) {
      return { ok: false, error: 'Tool arguments must be an object.' }
    }
    return {
      ok: true,
      call: createToolCallFromUnknown(payload.name, payload.arguments as JsonObject, callId),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Malformed tool call.' }
  }
}
