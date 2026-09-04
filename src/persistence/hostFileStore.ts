import { base64ToUtf8, stripDataUriPrefix, utf8ToBase64 } from './codec.ts'
import { WorkspacePersistenceError } from './errors.ts'

/**
 * The persistence port.
 *
 * Everything above this interface works in plain text and relative host paths.
 * Everything below it knows about base64, data URI prefixes, and the Layla
 * bridge. Swapping the host for tests, or for a different backing store later,
 * means providing another implementation of this type and nothing else.
 */
export type HostFileStore = {
  /** Resolves to the file's decoded text, or `null` when it does not exist. */
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  /** Removes one file or a directory tree relative to the private app directory. */
  remove(path: string): Promise<void>
}

/** The slice of `layla.utils` this module depends on. */
export type LaylaFileApi = {
  saveFile(
    filename: string,
    contentBase64: string,
    share?: boolean,
  ): Promise<{ filename: string; success: boolean; message?: string }>
  readFile(
    filename: string,
  ): Promise<{ filename: string; content_base64: string | null; message?: string }>
  deleteFileOrDir(path: string): Promise<unknown>
}

function describeCause(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The bridge is missing whenever the mini-app runs outside Layla without the
 * SDK mock installed. Matching on `name` keeps this port free of a value
 * import from the SDK.
 */
function isBridgeUnavailable(error: unknown) {
  return error instanceof Error && error.name === 'LaylaBridgeUnavailableError'
}

function hostError(
  code: 'READ_FAILED' | 'WRITE_FAILED' | 'DELETE_FAILED',
  filename: string,
  error: unknown,
): WorkspacePersistenceError {
  if (isBridgeUnavailable(error)) {
    return new WorkspacePersistenceError(
      'HOST_UNAVAILABLE',
      'Layla is not available, so workspaces cannot be saved or loaded.',
      { filename },
    )
  }
  return new WorkspacePersistenceError(
    code,
    code === 'READ_FAILED'
      ? `Layla was unable to read ${filename}.`
      : code === 'WRITE_FAILED'
        ? `Layla was unable to save ${filename}.`
        : `Layla was unable to delete ${filename}.`,
    { filename, cause: describeCause(error) },
  )
}

/**
 * Backs persistence with the mini-app's private host directory.
 *
 * Writes always pass `share: false`; `share: true` opens the system share
 * sheet and does not produce a file `readFile` can see. Export keeps using
 * `share: true` and is unrelated to this store.
 */
export function createLaylaHostFileStore(files: LaylaFileApi): HostFileStore {
  return {
    async read(filename) {
      let response
      try {
        response = await files.readFile(filename)
      } catch (error) {
        throw hostError('READ_FAILED', filename, error)
      }

      // A missing file is a normal outcome, not a failure: the host reports it
      // as a null payload alongside an explanatory message.
      if (response.content_base64 === null) return null

      try {
        return base64ToUtf8(stripDataUriPrefix(response.content_base64))
      } catch (error) {
        throw new WorkspacePersistenceError(
          'READ_FAILED',
          `${filename} is not valid base64 content.`,
          { filename, cause: describeCause(error) },
        )
      }
    },

    async write(filename, content) {
      let response
      try {
        response = await files.saveFile(filename, utf8ToBase64(content), false)
      } catch (error) {
        throw hostError('WRITE_FAILED', filename, error)
      }

      if (!response.success) {
        throw new WorkspacePersistenceError(
          'WRITE_FAILED',
          response.message ?? `Layla was unable to save ${filename}.`,
          { filename },
        )
      }
    },

    async remove(path) {
      try {
        await files.deleteFileOrDir(path)
      } catch (error) {
        throw hostError('DELETE_FAILED', path, error)
      }
    },
  }
}

/**
 * An in-memory store with the same contract, for tests and for browser
 * development without the bridge.
 */
export function createMemoryHostFileStore(seed: Record<string, string> = {}): HostFileStore {
  const contents = new Map(Object.entries(seed))
  return {
    async read(filename) {
      return contents.get(filename) ?? null
    },
    async write(filename, content) {
      contents.set(filename, content)
    },
    async remove(path) {
      const prefix = `${path.replace(/\/$/, '')}/`
      for (const filename of contents.keys()) {
        if (filename === path || filename.startsWith(prefix)) contents.delete(filename)
      }
    },
  }
}

export async function readJsonFile<TValue>(store: HostFileStore, filename: string) {
  const raw = await store.read(filename)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as TValue
  } catch (error) {
    throw new WorkspacePersistenceError(
      'INDEX_CORRUPT',
      `${filename} does not contain valid JSON.`,
      { filename, cause: describeCause(error) },
    )
  }
}

export function writeJsonFile(store: HostFileStore, filename: string, value: unknown) {
  return store.write(filename, `${JSON.stringify(value, null, 2)}\n`)
}
