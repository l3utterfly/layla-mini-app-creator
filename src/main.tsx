import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { bootstrapWorkspace } from './data/bootstrapWorkspace.ts'
import { layla } from './lib/layla.ts'
import { createLaylaHostFileStore, createWorkspaceRepository } from './persistence/index.ts'

const root = createRoot(document.getElementById('root')!)
const repository = createWorkspaceRepository(createLaylaHostFileStore(layla.utils))

void bootstrapWorkspace(repository)
  .then(({ workspace, workspaceId, workspaceName }) => {
    root.render(
      <StrictMode>
        <App
          repository={repository}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          virtualWorkspace={workspace}
        />
      </StrictMode>,
    )
  })
  .catch(error => {
    const message = error instanceof Error ? error.message : 'Unable to initialize the workspace.'
    root.render(<main role="alert">{message}</main>)
  })
