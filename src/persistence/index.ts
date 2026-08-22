export { WorkspacePersistenceError, notImplemented } from './errors.ts'
export {
  BLOB_FILE_EXTENSION,
  DERIVED_PATH_PREFIXES,
  INDEX_BACKUP_FILE_NAME,
  INDEX_FILE_NAME,
  blobFileName,
  createBlobId,
  createWorkspaceId,
  isBlobFileNameFor,
  isPersistedPath,
  persistedWorkspaceFiles,
  randomId,
} from './layout.ts'
export { base64ToUtf8, stripDataUriPrefix, utf8ToBase64 } from './codec.ts'
export {
  createLaylaHostFileStore,
  createMemoryHostFileStore,
  readJsonFile,
  writeJsonFile,
} from './hostFileStore.ts'
export { WorkspaceRepository, createWorkspaceRepository } from './WorkspaceRepository.ts'
export {
  DEFAULT_ENTRY_PATH,
  createEmptyIndex,
  normalizeIndex,
  toWorkspaceSummary,
} from './indexDocument.ts'
export {
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  WorkspaceAutosave,
  attachWorkspaceAutosave,
} from './WorkspaceAutosave.ts'
export { PERSISTENCE_SCHEMA_VERSION } from './types.ts'

export type { WorkspacePersistenceErrorCode } from './errors.ts'
export type { HostFileStore, LaylaFileApi } from './hostFileStore.ts'
export type {
  CreateWorkspaceOptions,
  HydrateWorkspaceOptions,
  WorkspaceRepositoryOptions,
} from './WorkspaceRepository.ts'
export type { WorkspaceAutosaveOptions } from './WorkspaceAutosave.ts'
export type {
  AutosaveState,
  AutosaveStatus,
  PersistedFileEntry,
  PersistedIndex,
  PersistedWorkspaceEntry,
  WorkspaceSummary,
} from './types.ts'
