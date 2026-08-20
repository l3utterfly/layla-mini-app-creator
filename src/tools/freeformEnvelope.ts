const openingEnvelopePattern = /<tool_call\b[^>]*>/g
const closingEnvelope = '</tool_call>'

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

function removeEnvelopeFramingNewlines(payload: string) {
  let start = 0
  let end = payload.length

  if (payload.startsWith('\r\n')) start = 2
  else if (payload.startsWith('\n')) start = 1

  if (payload.endsWith('\r\n')) end -= 2
  else if (payload.endsWith('\n')) end -= 1

  return payload.slice(start, Math.max(start, end))
}

function readAttribute(tag: string, name: 'name' | 'path') {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const doubleQuoted = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*"([^"\\r\\n]*)"`))?.[1]
  if (doubleQuoted !== undefined) return doubleQuoted
  return tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*'([^'\\r\\n]*)'`))?.[1]
}

function findNextNamedOpening(content: string, cursor: number) {
  openingEnvelopePattern.lastIndex = cursor
  let opening: RegExpExecArray | null

  while ((opening = openingEnvelopePattern.exec(content))) {
    const name = readAttribute(opening[0], 'name')
    if (name && /^[a-z][a-z0-9_]*$/.test(name)) {
      return {
        name,
        path: readAttribute(opening[0], 'path'),
        payloadStart: openingEnvelopePattern.lastIndex,
      }
    }
  }
  return null
}

export function isFreeformToolCallCandidate(content: string) {
  return /<tool_call(?:\s|>)/.test(content)
}

export function parseFreeformToolEnvelopes(content: string): FreeformToolEnvelope[] | null {
  const envelopes: FreeformToolEnvelope[] = []
  let cursor = 0

  while (cursor < content.length) {
    const opening = findNextNamedOpening(content, cursor)
    if (!opening) break
    const closingIndex = content.indexOf(closingEnvelope, opening.payloadStart)
    if (closingIndex === -1) break

    envelopes.push({
      name: opening.name,
      ...(opening.path === undefined ? {} : { path: decodeAttribute(opening.path) }),
      payload: removeEnvelopeFramingNewlines(content.slice(opening.payloadStart, closingIndex)),
    })
    cursor = closingIndex + closingEnvelope.length
  }

  return envelopes.length ? envelopes : null
}

export function parseFreeformToolEnvelope(content: string): FreeformToolEnvelope | null {
  const envelopes = parseFreeformToolEnvelopes(content)
  return envelopes?.length === 1 ? envelopes[0]! : null
}

export function serializeFreeformToolEnvelope(name: string, payload: string, path?: string) {
  const pathAttribute = path === undefined ? '' : ` path="${escapeAttribute(path)}"`
  return `<tool_call name="${name}"${pathAttribute}>\n${payload}\n</tool_call>`
}
