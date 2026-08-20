import { useState } from 'react'
import type { WorkspaceFile } from '../../types/ui'
import { Icon } from '../common/Icon'
import { CodeEditor } from './CodeEditor'

type FilesPaneProps = { active: boolean; files: WorkspaceFile[] }

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
          <div className="folder-row"><Icon name="folder" size={17} /><strong>quiet-weather</strong><span>{files.length} files</span></div>
          {files.map(file => (
            <button key={file.name} className={selectedFileName === file.name ? 'active' : ''} onClick={() => setSelectedFileName(file.name)}>
              <span className="file-type" style={{ color: file.color }}>{file.type.slice(0, 2)}</span>
              <span>{file.name}</span><small>{file.size}</small>
            </button>
          ))}
        </div>
        {selectedFile && <CodeEditor file={selectedFile} />}
        <div className="file-tip"><Icon name="sparkles" size={16} /><p><strong>Tip</strong> Ask Layla to edit this file, or make a small change here.</p></div>
      </div>
    </section>
  )
}
