import { bytesToBase64 } from '../workspace/exportWorkspace.ts'

/**
 * The host file APIs speak base64. `saveFile` wants bare base64 with no data
 * URI prefix; `readFile` returns base64 that normally *does* carry one. Every
 * conversion between virtual-workspace text and host payloads goes through
 * this module so that asymmetry is handled in exactly one place.
 *
 * `VirtualWorkspace` stores all content as strings — binary assets are already
 * data URLs — so a blob payload is always UTF-8 text.
 */

const dataUriPattern = /^data:[^,]*?(;base64)?,([\s\S]*)$/

export function utf8ToBase64(text: string) {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function base64ToUtf8(base64: string) {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Accepts either bare base64 or a `data:...;base64,` payload as returned by
 * `layla.utils.readFile`, and yields bare base64.
 */
export function stripDataUriPrefix(value: string) {
  const match = dataUriPattern.exec(value)
  if (!match) return value
  const payload = match[2] ?? ''
  return match[1] ? payload : utf8ToBase64(decodeURIComponent(payload))
}
