import { WorkspacePersistenceError } from './errors.ts'
import { PERSISTENCE_SCHEMA_VERSION } from './types.ts'
import type {
  PersistedFileEntry,
  PersistedIndex,
  PersistedWorkspaceEntry,
  WorkspaceSummary,
} from './types.ts'

/**
 * Parsing and validation for `index.json`.
 *
 * The index is the only record of what exists on the host, so a malformed one
 * is rejected loudly rather than partially trusted: silently dropping an
 * unreadable entry would strand its blobs with no way to find them again.
 */

export const DEFAULT_ENTRY_PATH = 'index.html'

export function createEmptyIndex(now: number): PersistedIndex {
  return {
    version: PERSISTENCE_SCHEMA_VERSION,
    updatedAt: now,
    activeWorkspaceId: null,
    workspaces: [],
    orphanedBlobs: [],
  }
}

export function toWorkspaceSummary(entry: PersistedWorkspaceEntry): WorkspaceSummary {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
    entryPath: entry.entryPath,
    fileCount: entry.files.length,
  }
}

function corrupt(filename: string, detail: string): never {
  throw new WorkspacePersistenceError('INDEX_CORRUPT', `${filename} is malformed: ${detail}`, {
    filename,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, filename: string, field: string) {
  if (typeof value !== 'string' || !value) corrupt(filename, `${field} must be a non-empty string.`)
  return value
}

function requireNumber(value: unknown, filename: string, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    corrupt(filename, `${field} must be a number.`)
  }
  return value
}

function normalizeFileEntry(value: unknown, filename: string): PersistedFileEntry {
  if (!isRecord(value)) corrupt(filename, 'each file entry must be an object.')
  return {
    path: requireString(value.path, filename, 'files[].path'),
    blob: requireString(value.blob, filename, 'files[].blob'),
    mimeType: requireString(value.mimeType, filename, 'files[].mimeType'),
    size: requireNumber(value.size, filename, 'files[].size'),
    revision: requireString(value.revision, filename, 'files[].revision'),
    updatedAt: requireNumber(value.updatedAt, filename, 'files[].updatedAt'),
  }
}

function normalizeOrphanedBlobs(value: unknown, filename: string, field: string) {
  if (value === undefined) return []
  if (!Array.isArray(value)) corrupt(filename, `${field} must be an array.`)
  return value.map(blob => requireString(blob, filename, `${field}[]`))
}

function normalizeWorkspaceEntry(value: unknown, filename: string): PersistedWorkspaceEntry {
  if (!isRecord(value)) corrupt(filename, 'each workspace entry must be an object.')
  if (!Array.isArray(value.files)) corrupt(filename, 'workspaces[].files must be an array.')

  const orphanedBlobs = normalizeOrphanedBlobs(
    value.orphanedBlobs,
    filename,
    'workspaces[].orphanedBlobs',
  )

  return {
    id: requireString(value.id, filename, 'workspaces[].id'),
    name: requireString(value.name, filename, 'workspaces[].name'),
    createdAt: requireNumber(value.createdAt, filename, 'workspaces[].createdAt'),
    updatedAt: requireNumber(value.updatedAt, filename, 'workspaces[].updatedAt'),
    revision: requireNumber(value.revision, filename, 'workspaces[].revision'),
    entryPath: typeof value.entryPath === 'string' && value.entryPath
      ? value.entryPath
      : DEFAULT_ENTRY_PATH,
    files: value.files.map(file => normalizeFileEntry(file, filename)),
    orphanedBlobs,
  }
}

/**
 * Validates a parsed index document. Throws `INDEX_VERSION_UNSUPPORTED` for an
 * index written by a newer build so nothing overwrites data this build cannot
 * represent, and `INDEX_CORRUPT` for anything else that does not fit.
 */
export function normalizeIndex(value: unknown, filename: string): PersistedIndex {
  if (!isRecord(value)) corrupt(filename, 'the document must be an object.')

  const version = value.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    corrupt(filename, 'version must be a positive integer.')
  }
  if (version > PERSISTENCE_SCHEMA_VERSION) {
    throw new WorkspacePersistenceError(
      'INDEX_VERSION_UNSUPPORTED',
      `${filename} was written by a newer version of this app (schema ${version}).`,
      { filename, version, supported: PERSISTENCE_SCHEMA_VERSION },
    )
  }
  if (!Array.isArray(value.workspaces)) corrupt(filename, 'workspaces must be an array.')

  const workspaces = value.workspaces.map(entry => normalizeWorkspaceEntry(entry, filename))
  const activeWorkspaceId = typeof value.activeWorkspaceId === 'string'
    && workspaces.some(entry => entry.id === value.activeWorkspaceId)
    ? value.activeWorkspaceId
    : null

  return {
    version: PERSISTENCE_SCHEMA_VERSION,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    activeWorkspaceId,
    workspaces,
    orphanedBlobs: normalizeOrphanedBlobs(value.orphanedBlobs, filename, 'orphanedBlobs'),
  }
}
