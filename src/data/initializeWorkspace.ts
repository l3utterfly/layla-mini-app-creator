import { scaffoldWorkspaceFiles } from './scaffoldWorkspace.ts'
import type { VirtualWorkspaceFileInput } from '../workspace/index.ts'

export const laylaSdkSkillAssets = [
  '.agent/layla-sdk/SKILL.md',
  '.agent/layla-sdk/references/sdk-api.md',
  '.agent/layla-sdk/references/mini-apps-overview.md',
] as const

export async function loadLaylaSdkSkillFiles(
  fetcher: typeof fetch = fetch,
): Promise<VirtualWorkspaceFileInput[]> {
  return Promise.all(laylaSdkSkillAssets.map(async name => {
    const response = await fetcher(`/${name}`, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Unable to load required Layla SDK skill file ${name} (HTTP ${response.status}).`)
    }
    return { name, content: await response.text(), mimeType: 'text/markdown' }
  }))
}

export async function loadInitialWorkspaceFiles(fetcher: typeof fetch = fetch) {
  const skillFiles = await loadLaylaSdkSkillFiles(fetcher)
  return [...scaffoldWorkspaceFiles, ...skillFiles]
}
