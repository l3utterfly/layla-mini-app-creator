const envelopePattern = /^\s*<tool_call name="([a-z][a-z0-9_]*?)"(?: path="([^"\r\n]*)")?>\r?\n([\s\S]*)\r?\n<\/tool_call>\s*$/

function escapeAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function decodeAttribute(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

export type FreeformToolEnvelope = {
  name: string
  path?: string
  payload: string
}

export function isFreeformToolCallCandidate(content: string) {
  return /^<tool_call(?:\s|>)/.test(content.trimStart())
}

export function parseFreeformToolEnvelope(content: string): FreeformToolEnvelope | null {
  const match = envelopePattern.exec(content)
  if (!match?.[1] || match[3] === undefined) return null
  return {
    name: match[1],
    ...(match[2] === undefined ? {} : { path: decodeAttribute(match[2]) }),
    payload: match[3],
  }
}

export function serializeFreeformToolEnvelope(name: string, payload: string, path?: string) {
  const pathAttribute = path === undefined ? '' : ` path="${escapeAttribute(path)}"`
  return `<tool_call name="${name}"${pathAttribute}>\n${payload}\n</tool_call>`
}
