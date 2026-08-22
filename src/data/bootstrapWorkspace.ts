import { loadLaylaSdkSkillFiles } from './initializeWorkspace.ts'
import { scaffoldWorkspaceFiles } from './scaffoldWorkspace.ts'
import { toWorkspaceSummary } from '../persistence/index.ts'
import type { WorkspaceRepository, WorkspaceSummary } from '../persistence/index.ts'
import type { VirtualWorkspace } from '../workspace/index.ts'

export const DEFAULT_WORKSPACE_NAME = 'New workspace'

export type WorkspaceBootstrap = {
  workspaceId: string
  workspaceName: string
  workspace: VirtualWorkspace
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

  return {
    workspaceId: summary.id,
    workspaceName: summary.name,
    workspace: await repository.hydrateWorkspace(summary.id, { derivedFiles }),
  }
}
