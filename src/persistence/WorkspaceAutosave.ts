import { WorkspacePersistenceError } from './errors.ts'
import { isPersistedPath } from './layout.ts'
import type { WorkspaceRepository } from './WorkspaceRepository.ts'
import type { AutosaveState } from './types.ts'
import type { VirtualWorkspace } from '../workspace/index.ts'

export type WorkspaceAutosaveOptions = {
  /** Quiet period after the last workspace change before a save runs. */
  debounceMs?: number
  onStateChange?: (state: AutosaveState) => void
  clock?: () => number
}

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 400

function toPersistenceError(error: unknown) {
  if (error instanceof WorkspacePersistenceError) return error
  return new WorkspacePersistenceError(
    'WRITE_FAILED',
    error instanceof Error ? error.message : 'Unable to save the workspace.',
  )
}

/**
 * Turns `VirtualWorkspace` change events into persistence writes.
 *
 * The workspace already reports `changedPaths` per commit, so autosave never
 * diffs snapshots: it unions changed paths into a dirty set, waits out a quiet
 * period, and hands the set plus the latest snapshot to the repository. Saves
 * never overlap — a change arriving mid-save re-arms the timer instead of
 * starting a second write.
 *
 * Derived paths (`.agent/`) are dropped here so they never reach the host.
 *
 * A failed save keeps its paths dirty and reports `error`. It is retried on
 * the next workspace change or `flush()`, never on a timer, so an unreachable
 * host is not hammered.
 */
export class WorkspaceAutosave {
  readonly repository: WorkspaceRepository
  readonly workspaceId: string
  readonly workspace: VirtualWorkspace
  readonly debounceMs: number

  readonly #onStateChange?: (state: AutosaveState) => void
  readonly #clock: () => number
  readonly #dirtyPaths = new Set<string>()

  #state: AutosaveState = {
    status: 'idle',
    pendingPaths: [],
    lastSavedAt: null,
    error: null,
  }
  #timer: ReturnType<typeof setTimeout> | null = null
  #inFlight: Promise<void> | null = null
  #unsubscribe: (() => void) | null = null

  constructor(
    repository: WorkspaceRepository,
    workspaceId: string,
    workspace: VirtualWorkspace,
    options: WorkspaceAutosaveOptions = {},
  ) {
    this.repository = repository
    this.workspaceId = workspaceId
    this.workspace = workspace
    this.debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS
    this.#onStateChange = options.onStateChange
    this.#clock = options.clock ?? Date.now
  }

  get state(): AutosaveState {
    return this.#state
  }

  /**
   * Subscribes to the workspace. The returned function unsubscribes and kicks
   * off a final save without waiting for it, so it is safe to use as a React
   * effect cleanup. Await `flush()` instead when the save must complete.
   */
  start(): () => void {
    if (this.#unsubscribe) return () => this.stop()

    this.#unsubscribe = this.workspace.subscribe((_snapshot, change) => {
      const added = this.#markDirty(change.changedPaths)
      if (!added) return
      this.#publish({ status: 'pending', pendingPaths: [...this.#dirtyPaths] })
      this.#arm()
    })

    return () => this.stop()
  }

  stop() {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#clearTimer()
    if (this.#dirtyPaths.size) void this.flush().catch(() => undefined)
  }

  /**
   * Writes pending changes immediately. Call before switching workspaces,
   * exporting, or unloading, and await it so a save cannot be cut short.
   * Rejects with the underlying `WorkspacePersistenceError` if a write fails.
   */
  async flush(): Promise<void> {
    this.#clearTimer()
    await this.#settle()
    // A save that succeeds clears every path it took, so this loop only runs
    // again for changes that arrived while it was running, and exits on error.
    while (this.#dirtyPaths.size) await this.#save()
  }

  /** Records changed paths, ignoring the ones that are never persisted. */
  #markDirty(changedPaths: string[]) {
    let added = false
    for (const path of changedPaths) {
      if (!isPersistedPath(path)) continue
      this.#dirtyPaths.add(path)
      added = true
    }
    return added
  }

  #arm() {
    this.#clearTimer()
    this.#timer = setTimeout(() => {
      this.#timer = null
      if (this.#inFlight) return
      void this.#save().catch(() => undefined)
    }, this.debounceMs)
  }

  #clearTimer() {
    if (this.#timer === null) return
    clearTimeout(this.#timer)
    this.#timer = null
  }

  #settle() {
    return this.#inFlight?.catch(() => undefined) ?? Promise.resolve()
  }

  #save(): Promise<void> {
    const paths = [...this.#dirtyPaths]
    this.#dirtyPaths.clear()
    this.#publish({ status: 'saving', pendingPaths: [] })

    const run = this.#write(paths)
    this.#inFlight = run
    return run
  }

  async #write(paths: string[]) {
    try {
      // The freshest snapshot is used rather than the one from the change
      // event: writing newer content is always correct, and any path that
      // changed in the meantime is already dirty again.
      await this.repository.saveChangedFiles(this.workspaceId, this.workspace.snapshot(), paths)
      this.#publish({ status: 'saved', lastSavedAt: this.#clock(), error: null })
    } catch (error) {
      for (const path of paths) this.#dirtyPaths.add(path)
      const failure = toPersistenceError(error)
      this.#publish({
        status: 'error',
        pendingPaths: [...this.#dirtyPaths],
        error: failure,
      })
      throw failure
    } finally {
      this.#inFlight = null
    }
  }

  #publish(patch: Partial<AutosaveState>) {
    this.#state = { ...this.#state, ...patch }
    this.#onStateChange?.(this.#state)
  }
}

export function attachWorkspaceAutosave(
  repository: WorkspaceRepository,
  workspaceId: string,
  workspace: VirtualWorkspace,
  options: WorkspaceAutosaveOptions = {},
) {
  const autosave = new WorkspaceAutosave(repository, workspaceId, workspace, options)
  return { autosave, stop: autosave.start() }
}
