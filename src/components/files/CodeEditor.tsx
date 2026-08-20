import type { WorkspaceFile } from '../../types/ui'
import { Icon } from '../common/Icon'

type CodeEditorProps = { file: WorkspaceFile }

export function CodeEditor({ file }: CodeEditorProps) {
  return (
    <div className="editor">
      <div className="editor-bar">
        <span><Icon name="code" size={15} />{file.name}</span>
        <button aria-label="Copy file"><Icon name="copy" size={15} /></button>
      </div>
      <pre><code>{file.content.split('\n').map((line, index) => (
        <span className="code-line" key={`${file.name}-${index}`}><i>{index + 1}</i><b>{line || ' '}</b></span>
      ))}</code></pre>
    </div>
  )
}
