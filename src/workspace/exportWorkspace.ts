import { strToU8, zipSync } from 'fflate'
import type { VirtualWorkspaceFile } from './VirtualWorkspace'

type WorkspaceFileSaver = {
  saveFile: (
    fileName: string,
    contentBase64: string,
    share?: boolean,
  ) => Promise<{ success: boolean; message?: string | null }>
}

function isAgentFile(path: string) {
  return path === '.agent' || path.startsWith('.agent/')
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const textualApplicationMimeTypes = new Set([
  'application/javascript',
  'application/json',
  'application/xhtml+xml',
  'application/xml',
])

export function isStoredBinaryFile(file: VirtualWorkspaceFile) {
  const isText = file.mimeType.startsWith('text/') || textualApplicationMimeTypes.has(file.mimeType)
  return !isText && /^data:[^,]*?(;base64)?,/.test(file.content)
}

export function workspaceFileBytes(file: VirtualWorkspaceFile) {
  const dataUrl = isStoredBinaryFile(file)
    ? /^data:[^,]*?(;base64)?,([\s\S]*)$/.exec(file.content)
    : null
  if (dataUrl) {
    const payload = dataUrl[2] ?? ''
    return dataUrl[1]
      ? decodeBase64(payload.replace(/\s/g, ''))
      : strToU8(decodeURIComponent(payload))
  }

  return strToU8(file.content)
}

export function exportableWorkspaceFiles(files: VirtualWorkspaceFile[]) {
  return files.filter(file => !isAgentFile(file.name))
}

export function createWorkspaceZip(files: VirtualWorkspaceFile[]) {
  const entries: Record<string, Uint8Array> = {}
  for (const file of exportableWorkspaceFiles(files)) {
    entries[file.name] = workspaceFileBytes(file)
  }
  return zipSync(entries, { level: 6 })
}

export function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function workspaceZipFileName(files: VirtualWorkspaceFile[]) {
  const manifest = files.find(file => file.name === 'app.json')
  let title = ''
  if (manifest) {
    try {
      const metadata = JSON.parse(manifest.content) as { title?: unknown }
      if (typeof metadata.title === 'string') title = metadata.title
    } catch {
      // Invalid app metadata should not prevent users from exporting their work.
    }
  }

  const titleWithoutControls = [...title]
    .filter(character => (character.codePointAt(0) ?? 0) >= 0x20)
    .join('')
  const safeTitle = titleWithoutControls
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80)

  return `${safeTitle || 'layla-mini-app'}.zip`
}

export async function saveWorkspaceZip(files: VirtualWorkspaceFile[], saver: WorkspaceFileSaver) {
  const exportFiles = exportableWorkspaceFiles(files)
  const fileName = workspaceZipFileName(exportFiles)
  const contentBase64 = bytesToBase64(createWorkspaceZip(exportFiles))
  const result = await saver.saveFile(fileName, contentBase64, true)
  if (!result.success) throw new Error(result.message ?? 'Layla was unable to save the ZIP file.')
  return fileName
}
