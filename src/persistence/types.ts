import type { WorkspacePersistenceError } from './errors.ts'

/**
 * Bumped whenever the on-host layout of `index.json` or blob files changes in a
 * way older readers cannot understand. Readers refuse indexes from the future
 * and migrate indexes from the past.
 */
export const PERSISTENCE_SCHEMA_VERSION = 1

/**
 * One virtual-workspace file as it exists on the host.
 *
 * `path` is the workspace-relative path the agent and UI see. `blob` is the
 * flat host filename that holds its bytes. The two are decoupled so a rename
 * only rewrites `index.json`, never the blob.
 */
export type PersistedFileEntry = {
  path: string
  blob: string
  mimeType: string
  /** Byte size of the decoded content, mirroring `VirtualWorkspaceFile.size`. */
  size: number
  /** The `VirtualWorkspaceFile.revision` that was persisted into `blob`. */
  revision: string
  updatedAt: number
}

export type PersistedWorkspaceEntry = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** The `VirtualWorkspace.revision` this record describes. */
  revision: number
  /** Preview/export entry point, normally `index.html`. */
  entryPath: string
  files: PersistedFileEntry[]
  /**
   * Blobs whose index entry is gone but whose host file could not be cleared
   * yet. The host exposes no delete API, so these are retried by a sweep
   * instead of being lost.
   */
  orphanedBlobs?: string[]
}

/** The contents of `index.json`; the only host file whose name is fixed. */
export type PersistedIndex = {
  version: number
  updatedAt: number
  activeWorkspaceId: string | null
  workspaces: PersistedWorkspaceEntry[]
  /**
   * Blobs left behind by a deleted workspace. They outlive the entry that
   * listed them, so they are tracked here rather than on a tombstone entry.
   */
  orphanedBlobs?: string[]
}

/** Workspace metadata for list UI, without loading any file content. */
export type WorkspaceSummary = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  revision: number
  entryPath: string
  fileCount: number
}

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export type AutosaveState = {
  status: AutosaveStatus
  /** Workspace-relative paths waiting to be written. */
  pendingPaths: string[]
  lastSavedAt: number | null
  error: WorkspacePersistenceError | null
}
