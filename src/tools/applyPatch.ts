import type { WorkspaceFile } from '../types/ui'

type PatchHunk = {
  header: string
  lines: string[]
}

type PatchOperation =
  | { type: 'add'; path: string; lines: string[] }
  | { type: 'update'; path: string; hunks: PatchHunk[] }
  | { type: 'delete'; path: string }

export class ApplyPatchError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const operationPattern = /^\*\*\* (Add|Update|Delete) File: (.+)$/

function parseUpdateHunks(path: string, lines: string[]): PatchHunk[] {
  const hunks: PatchHunk[] = []
  let index = 0

  while (index < lines.length) {
    const header = lines[index]
    if (!header?.startsWith('@@')) {
      throw new ApplyPatchError('INVALID_PATCH', `Expected a @@ hunk header while updating ${path}.`)
    }
    index += 1

    const hunkLines: string[] = []
    while (index < lines.length && !lines[index]?.startsWith('@@')) {
      const line = lines[index] ?? ''
      if (line === '\\ No newline at end of file') {
        index += 1
        continue
      }
      if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-')) {
        throw new ApplyPatchError(
          'INVALID_PATCH',
          `Every hunk line for ${path} must begin with a space, +, or -.`,
        )
      }
      hunkLines.push(line)
      index += 1
    }

    if (!hunkLines.some(line => line.startsWith('+') || line.startsWith('-'))) {
      throw new ApplyPatchError('INVALID_PATCH', `A patch hunk for ${path} contains no changes.`)
    }
    hunks.push({ header, lines: hunkLines })
  }

  if (!hunks.length) throw new ApplyPatchError('INVALID_PATCH', `No hunks were provided for ${path}.`)
  return hunks
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replaceAll('\r\n', '\n').split('\n')
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') {
    throw new ApplyPatchError('INVALID_PATCH', 'Patch must begin with *** Begin Patch and end with *** End Patch.')
  }

  const operations: PatchOperation[] = []
  let index = 1

  while (index < lines.length - 1) {
    const match = operationPattern.exec(lines[index] ?? '')
    if (!match?.[1] || !match[2]?.trim()) {
      throw new ApplyPatchError('INVALID_PATCH', `Expected a file operation at patch line ${index + 1}.`)
    }

    const type = match[1].toLowerCase() as 'add' | 'update' | 'delete'
    const path = match[2].trim()
    index += 1

    const body: string[] = []
    while (index < lines.length - 1 && !operationPattern.test(lines[index] ?? '')) {
      body.push(lines[index] ?? '')
      index += 1
    }

    if (type === 'add') {
      if (body.some(line => !line.startsWith('+'))) {
        throw new ApplyPatchError('INVALID_PATCH', `Every line added to ${path} must begin with +.`)
      }
      operations.push({ type, path, lines: body.map(line => line.slice(1)) })
      continue
    }

    if (type === 'delete') {
      if (body.length) throw new ApplyPatchError('INVALID_PATCH', `Delete File for ${path} cannot contain hunks.`)
      operations.push({ type, path })
      continue
    }

    operations.push({ type, path, hunks: parseUpdateHunks(path, body) })
  }

  if (!operations.length) throw new ApplyPatchError('INVALID_PATCH', 'Patch contains no file operations.')
  return operations
}

function hunkStartHint(header: string) {
  const match = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(header)
  return match?.[1] ? Math.max(0, Number(match[1]) - 1) : undefined
}

function linesMatch(source: string[], start: number, expected: string[]) {
  return expected.every((line, offset) => source[start + offset] === line)
}

function findHunkStart(source: string[], expected: string[], from: number, header: string, path: string) {
  if (!expected.length) {
    const hint = hunkStartHint(header)
    if (hint === undefined) {
      throw new ApplyPatchError('INVALID_PATCH', `An insertion-only hunk for ${path} needs a standard line-number header.`)
    }
    return Math.min(source.length, hint)
  }

  const hint = hunkStartHint(header)
  if (hint !== undefined && hint >= from && linesMatch(source, hint, expected)) return hint

  const matches: number[] = []
  for (let index = from; index <= source.length - expected.length; index += 1) {
    if (linesMatch(source, index, expected)) matches.push(index)
  }

  if (!matches.length) {
    throw new ApplyPatchError('PATCH_CONTEXT_NOT_FOUND', `Patch context was not found in ${path}. Read the file and try again.`)
  }
  if (matches.length > 1) {
    throw new ApplyPatchError('PATCH_CONTEXT_AMBIGUOUS', `Patch context occurs more than once in ${path}. Include more unchanged lines.`)
  }
  return matches[0]!
}

function applyUpdate(path: string, content: string, hunks: PatchHunk[]) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const source = content.replaceAll('\r\n', '\n').split('\n')
  let cursor = 0
  let lineOffset = 0

  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter(line => !line.startsWith('+')).map(line => line.slice(1))
    const newLines = hunk.lines.filter(line => !line.startsWith('-')).map(line => line.slice(1))
    const hintedHeader = hunk.header.replace(
      /^@@ -(\d+)/,
      (_match, start: string) => `@@ -${Number(start) + lineOffset}`,
    )
    const start = findHunkStart(source, oldLines, cursor, hintedHeader, path)
    source.splice(start, oldLines.length, ...newLines)
    cursor = start + newLines.length
    lineOffset += newLines.length - oldLines.length
  }

  return source.join(newline)
}

export type AppliedWorkspacePatch = {
  files: WorkspaceFile[]
  changedPaths: string[]
}

export function applyWorkspacePatch(
  files: WorkspaceFile[],
  patch: string,
  normalizePath: (path: string) => string,
  createFile: (path: string, content: string) => WorkspaceFile,
): AppliedWorkspacePatch {
  const operations = parsePatch(patch)
  const staged = new Map(files.map(file => [file.name, file]))
  const changedPaths: string[] = []

  for (const operation of operations) {
    const path = normalizePath(operation.path)
    const existing = staged.get(path)

    if (operation.type === 'add') {
      if (existing) throw new ApplyPatchError('FILE_EXISTS', `${path} already exists.`)
      const content = operation.lines.join('\n')
      staged.set(path, createFile(path, content))
    } else if (operation.type === 'delete') {
      if (!existing) throw new ApplyPatchError('FILE_NOT_FOUND', `${path} does not exist.`)
      staged.delete(path)
    } else {
      if (!existing) throw new ApplyPatchError('FILE_NOT_FOUND', `${path} does not exist.`)
      staged.set(path, createFile(path, applyUpdate(path, existing.content, operation.hunks)))
    }

    if (!changedPaths.includes(path)) changedPaths.push(path)
  }

  return {
    files: [
      ...files.flatMap(file => staged.has(file.name) ? [staged.get(file.name)!] : []),
      ...[...staged.values()].filter(file => !files.some(original => original.name === file.name)),
    ],
    changedPaths,
  }
}
