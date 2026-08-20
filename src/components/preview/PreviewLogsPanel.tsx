import type { PreviewConsoleMessage } from './previewBridge'
import { Icon } from '../common/Icon'

export type PreviewLogEntry = PreviewConsoleMessage & {
  id: number
}

type PreviewLogsPanelProps = {
  logs: PreviewLogEntry[]
  onClear: () => void
  onClose: () => void
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(timestamp)
}

export function PreviewLogsPanel({ logs, onClear, onClose }: PreviewLogsPanelProps) {
  return (
    <div className="preview-logs-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="preview-logs-panel" role="dialog" aria-modal="true" aria-labelledby="preview-logs-title">
        <header>
          <div><span className="eyebrow">Iframe console</span><h2 id="preview-logs-title">Preview logs</h2></div>
          <div className="preview-log-header-actions">
            <button className="preview-log-clear" onClick={onClear} disabled={logs.length === 0}>Clear</button>
            <button className="icon-button" aria-label="Close preview logs" onClick={onClose}><Icon name="x" size={17} /></button>
          </div>
        </header>
        <div className="preview-log-list">
          {logs.length === 0 ? (
            <p className="debug-empty">Console output from the preview will appear here.</p>
          ) : logs.map(log => (
            <article className={`preview-log-entry level-${log.level}`} key={log.id}>
              <div className="preview-log-meta">
                <span>{log.method}</span>
                <time dateTime={new Date(log.timestamp).toISOString()}>{formatTime(log.timestamp)}</time>
              </div>
              <pre>{log.args.join(' ')}</pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
