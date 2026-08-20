import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../common/Icon'
import { relayLaylaMessageToHost } from '../../lib/layla'
import { PreviewLogsPanel, type PreviewLogEntry } from './PreviewLogsPanel'
import {
  createPreviewBridgeError,
  injectPreviewBridge,
  isLaylaHostEventMessage,
  isPreviewBridgeRequest,
  isPreviewConsoleMessage,
} from './previewBridge'

type PreviewPaneProps = {
  active: boolean
  indexHtml: string
  refreshToken: number
  workspace: string
}

const maxPreviewLogs = 500

function echoPreviewLog(log: PreviewLogEntry) {
  const writer = log.level === 'error'
    ? console.error
    : log.level === 'warn'
      ? console.warn
      : log.level === 'info'
        ? console.info
        : log.level === 'debug'
          ? console.debug
          : console.log
  writer(`[Preview:${log.method}]`, ...log.args)
}

export function PreviewPane({ active, indexHtml, refreshToken, workspace }: PreviewPaneProps) {
  const [previewKey, setPreviewKey] = useState(0)
  const [fullPreview, setFullPreview] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logs, setLogs] = useState<PreviewLogEntry[]>([])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const nextLogId = useRef(1)

  useLayoutEffect(() => {
    const relayMessage = (event: MessageEvent<unknown>) => {
      const previewWindow = iframeRef.current?.contentWindow
      if (!previewWindow) return

      if (event.source === previewWindow) {
        if (isPreviewConsoleMessage(event.data)) {
          const log = { ...event.data, id: nextLogId.current++ }
          setLogs(current => [...current.slice(-(maxPreviewLogs - 1)), log])
          echoPreviewLog(log)
          return
        }

        if (!isPreviewBridgeRequest(event.data)) return

        try {
          relayLaylaMessageToHost(event.data.message)
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : 'Unable to reach the Layla host.'
          previewWindow.postMessage(createPreviewBridgeError(message), '*')
        }
        return
      }

      if (isLaylaHostEventMessage(event.data)) {
        previewWindow.postMessage(event.data, '*')
      }
    }

    window.addEventListener('message', relayMessage)
    return () => window.removeEventListener('message', relayMessage)
  }, [])

  const refreshPreview = () => {
    setLogs([])
    setPreviewKey(value => value + 1)
  }

  const logsButton = (
    <button
      className="icon-button preview-logs-button"
      aria-label={`Show preview logs${logs.length ? ` (${logs.length})` : ''}`}
      aria-expanded={logsOpen}
      onClick={() => setLogsOpen(true)}
    >
      <Icon name="terminal" size={17} />
      {logs.length > 0 && <small>{logs.length > 99 ? '99+' : logs.length}</small>}
    </button>
  )

  const logsPanel = logsOpen
    ? <PreviewLogsPanel logs={logs} onClear={() => setLogs([])} onClose={() => setLogsOpen(false)} />
    : null
  const errorCount = logs.filter(log => log.level === 'error').length
  const warningCount = logs.filter(log => log.level === 'warn').length
  const previewStatus = errorCount > 0
    ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`
    : warningCount > 0
      ? `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`
      : 'No issues'

  const preview = (
    <iframe
      ref={iframeRef}
      key={`${refreshToken}-${previewKey}`}
      className="preview-iframe"
      srcDoc={injectPreviewBridge(indexHtml)}
      title={`${workspace} preview`}
    />
  )

  if (fullPreview) {
    return (
      <section className="preview-pane fullscreen-preview" aria-label="Expanded preview">
        {preview}
        <div className="fullscreen-preview-actions">
          {logsButton}
          <button
            className="icon-button close-fullscreen-preview"
            aria-label="Close full screen"
            onClick={() => setFullPreview(false)}
          >
            <Icon name="x" size={17} />
          </button>
        </div>
        {logsPanel}
      </section>
    )
  }

  return (
    <section className={`preview-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Preview">
      <div className="pane-heading preview-heading">
        <div><span className="eyebrow">Live preview</span><h1>{workspace}</h1></div>
        <div className="preview-actions">
          <span className={`preview-ok${errorCount ? ' preview-has-errors' : warningCount ? ' preview-has-warnings' : ''}`}><i /> {previewStatus}</span>
          {logsButton}
          <button className="icon-button" aria-label="Refresh preview" onClick={refreshPreview}><Icon name="refresh" size={17} /></button>
          <button className="icon-button" aria-label="Open full screen" onClick={() => setFullPreview(true)}><Icon name="expand" size={17} /></button>
        </div>
      </div>
      <div className="device-stage">
        <div className="device-frame">
          <div className="device-speaker" />
          <div className="device-screen">{preview}</div>
          <div className="device-home" />
        </div>
        <p className="viewport-label">390 × 844 · Mobile</p>
      </div>
      {logsPanel}
    </section>
  )
}
