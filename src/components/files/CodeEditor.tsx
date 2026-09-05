import type { WorkspaceFile } from '../../types/ui'
import { isStoredBinaryFile } from '../../workspace/exportWorkspace'
import { Icon } from '../common/Icon'

type CodeEditorProps = { file: WorkspaceFile }

export function CodeEditor({ file }: CodeEditorProps) {
  const isImage = file.mimeType.startsWith('image/')
  const isBinary = !isImage && isStoredBinaryFile(file)

  return (
    <div className="editor">
      <div className="editor-bar">
        <span><Icon name="code" size={15} />{file.name}</span>
        <button aria-label="Copy file"><Icon name="copy" size={15} /></button>
      </div>
      {isImage ? (
        <div className="image-preview"><img src={file.content} alt={`Preview of ${file.name}`} /></div>
      ) : isBinary ? (
        <div className="binary-preview"><Icon name="file" size={28} /><strong>Binary file</strong><span>Preview unavailable</span></div>
      ) : (
        <pre><code>{file.content.split('\n').map((line, index) => (
          <span className="code-line" key={`${file.name}-${index}`}><i>{index + 1}</i><b>{line || ' '}</b></span>
        ))}</code></pre>
      )}
    </div>
  )
}
