import type { ConversationMessage } from '../../types/ui'
import { Icon } from '../common/Icon'

type DebugPanelProps = {
  messages: ConversationMessage[]
  onClose: () => void
}

export function DebugPanel({ messages, onClose }: DebugPanelProps) {
  const outputs = messages.filter(message => message.role === 'assistant' && message.rawOutput)

  return (
    <div className="debug-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="debug-panel" role="dialog" aria-modal="true" aria-labelledby="debug-title">
        <header>
          <div><span className="eyebrow">Model transcript</span><h2 id="debug-title">Raw outputs</h2></div>
          <button className="icon-button" aria-label="Close debug outputs" onClick={onClose}><Icon name="x" size={17} /></button>
        </header>
        <div className="debug-output-list">
          {outputs.length === 0 ? (
            <p className="debug-empty">Raw model output will appear here after the first response.</p>
          ) : outputs.map((message, index) => (
            <article key={message.id}>
              <div><strong>Assistant output {index + 1}</strong><span>{message.state}</span></div>
              <pre>{message.rawOutput}</pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
