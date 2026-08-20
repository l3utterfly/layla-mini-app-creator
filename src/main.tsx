import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadInitialWorkspaceFiles } from './data/initializeWorkspace.ts'

const root = createRoot(document.getElementById('root')!)

void loadInitialWorkspaceFiles()
  .then(initialWorkspaceFiles => {
    root.render(
      <StrictMode>
        <App initialWorkspaceFiles={initialWorkspaceFiles} />
      </StrictMode>,
    )
  })
  .catch(error => {
    const message = error instanceof Error ? error.message : 'Unable to initialize the workspace.'
    root.render(<main role="alert">{message}</main>)
  })
