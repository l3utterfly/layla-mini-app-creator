import { loadLaylaSdkSkillFiles } from './initializeWorkspace.ts'
import { scaffoldWorkspaceFiles } from './scaffoldWorkspace.ts'
import { toWorkspaceSummary } from '../persistence/index.ts'
import type { PersistedChats, WorkspaceRepository, WorkspaceSummary } from '../persistence/index.ts'
import type { VirtualWorkspace, VirtualWorkspaceFileInput } from '../workspace/index.ts'

export const DEFAULT_WORKSPACE_NAME = 'New workspace'

export type WorkspaceBootstrap = {
  workspaceId: string
  workspaceName: string
  workspace: VirtualWorkspace
  /**
   * The `.agent` skill files this build ships. They are kept so switching
   * workspaces can re-seed them without fetching the assets again.
   */
  derivedFiles: VirtualWorkspaceFileInput[]
  chats: PersistedChats
}

/**
 * Picks a name for a new workspace that does not collide with an existing one:
 * `New workspace`, then `New workspace 2`, `New workspace 3`, and so on.
 */
export function nextWorkspaceName(existingNames: string[]) {
  const taken = new Set(existingNames.map(name => name.trim()))
  if (!taken.has(DEFAULT_WORKSPACE_NAME)) return DEFAULT_WORKSPACE_NAME

  let suffix = 2
  while (taken.has(`${DEFAULT_WORKSPACE_NAME} ${suffix}`)) suffix += 1
  return `${DEFAULT_WORKSPACE_NAME} ${suffix}`
}

/**
 * Restores the workspace the user was last in, or scaffolds the first one.
 *
 * The `.agent/layla-sdk` skill is fetched from bundled assets and handed to
 * hydration as derived files: it is never persisted, so every launch gets the
 * skill version shipped with the running build.
 */
export async function bootstrapWorkspace(
  repository: WorkspaceRepository,
  fetcher: typeof fetch = fetch,
): Promise<WorkspaceBootstrap> {
  const [derivedFiles, index] = await Promise.all([
    loadLaylaSdkSkillFiles(fetcher),
    repository.loadIndex(),
  ])

  const existing = index.workspaces.find(entry => entry.id === index.activeWorkspaceId)
    ?? index.workspaces[0]

  let summary: WorkspaceSummary
  if (existing) {
    summary = toWorkspaceSummary(existing)
    // The index can name no active workspace after a recovery from backup.
    if (index.activeWorkspaceId !== summary.id) await repository.setActiveWorkspace(summary.id)
  } else {
    summary = await repository.createWorkspace({
      name: DEFAULT_WORKSPACE_NAME,
      files: scaffoldWorkspaceFiles,
    })
  }

  const [workspace, chats] = await Promise.all([
    repository.hydrateWorkspace(summary.id, { derivedFiles }),
    repository.loadChats(summary.id),
  ])

  return {
    workspaceId: summary.id,
    workspaceName: summary.name,
    workspace,
    derivedFiles,
    chats,
  }
}
