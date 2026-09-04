import { normalizeWorkspacePath } from '../workspace/index.ts'
import type { VirtualWorkspaceFile } from '../workspace/index.ts'

/**
 * Host file layout.
 *
 * The Layla host exposes a private per-mini-app directory and accepts relative
 * paths. Each virtual workspace gets its own host directory while opaque blob
 * names keep virtual paths decoupled from host filesystem restrictions.
 *
 *   index.json                      registry of every workspace and its files
 *   index.backup.json               previous index, kept for recovery
 *   workspaces/<workspaceId>/chats.json
 *   workspaces/<workspaceId>/<blobId>.blob
 */
export const INDEX_FILE_NAME = 'index.json'
export const INDEX_BACKUP_FILE_NAME = 'index.backup.json'
export const WORKSPACES_DIRECTORY = 'workspaces'
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

export function workspaceDirectory(workspaceId: string) {
  return `${WORKSPACES_DIRECTORY}/${workspaceId}`
}

export function blobFileName(workspaceId: string, blobId: string) {
  return `${workspaceDirectory(workspaceId)}/${blobId}${BLOB_FILE_EXTENSION}`
}

export function isBlobFileNameFor(workspaceId: string, filename: string) {
  const isCurrentLayout = filename.startsWith(`${workspaceDirectory(workspaceId)}/`)
  const isLegacyLayout = filename.startsWith(`${workspaceId}.`)
  return (isCurrentLayout || isLegacyLayout) && filename.endsWith(BLOB_FILE_EXTENSION)
}
