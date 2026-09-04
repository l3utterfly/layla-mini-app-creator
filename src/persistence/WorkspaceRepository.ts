import { WorkspacePersistenceError } from './errors.ts'
import {
  chatsFileName,
  createEmptyChats,
  normalizeChats,
} from './chatDocument.ts'
import {
  createEmptyIndex,
  DEFAULT_ENTRY_PATH,
  normalizeIndex,
  toWorkspaceSummary,
} from './indexDocument.ts'
import { writeJsonFile } from './hostFileStore.ts'
import {
  blobFileName,
  createBlobId,
  createWorkspaceId,
  INDEX_BACKUP_FILE_NAME,
  INDEX_FILE_NAME,
  isPersistedPath,
  persistedWorkspaceFiles,
} from './layout.ts'
import { createVirtualWorkspace, VirtualWorkspace } from '../workspace/index.ts'
import type { HostFileStore } from './hostFileStore.ts'
import type { PersistedChats } from './chatDocument.ts'
import type {
  PersistedFileEntry,
  PersistedIndex,
  PersistedWorkspaceEntry,
  WorkspaceSummary,
} from './types.ts'
import type {
  VirtualWorkspaceFile,
  VirtualWorkspaceFileInput,
  VirtualWorkspaceSnapshot,
} from '../workspace/index.ts'

export type WorkspaceRepositoryOptions = {
  clock?: () => number
}

export type CreateWorkspaceOptions = {
  name: string
  files?: VirtualWorkspaceFileInput[]
  /** Marks the new workspace active in `index.json`. Defaults to true. */
  activate?: boolean
}

export type HydrateWorkspaceOptions = {
  /**
   * Files that are re-seeded rather than read back from the host, such as the
   * `.agent/layla-sdk` skill. They are merged into the hydrated workspace
   * without contributing to its persisted revision.
   */
  derivedFiles?: VirtualWorkspaceFileInput[]
}

function toFileEntry(file: VirtualWorkspaceFile, blob: string): PersistedFileEntry {
  return {
    path: file.name,
    blob,
    mimeType: file.mimeType,
    size: file.size,
    revision: file.revision,
    updatedAt: file.updatedAt,
  }
}

function byPath(left: PersistedFileEntry, right: PersistedFileEntry) {
  return left.path.localeCompare(right.path)
}

/**
 * Owns `index.json` and every blob behind it.
 *
 * Ordering rules, because the host offers no transactions:
 *
 * - Saving writes blobs first, then the index. A crash in between leaves an
 *   unreferenced blob, which is harmless, instead of an index entry pointing
 *   at a file that was never written.
 * - Deleting rewrites the index first, then clears the blob. A crash in
 *   between leaves an orphan, recorded in `orphanedBlobs` and retried by
 *   `sweepOrphanedBlobs`.
 * - Every index write copies the previous index to `index.backup.json` first,
 *   since the host has no atomic rename to swap a temporary file in.
 *
 * All public methods run through one serialized queue, so concurrent callers
 * can never interleave two index rewrites. Work inside that queue reaches the
 * index through `#requireIndex` rather than calling another public method,
 * which would deadlock waiting on the queue it is already holding.
 */
export class WorkspaceRepository {
  readonly #store: HostFileStore
  readonly #clock: () => number
  /** Tail of the serialized operation queue described above. */
  #queue: Promise<unknown> = Promise.resolve()
  /** Last index read from or written to the host; `null` until first load. */
  #index: PersistedIndex | null = null
  /** Exact JSON currently on the host, used to populate the backup file. */
  #indexJson: string | null = null

  constructor(store: HostFileStore, options: WorkspaceRepositoryOptions = {}) {
    this.#store = store
    this.#clock = options.clock ?? Date.now
  }

  /**
   * Reads and validates `index.json`, falling back to `index.backup.json` when
   * the primary index is unreadable, and to a fresh empty index on first run.
   * Rejects an index whose `version` is newer than this build understands.
   */
  loadIndex(): Promise<PersistedIndex> {
    return this.#enqueue(() => this.#requireIndex())
  }

  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      return index.workspaces.map(toWorkspaceSummary)
    })
  }

  getActiveWorkspaceId(): Promise<string | null> {
    return this.#enqueue(async () => (await this.#requireIndex()).activeWorkspaceId)
  }

  setActiveWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      this.#requireEntry(index, workspaceId)
      if (index.activeWorkspaceId === workspaceId) return
      index.activeWorkspaceId = workspaceId
      await this.#writeIndex(index)
    })
  }

  /**
   * Allocates a workspace id, writes a blob per seed file, then appends the
   * entry to `index.json`.
   *
   * Seed files pass through a throwaway `VirtualWorkspace` first so paths, MIME
   * types, sizes, and revisions come from the same code that will maintain them
   * for the rest of the workspace's life.
   */
  createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceSummary> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      const now = this.#clock()
      const id = this.#allocateWorkspaceId(index)
      const snapshot = createVirtualWorkspace(options.files ?? []).snapshot()

      const files: PersistedFileEntry[] = []
      for (const file of persistedWorkspaceFiles(snapshot.files)) {
        const blob = blobFileName(id, createBlobId())
        await this.#store.write(blob, file.content)
        files.push(toFileEntry(file, blob))
      }

      // Conversation state is a companion file, not a virtual workspace file,
      // so it can never leak into the website ZIP.
      await writeJsonFile(this.#store, chatsFileName(id), createEmptyChats(now))

      const entry: PersistedWorkspaceEntry = {
        id,
        name: options.name.trim() || 'Untitled workspace',
        createdAt: now,
        updatedAt: now,
        revision: snapshot.revision,
        entryPath: DEFAULT_ENTRY_PATH,
        files: files.sort(byPath),
        orphanedBlobs: [],
      }

      index.workspaces.push(entry)
      if (options.activate !== false) index.activeWorkspaceId = id
      await this.#writeIndex(index)
      return toWorkspaceSummary(entry)
    })
  }

  /**
   * Rebuilds a `VirtualWorkspace` from persisted blobs.
   *
   * A blob listed in the index but missing on the host is a real integrity
   * failure, not an empty file, and surfaces as `BLOB_MISSING`.
   */
  hydrateWorkspace(
    workspaceId: string,
    options: HydrateWorkspaceOptions = {},
  ): Promise<VirtualWorkspace> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      const entry = this.#requireEntry(index, workspaceId)

      const files: VirtualWorkspaceFile[] = []
      for (const file of entry.files) {
        const content = await this.#store.read(file.blob)
        if (content === null) {
          throw new WorkspacePersistenceError(
            'BLOB_MISSING',
            `${file.path} is listed in ${INDEX_FILE_NAME} but ${file.blob} is missing.`,
            { workspaceId, path: file.path, blob: file.blob },
          )
        }
        files.push({
          name: file.path,
          content,
          mimeType: file.mimeType,
          size: file.size,
          revision: file.revision,
          updatedAt: file.updatedAt,
        })
      }

      const workspace = VirtualWorkspace.fromSnapshot(
        { files, revision: entry.revision },
        { clock: this.#clock },
      )

      // Derived files are re-seeded rather than restored, so they always match
      // the bundled assets of the running build.
      for (const derived of options.derivedFiles ?? []) {
        workspace.writeFile(derived.name, derived.content, { mimeType: derived.mimeType })
      }

      return workspace
    })
  }

  /** Loads this workspace's chat sessions, creating the companion file for legacy workspaces. */
  loadChats(workspaceId: string): Promise<PersistedChats> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      this.#requireEntry(index, workspaceId)
      const filename = chatsFileName(workspaceId)
      const raw = await this.#store.read(filename)
      if (raw === null) {
        const chats = createEmptyChats(this.#clock())
        await writeJsonFile(this.#store, filename, chats)
        return chats
      }

      try {
        return normalizeChats(JSON.parse(raw), filename)
      } catch (error) {
        if (error instanceof WorkspacePersistenceError) throw error
        throw new WorkspacePersistenceError(
          'CHATS_CORRUPT',
          `${filename} does not contain valid JSON.`,
          { filename },
        )
      }
    })
  }

  /** Replaces one workspace's complete chat document without touching its website files. */
  saveChats(workspaceId: string, chats: PersistedChats): Promise<void> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      this.#requireEntry(index, workspaceId)
      const filename = chatsFileName(workspaceId)
      await writeJsonFile(this.#store, filename, normalizeChats(chats, filename))
    })
  }

  /**
   * Persists only the paths that changed, using the per-file revisions already
   * recorded in the index to skip untouched files. This is the hot path driven
   * by `WorkspaceAutosave`.
   *
   * A changed path missing from the snapshot was deleted: its entry leaves the
   * index and its blob is queued for clearing.
   */
  saveChangedFiles(
    workspaceId: string,
    snapshot: VirtualWorkspaceSnapshot,
    changedPaths: string[],
  ): Promise<void> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      await this.#saveChanged(index, workspaceId, snapshot, changedPaths)
    })
  }

  /** Full-snapshot save, for import, duplicate, and recovery from a diverged index. */
  saveWorkspace(workspaceId: string, snapshot: VirtualWorkspaceSnapshot): Promise<void> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      const entry = this.#requireEntry(index, workspaceId)
      const paths = new Set([
        ...snapshot.files.map(file => file.name),
        ...entry.files.map(file => file.path),
      ])
      await this.#saveChanged(index, workspaceId, snapshot, [...paths])
    })
  }

  /**
   * Names live only in `index.json`, so a rename never touches a blob. An
   * empty or whitespace-only name is rejected rather than silently replaced,
   * because it always means the caller did not validate its input.
   */
  renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
    return this.#enqueue(async () => {
      const trimmed = name.trim()
      if (!trimmed) {
        throw new WorkspacePersistenceError(
          'INVALID_NAME',
          'A workspace name cannot be empty.',
          { workspaceId },
        )
      }

      const index = await this.#requireIndex()
      const entry = this.#requireEntry(index, workspaceId)
      if (entry.name === trimmed) return toWorkspaceSummary(entry)

      entry.name = trimmed
      entry.updatedAt = this.#clock()
      await this.#writeIndex(index)
      return toWorkspaceSummary(entry)
    })
  }

  /**
   * Drops the workspace from `index.json`, then clears its blobs and chats.
   *
   * The index is rewritten first so a crash mid-delete cannot leave an entry
   * pointing at a cleared blob. Its blobs move to the index-level
   * legacy-named `orphanedBlobs` list, which outlives the entry that named
   * them, and any host files that resist clearing stay there for a later sweep.
   */
  deleteWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      const entry = this.#requireEntry(index, workspaceId)

      index.orphanedBlobs = [
        ...(index.orphanedBlobs ?? []),
        ...entry.files.map(file => file.blob),
        chatsFileName(workspaceId),
        ...(entry.orphanedBlobs ?? []),
      ]
      index.workspaces = index.workspaces.filter(candidate => candidate.id !== workspaceId)
      if (index.activeWorkspaceId === workspaceId) index.activeWorkspaceId = null
      await this.#writeIndex(index)

      const cleared = await this.#clearOrphanedBlobs(index)
      if (cleared) await this.#writeIndex(index)
    })
  }

  /**
   * Best-effort deletion of blobs the host still holds but the index no longer
   * references. Resolves with the number of blobs removed.
   */
  sweepOrphanedBlobs(workspaceId?: string): Promise<number> {
    return this.#enqueue(async () => {
      const index = await this.#requireIndex()
      const holders = workspaceId === undefined
        ? [index, ...index.workspaces]
        : [this.#requireEntry(index, workspaceId)]

      let cleared = 0
      for (const holder of holders) cleared += await this.#clearOrphanedBlobs(holder)
      if (cleared) await this.#writeIndex(index)
      return cleared
    })
  }

  /**
   * Runs `operation` after every previously queued operation, whether that one
   * succeeded or failed, so one failed save cannot wedge the queue.
   */
  #enqueue<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #requireIndex(): Promise<PersistedIndex> {
    if (this.#index) return this.#index
    this.#index = await this.#readIndex()
    return this.#index
  }

  async #readIndex(): Promise<PersistedIndex> {
    const primary = await this.#readIndexFile(INDEX_FILE_NAME)
    if (primary.index) {
      this.#indexJson = primary.raw
      return primary.index
    }

    const backup = await this.#readIndexFile(INDEX_BACKUP_FILE_NAME)
    // The recovered backup becomes the live index on the next write. Leaving
    // `#indexJson` null stops that write from copying a corrupt primary over
    // the backup that just rescued it.
    if (backup.index) return backup.index

    // A missing index is simply a first run, but a corrupt one with no usable
    // backup must not be silently replaced with an empty index.
    if (primary.error) throw primary.error
    return createEmptyIndex(this.#clock())
  }

  async #readIndexFile(filename: string) {
    let raw: string | null
    try {
      raw = await this.#store.read(filename)
    } catch (error) {
      // A host that cannot be reached is not a recoverable index problem.
      if (error instanceof WorkspacePersistenceError && error.code === 'HOST_UNAVAILABLE') {
        throw error
      }
      return { index: null, raw: null, error: error as Error }
    }
    if (raw === null) return { index: null, raw: null, error: null }

    try {
      return { index: normalizeIndex(JSON.parse(raw), filename), raw, error: null }
    } catch (error) {
      if (error instanceof WorkspacePersistenceError && error.code === 'INDEX_VERSION_UNSUPPORTED') {
        throw error
      }
      return { index: null, raw, error: error as Error }
    }
  }

  async #writeIndex(index: PersistedIndex) {
    index.updatedAt = this.#clock()
    if (this.#indexJson !== null) {
      await this.#store.write(INDEX_BACKUP_FILE_NAME, this.#indexJson)
    }
    await writeJsonFile(this.#store, INDEX_FILE_NAME, index)
    this.#indexJson = `${JSON.stringify(index, null, 2)}\n`
    this.#index = index
  }

  #requireEntry(index: PersistedIndex, workspaceId: string) {
    const entry = index.workspaces.find(candidate => candidate.id === workspaceId)
    if (!entry) {
      throw new WorkspacePersistenceError(
        'WORKSPACE_NOT_FOUND',
        `Workspace ${workspaceId} is not listed in ${INDEX_FILE_NAME}.`,
        { workspaceId },
      )
    }
    return entry
  }

  #allocateWorkspaceId(index: PersistedIndex) {
    let id = createWorkspaceId()
    while (index.workspaces.some(entry => entry.id === id)) id = createWorkspaceId()
    return id
  }

  async #saveChanged(
    index: PersistedIndex,
    workspaceId: string,
    snapshot: VirtualWorkspaceSnapshot,
    changedPaths: string[],
  ) {
    const entry = this.#requireEntry(index, workspaceId)
    const current = new Map(snapshot.files.map(file => [file.name, file]))
    const persisted = new Map(entry.files.map(file => [file.path, file]))
    const orphaned = new Set(entry.orphanedBlobs ?? [])
    let changed = false

    for (const path of new Set(changedPaths)) {
      if (!isPersistedPath(path)) continue
      const file = current.get(path)
      const existing = persisted.get(path)

      if (!file) {
        if (!existing) continue
        persisted.delete(path)
        orphaned.add(existing.blob)
        changed = true
        continue
      }

      // The workspace stamps a content revision on every write, so a matching
      // revision means the blob on the host already holds this content.
      if (existing && existing.revision === file.revision) continue

      const blob = existing?.blob ?? blobFileName(workspaceId, createBlobId())
      await this.#store.write(blob, file.content)
      persisted.set(path, toFileEntry(file, blob))
      changed = true
    }

    if (!changed && entry.revision === snapshot.revision) return

    entry.files = [...persisted.values()].sort(byPath)
    entry.orphanedBlobs = [...orphaned]
    entry.revision = snapshot.revision
    entry.updatedAt = this.#clock()
    await this.#writeIndex(index)

    // Only now that the index no longer references them is it safe to clear
    // the blobs that deletions left behind.
    if (entry.orphanedBlobs.length && (await this.#clearOrphanedBlobs(entry))) {
      await this.#writeIndex(index)
    }
  }

  /**
   * Clears the blobs an index or a workspace entry has orphaned. Both carry an
   * `orphanedBlobs` list: an entry collects files deleted from a live
   * workspace, the index collects everything a deleted workspace left behind.
   */
  async #clearOrphanedBlobs(holder: { orphanedBlobs?: string[] }) {
    const remaining: string[] = []
    let cleared = 0
    for (const blob of holder.orphanedBlobs ?? []) {
      try {
        await this.#store.remove(blob)
        cleared += 1
      } catch {
        // Reclaiming space is best effort; a blob that resists clearing stays
        // listed so a later sweep can try again.
        remaining.push(blob)
      }
    }
    holder.orphanedBlobs = remaining
    return cleared
  }
}

export function createWorkspaceRepository(
  store: HostFileStore,
  options: WorkspaceRepositoryOptions = {},
) {
  return new WorkspaceRepository(store, options)
}
