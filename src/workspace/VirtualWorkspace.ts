import { applyWorkspacePatch, ApplyPatchError } from '../tools/applyPatch.ts'

export type VirtualWorkspaceFileInput = {
  name: string
  content: string
  mimeType?: string
}

export type VirtualWorkspaceFile = {
  name: string
  content: string
  mimeType: string
  size: number
  revision: string
  updatedAt: number
}

export type VirtualWorkspaceSnapshot = {
  files: VirtualWorkspaceFile[]
  revision: number
}

export type FileReadOptions = {
  startLine?: number
  endLine?: number
}

export type FileWriteOptions = {
  expectedRevision?: string
}

export type FileSearchOptions = {
  path?: string
  isRegex?: boolean
  limit?: number
}

export type FileSearchMatch = {
  path: string
  line: number
  text: string
}

export type ExactTextReplacement = {
  oldText: string
  newText: string
}

export type WorkspaceChange = {
  revision: number
  changedPaths: string[]
}

export type WorkspaceListener = (
  snapshot: VirtualWorkspaceSnapshot,
  change: WorkspaceChange,
) => void

export type VirtualWorkspaceOptions = {
  revision?: number
  clock?: () => number
}

export class VirtualWorkspaceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'VirtualWorkspaceError'
    this.code = code
  }
}

const mimeTypes: Record<string, string> = {
  css: 'text/css',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  mjs: 'text/javascript',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
}

function cloneFile(file: VirtualWorkspaceFile): VirtualWorkspaceFile {
  return { ...file }
}

function hashContent(content: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function revisionFor(workspaceRevision: number, content: string) {
  return `${workspaceRevision}-${hashContent(content)}`
}

function detectMimeType(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return mimeTypes[extension] ?? 'text/plain'
}

function byteLength(content: string) {
  return new TextEncoder().encode(content).byteLength
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function changedPathsBetween(before: VirtualWorkspaceSnapshot, after: VirtualWorkspaceSnapshot) {
  const previous = new Map(before.files.map(file => [file.name, file.revision]))
  const current = new Map(after.files.map(file => [file.name, file.revision]))
  return [...new Set([
    ...before.files.filter(file => current.get(file.name) !== file.revision).map(file => file.name),
    ...after.files.filter(file => previous.get(file.name) !== file.revision).map(file => file.name),
  ])].sort()
}

export function normalizeWorkspacePath(input: string) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new VirtualWorkspaceError('INVALID_PATH', 'A non-empty workspace-relative path is required.')
  }

  const candidate = input.trim().replaceAll('\\', '/')
  if (
    candidate.includes('\0')
    || candidate.startsWith('/')
    || /^[a-zA-Z]:\//.test(candidate)
  ) {
    throw new VirtualWorkspaceError('INVALID_PATH', 'Paths must stay inside the active workspace.')
  }

  const segments = candidate.split('/').filter(segment => segment && segment !== '.')
  if (!segments.length || segments.includes('..')) {
    throw new VirtualWorkspaceError('INVALID_PATH', 'Paths must stay inside the active workspace.')
  }
  return segments.join('/')
}

function normalizeDirectoryPath(input?: string) {
  if (input === undefined || !input.trim() || input.trim() === '.') return ''
  return normalizeWorkspacePath(input).replace(/\/$/, '')
}

/**
 * An isolated, in-memory filesystem for a single agent workspace.
 *
 * Every returned file and snapshot is a copy. Callers can therefore treat this
 * like an external filesystem without being able to mutate its backing store.
 */
export class VirtualWorkspace {
  readonly #clock: () => number
  readonly #files = new Map<string, VirtualWorkspaceFile>()
  readonly #listeners = new Set<WorkspaceListener>()
  #revision: number

  constructor(initialFiles: Iterable<VirtualWorkspaceFileInput> = [], options: VirtualWorkspaceOptions = {}) {
    this.#clock = options.clock ?? Date.now
    this.#revision = options.revision ?? 1

    for (const input of initialFiles) {
      const path = normalizeWorkspacePath(input.name)
      if (this.#files.has(path)) {
        throw new VirtualWorkspaceError('FILE_EXISTS', `${path} appears more than once in the initial workspace.`)
      }
      this.#files.set(path, this.#makeFile(path, input.content, input.mimeType, this.#revision))
    }
  }

  static fromSnapshot(snapshot: VirtualWorkspaceSnapshot, options: Pick<VirtualWorkspaceOptions, 'clock'> = {}) {
    const workspace = new VirtualWorkspace([], { revision: snapshot.revision, ...options })
    for (const file of snapshot.files) {
      const path = normalizeWorkspacePath(file.name)
      workspace.#files.set(path, cloneFile({ ...file, name: path }))
    }
    return workspace
  }

  get revision() {
    return this.#revision
  }

  snapshot(): VirtualWorkspaceSnapshot {
    return {
      files: [...this.#files.values()].sort((left, right) => left.name.localeCompare(right.name)).map(cloneFile),
      revision: this.#revision,
    }
  }

  subscribe(listener: WorkspaceListener) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  hasFile(path: string) {
    return this.#files.has(normalizeWorkspacePath(path))
  }

  listFiles(path?: string) {
    const directory = normalizeDirectoryPath(path)
    const prefix = directory ? `${directory}/` : ''
    return [...this.#files.values()]
      .filter(file => !prefix || file.name.startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(cloneFile)
  }

  readFile(path: string, options: FileReadOptions = {}) {
    const normalizedPath = normalizeWorkspacePath(path)
    const file = this.#requireFile(normalizedPath)
    const lines = file.content.split('\n')
    const startLine = options.startLine === undefined ? 1 : Math.max(1, Math.floor(options.startLine))
    const endLine = options.endLine === undefined
      ? lines.length
      : Math.max(startLine, Math.floor(options.endLine))
    return {
      path: normalizedPath,
      revision: file.revision,
      content: lines.slice(startLine - 1, endLine).join('\n'),
      mimeType: file.mimeType,
      size: file.size,
      updatedAt: file.updatedAt,
    }
  }

  searchFiles(query: string, options: FileSearchOptions = {}) {
    let matcher: RegExp
    try {
      matcher = options.isRegex === false
        ? new RegExp(escapeRegularExpression(query))
        : new RegExp(query)
    } catch (error) {
      throw new VirtualWorkspaceError(
        'INVALID_PATTERN',
        error instanceof Error ? error.message : 'Invalid search pattern.',
      )
    }

    const limit = Math.max(0, Math.floor(options.limit ?? 100))
    const matches: FileSearchMatch[] = []
    if (limit === 0) return matches
    const scopedPath = normalizeDirectoryPath(options.path)
    const exactFile = scopedPath ? this.#files.get(scopedPath) : undefined
    const files = exactFile ? [cloneFile(exactFile)] : this.listFiles(scopedPath)
    for (const file of files) {
      for (const [index, text] of file.content.split('\n').entries()) {
        if (matcher.test(text)) matches.push({ path: file.name, line: index + 1, text })
        if (matches.length >= limit) return matches
      }
    }
    return matches
  }

  writeFile(path: string, content: string, options: FileWriteOptions = {}) {
    const normalizedPath = normalizeWorkspacePath(path)
    const existing = this.#files.get(normalizedPath)
    if (existing && options.expectedRevision !== undefined) {
      this.#requireRevision(existing, options.expectedRevision)
    }

    const nextRevision = this.#revision + 1
    this.#files.set(normalizedPath, this.#makeFile(normalizedPath, content, undefined, nextRevision))
    this.#commit(nextRevision, [normalizedPath])
    return cloneFile(this.#files.get(normalizedPath)!)
  }

  editFile(path: string, expectedRevision: string, replacements: ExactTextReplacement[]) {
    const normalizedPath = normalizeWorkspacePath(path)
    const existing = this.#requireFile(normalizedPath)
    this.#requireRevision(existing, expectedRevision)

    let content = existing.content
    for (const replacement of replacements) {
      if (!content.includes(replacement.oldText)) {
        throw new VirtualWorkspaceError(
          'TEXT_NOT_FOUND',
          `An exact replacement target was not found in ${normalizedPath}.`,
        )
      }
      content = content.replace(replacement.oldText, replacement.newText)
    }

    const nextRevision = this.#revision + 1
    this.#files.set(
      normalizedPath,
      this.#makeFile(normalizedPath, content, existing.mimeType, nextRevision),
    )
    this.#commit(nextRevision, [normalizedPath])
    return cloneFile(this.#files.get(normalizedPath)!)
  }

  deleteFile(path: string, expectedRevision?: string) {
    const normalizedPath = normalizeWorkspacePath(path)
    const existing = this.#requireFile(normalizedPath)
    if (expectedRevision !== undefined) this.#requireRevision(existing, expectedRevision)
    this.#files.delete(normalizedPath)
    this.#commit(this.#revision + 1, [normalizedPath])
    return cloneFile(existing)
  }

  applyPatch(patch: string) {
    const nextRevision = this.#revision + 1
    let applied
    try {
      applied = applyWorkspacePatch(
        [...this.#files.values()],
        patch,
        normalizeWorkspacePath,
        (path, content) => this.#makeFile(path, content, undefined, nextRevision),
      )
    } catch (error) {
      if (error instanceof ApplyPatchError) {
        throw new VirtualWorkspaceError(error.code, error.message)
      }
      throw error
    }

    this.#files.clear()
    for (const file of applied.files) this.#files.set(file.name, cloneFile(file))
    this.#commit(nextRevision, applied.changedPaths)
    return { changedPaths: [...applied.changedPaths] }
  }

  async transaction<TResult>(operation: (workspace: VirtualWorkspace) => TResult | Promise<TResult>) {
    const before = this.snapshot()
    const draft = VirtualWorkspace.fromSnapshot(before, { clock: this.#clock })
    const result = await operation(draft)
    if (this.#revision !== before.revision) {
      throw new VirtualWorkspaceError(
        'TRANSACTION_CONFLICT',
        'The workspace changed while a transaction was running. Retry against the latest revision.',
      )
    }
    const after = draft.snapshot()
    if (after.revision !== before.revision) {
      this.#replaceWith(after)
      this.#emit(changedPathsBetween(before, after))
    }
    return result
  }

  #makeFile(path: string, content: string, mimeType: string | undefined, revision: number) {
    return {
      name: path,
      content,
      mimeType: mimeType ?? detectMimeType(path),
      size: byteLength(content),
      revision: revisionFor(revision, content),
      updatedAt: this.#clock(),
    }
  }

  #requireFile(path: string) {
    const file = this.#files.get(path)
    if (!file) throw new VirtualWorkspaceError('FILE_NOT_FOUND', `${path} does not exist.`)
    return file
  }

  #requireRevision(file: VirtualWorkspaceFile, expectedRevision: string) {
    if (expectedRevision !== file.revision) {
      throw new VirtualWorkspaceError(
        'REVISION_CONFLICT',
        `${file.name} changed after revision ${String(expectedRevision)}; read it again (current revision ${file.revision}).`,
      )
    }
  }

  #commit(revision: number, changedPaths: string[]) {
    this.#revision = revision
    this.#emit(changedPaths)
  }

  #replaceWith(snapshot: VirtualWorkspaceSnapshot) {
    this.#files.clear()
    for (const file of snapshot.files) this.#files.set(file.name, cloneFile(file))
    this.#revision = snapshot.revision
  }

  #emit(changedPaths: string[]) {
    if (!this.#listeners.size) return
    const snapshot = this.snapshot()
    const change = { revision: this.#revision, changedPaths: [...changedPaths] }
    for (const listener of this.#listeners) listener(snapshot, change)
  }
}

export function createVirtualWorkspace(
  initialFiles: Iterable<VirtualWorkspaceFileInput> = [],
  options: VirtualWorkspaceOptions = {},
) {
  return new VirtualWorkspace(initialFiles, options)
}
