import { normalizeWorkspacePath } from '../workspace/index.ts'
import type { VirtualWorkspaceFile } from '../workspace/index.ts'

/**
 * Host file layout.
 *
 * The Layla host exposes a flat, private per-mini-app directory through
 * `saveFile`/`readFile` only: there is no listing, delete, or rename call, and
 * directory support is not guaranteed. Every host filename is therefore flat
 * and built from characters that survive any filesystem.
 *
 *   index.json                      registry of every workspace and its files
 *   index.backup.json               previous index, kept for recovery
 *   <workspaceId>.<blobId>.blob     one virtual-workspace file
 */
export const INDEX_FILE_NAME = 'index.json'
export const INDEX_BACKUP_FILE_NAME = 'index.backup.json'
export const BLOB_FILE_EXTENSION = '.blob'

/**
 * Path prefixes that are rebuilt from bundled assets on every load rather than
 * persisted. `.agent/` holds the trusted `layla-sdk` skill, which is large,
 * identical across workspaces, and always re-seeded at initialization.
 */
export const DERIVED_PATH_PREFIXES = ['.agent/'] as const

export function isPersistedPath(path: string) {
  const normalized = normalizeWorkspacePath(path)
  return !DERIVED_PATH_PREFIXES.some(
    prefix => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  )
}

export function persistedWorkspaceFiles(files: VirtualWorkspaceFile[]) {
  return files.filter(file => isPersistedPath(file.name))
}

const idAlphabet = '0123456789abcdefghijklmnopqrstuvwxyz'

export function randomId(length: number) {
  const values = crypto.getRandomValues(new Uint8Array(length))
  let id = ''
  for (const value of values) id += idAlphabet[value % idAlphabet.length]
  return id
}

export function createWorkspaceId() {
  return `wk${randomId(10)}`
}

/**
 * Blob ids are random rather than sequential so a blob name is never reused
 * after a delete, which would otherwise let a stale host file resurface.
 */
export function createBlobId() {
  return `b${randomId(8)}`
}

export function blobFileName(workspaceId: string, blobId: string) {
  return `${workspaceId}.${blobId}${BLOB_FILE_EXTENSION}`
}

export function isBlobFileNameFor(workspaceId: string, filename: string) {
  return filename.startsWith(`${workspaceId}.`) && filename.endsWith(BLOB_FILE_EXTENSION)
}
