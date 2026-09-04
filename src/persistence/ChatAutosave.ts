import type { PersistedChats } from './chatDocument.ts'
import type { WorkspaceRepository } from './WorkspaceRepository.ts'

export const DEFAULT_CHAT_AUTOSAVE_DEBOUNCE_MS = 400

export type ChatAutosaveOptions = {
  debounceMs?: number
  onError?: (error: Error | null) => void
}

/** Debounces complete chat-document writes and serializes updates made during a save. */
export class ChatAutosave {
  readonly repository: WorkspaceRepository
  readonly workspaceId: string
  readonly debounceMs: number

  readonly #onError?: (error: Error | null) => void
  #pending: PersistedChats | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #inFlight: Promise<void> | null = null

  constructor(
    repository: WorkspaceRepository,
    workspaceId: string,
    options: ChatAutosaveOptions = {},
  ) {
    this.repository = repository
    this.workspaceId = workspaceId
    this.debounceMs = options.debounceMs ?? DEFAULT_CHAT_AUTOSAVE_DEBOUNCE_MS
    this.#onError = options.onError
  }

  update(chats: PersistedChats) {
    this.#pending = chats
    this.#clearTimer()
    this.#timer = setTimeout(() => {
      this.#timer = null
      if (!this.#inFlight) void this.#save().catch(() => undefined)
    }, this.debounceMs)
  }

  stop() {
    this.#clearTimer()
    if (this.#pending) void this.flush().catch(() => undefined)
  }

  async flush() {
    this.#clearTimer()
    await this.#inFlight?.catch(() => undefined)
    while (this.#pending) await this.#save()
  }

  #save() {
    const chats = this.#pending
    if (!chats) return Promise.resolve()
    this.#pending = null

    let succeeded = false
    const run = this.repository.saveChats(this.workspaceId, chats)
      .then(() => {
        succeeded = true
        this.#onError?.(null)
      })
      .catch((error: unknown) => {
        // A newer complete snapshot already contains the failed one.
        if (!this.#pending) this.#pending = chats
        const failure = error instanceof Error ? error : new Error('Unable to save chats.')
        this.#onError?.(failure)
        throw failure
      })
      .finally(() => {
        this.#inFlight = null
        if (succeeded && this.#pending && this.#timer === null) {
          this.#timer = setTimeout(() => {
            this.#timer = null
            if (!this.#inFlight) void this.#save().catch(() => undefined)
          }, this.debounceMs)
        }
      })

    this.#inFlight = run
    return run
  }

  #clearTimer() {
    if (this.#timer === null) return
    clearTimeout(this.#timer)
    this.#timer = null
  }
}
