export type WorkspacePersistenceErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'HOST_UNAVAILABLE'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'DELETE_FAILED'
  | 'INDEX_CORRUPT'
  | 'INDEX_VERSION_UNSUPPORTED'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_EXISTS'
  | 'INVALID_NAME'
  | 'BLOB_MISSING'

export class WorkspacePersistenceError extends Error {
  code: WorkspacePersistenceErrorCode
  context?: Record<string, unknown>

  constructor(
    code: WorkspacePersistenceErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WorkspacePersistenceError'
    this.code = code
    this.context = context
  }
}

/**
 * Marks an orchestration seam that the persistence architecture defines but
 * does not implement yet. Every call site is a place where host reads/writes
 * will land.
 */
export function notImplemented(operation: string, context?: Record<string, unknown>) {
  return new WorkspacePersistenceError(
    'NOT_IMPLEMENTED',
    `${operation} is not implemented yet.`,
    context,
  )
}
