import { useState } from 'react'
import type { WorkspaceFile } from '../../types/ui'
import { Icon } from '../common/Icon'
import { CodeEditor } from './CodeEditor'

type FilesPaneProps = { active: boolean; files: WorkspaceFile[] }

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function fileAppearance(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'html') return { label: 'HT', color: '#ff7b72' }
  if (extension === 'css') return { label: 'CS', color: '#47a6ff' }
  if (extension === 'js' || extension === 'mjs') return { label: 'JS', color: '#e9d34f' }
  if (extension === 'json') return { label: 'JS', color: '#f5c451' }
  return { label: extension?.slice(0, 2).toUpperCase() || 'TX', color: '#a8a8b0' }
}

export function FilesPane({ active, files }: FilesPaneProps) {
  const [selectedFileName, setSelectedFileName] = useState('index.html')
  const selectedFile = files.find(file => file.name === selectedFileName) ?? files[0]

  return (
    <section className={`files-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Files">
      <div className="pane-heading">
        <div><span className="eyebrow">Project</span><h1>Files</h1></div>
        <button className="export-button"><Icon name="download" size={16} /> Export</button>
      </div>
      <div className="file-browser">
        <div className="files-list">
          <div className="folder-row"><Icon name="folder" size={17} /><strong>My Workspace</strong><span>{files.length} files</span></div>
          {files.map(file => {
            const appearance = fileAppearance(file.name)
            return (
              <button key={file.name} className={selectedFileName === file.name ? 'active' : ''} onClick={() => setSelectedFileName(file.name)}>
                <span className="file-type" style={{ color: appearance.color }}>{appearance.label}</span>
                <span>{file.name}</span><small>{formatSize(file.size)}</small>
              </button>
            )
          })}
        </div>
        {selectedFile && <CodeEditor file={selectedFile} />}
        <div className="file-tip"><Icon name="sparkles" size={16} /><p><strong>Tip</strong> Ask Layla to edit this file, or make a small change here.</p></div>
      </div>
    </section>
  )
}
