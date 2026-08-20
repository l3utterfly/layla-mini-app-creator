import { useRef, useState } from 'react'
import type { WorkspaceFile } from '../../types/ui'
import { Icon } from '../common/Icon'
import { CodeEditor } from './CodeEditor'

type ImageAssetKind = 'icon' | 'background'

type FilesPaneProps = {
  active: boolean
  files: WorkspaceFile[]
  onImportImage: (kind: ImageAssetKind, file: File) => Promise<string>
  onExport: () => Promise<string>
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function fileAppearance(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'html') return { label: 'HT', color: '#ff7b72' }
  if (extension === 'css') return { label: 'CS', color: '#47a6ff' }
  if (extension === 'js' || extension === 'mjs') return { label: 'JS', color: '#e9d34f' }
  if (extension === 'json') return { label: 'JS', color: '#f5c451' }
  if (['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension ?? '')) {
    return { label: 'IM', color: '#bd9cff' }
  }
  return { label: extension?.slice(0, 2).toUpperCase() || 'TX', color: '#a8a8b0' }
}

export function FilesPane({ active, files, onImportImage, onExport }: FilesPaneProps) {
  const [selectedFileName, setSelectedFileName] = useState('index.html')
  const [importing, setImporting] = useState<ImageAssetKind | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<{ text: string; error: boolean } | null>(null)
  const iconInput = useRef<HTMLInputElement>(null)
  const backgroundInput = useRef<HTMLInputElement>(null)
  const selectedFile = files.find(file => file.name === selectedFileName) ?? files[0]

  const importSelectedImage = async (kind: ImageAssetKind, file?: File) => {
    if (!file) return
    setImporting(kind)
    setImportMessage('')
    try {
      const path = await onImportImage(kind, file)
      setSelectedFileName(path)
      setImportMessage(`${kind === 'icon' ? 'Icon' : 'Background'} imported as ${path}.`)
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Unable to import that image.')
    } finally {
      setImporting(null)
      if (kind === 'icon' && iconInput.current) iconInput.current.value = ''
      if (kind === 'background' && backgroundInput.current) backgroundInput.current.value = ''
    }
  }

  const exportFiles = async () => {
    setExporting(true)
    setExportMessage(null)
    try {
      const fileName = await onExport()
      setExportMessage({ text: `${fileName} is ready to save or share.`, error: false })
    } catch (error) {
      setExportMessage({
        text: error instanceof Error ? error.message : 'Unable to export this workspace.',
        error: true,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className={`files-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Files">
      <div className="pane-heading">
        <div><span className="eyebrow">Project</span><h1>Files</h1></div>
        <button className="export-button" disabled={exporting} aria-busy={exporting} onClick={() => void exportFiles()}>
          <Icon name="download" size={16} /> {exporting ? 'Exporting…' : 'Export'}
        </button>
      </div>
      <div className="file-browser">
        <div className="image-imports" aria-label="Import app images">
          <button type="button" disabled={importing !== null} onClick={() => iconInput.current?.click()}>
            <Icon name="image" size={16} />
            <span><strong>Icon</strong><small>{importing === 'icon' ? 'Importing…' : 'Choose image'}</small></span>
          </button>
          <button type="button" disabled={importing !== null} onClick={() => backgroundInput.current?.click()}>
            <Icon name="image" size={16} />
            <span><strong>Background</strong><small>{importing === 'background' ? 'Importing…' : 'Choose image'}</small></span>
          </button>
          <input ref={iconInput} type="file" accept="image/*,.ico" aria-label="Choose app icon" onChange={event => void importSelectedImage('icon', event.target.files?.[0])} />
          <input ref={backgroundInput} type="file" accept="image/*" aria-label="Choose app background" onChange={event => void importSelectedImage('background', event.target.files?.[0])} />
        </div>
        {importMessage && <p className="image-import-message" role="status">{importMessage}</p>}
        {exportMessage && (
          <p className={`export-message${exportMessage.error ? ' error' : ''}`} role={exportMessage.error ? 'alert' : 'status'}>
            {exportMessage.text}
          </p>
        )}
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
