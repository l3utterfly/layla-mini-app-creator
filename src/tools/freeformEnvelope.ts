const openingEnvelopePattern = /<tool_call name="([a-z][a-z0-9_]*?)"(?: path="([^"\r\n]*)")?>/y
const closingEnvelopePattern = /<\/tool_call>/g

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

export function isFreeformToolCallCandidate(content: string) {
  return /^<tool_call(?:\s|>)/.test(content.trimStart())
}

export function parseFreeformToolEnvelopes(content: string): FreeformToolEnvelope[] | null {
  const envelopes: FreeformToolEnvelope[] = []
  let cursor = 0

  while (cursor < content.length && /\s/.test(content[cursor]!)) cursor += 1

  while (cursor < content.length) {
    openingEnvelopePattern.lastIndex = cursor
    const opening = openingEnvelopePattern.exec(content)
    if (!opening?.[1]) return null

    const payloadStart = openingEnvelopePattern.lastIndex
    closingEnvelopePattern.lastIndex = payloadStart
    let closing: RegExpExecArray | null = null

    while ((closing = closingEnvelopePattern.exec(content))) {
      const remainder = content.slice(closingEnvelopePattern.lastIndex).trimStart()
      if (!remainder || /^<tool_call(?:\s|>)/.test(remainder)) break
    }
    if (!closing) return null

    envelopes.push({
      name: opening[1],
      ...(opening[2] === undefined ? {} : { path: decodeAttribute(opening[2]) }),
      payload: removeEnvelopeFramingNewlines(content.slice(payloadStart, closing.index)),
    })

    cursor = closingEnvelopePattern.lastIndex
    while (cursor < content.length && /\s/.test(content[cursor]!)) cursor += 1
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
