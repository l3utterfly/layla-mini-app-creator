import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { VirtualWorkspaceSnapshot } from '../../workspace'
import { Icon } from '../common/Icon'
import { relayLaylaMessageToHost } from '../../lib/layla'
import { PreviewLogsPanel, type PreviewLogEntry } from './PreviewLogsPanel'
import {
  PREVIEW_BRIDGE_CHANNEL,
  createPreviewBridgeError,
  injectPreviewBridge,
  isLaylaHostEventMessage,
  isPreviewBridgeRequest,
  isPreviewConsoleMessage,
} from './previewBridge'
import {
  activatePreviewServiceWorker,
  createPreviewInstanceId,
  detectBrowserPreviewCapability,
  publishPreviewSnapshot,
} from './previewVirtualFs'

type PreviewPaneProps = {
  active: boolean
  refreshToken: number
  revision: number
  snapshot: VirtualWorkspaceSnapshot
  workspace: string
  workspaceId: string
}

const maxPreviewLogs = 500

/** Logical viewport the preview lays out at, so mini-apps see a real phone size. */
const deviceWidth = 390
const deviceHeight = 844

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

export function PreviewPane({
  active,
  refreshToken,
  revision,
  snapshot,
  workspace,
  workspaceId,
}: PreviewPaneProps) {
  const [previewKey, setPreviewKey] = useState(0)
  const [publishedPreview, setPublishedPreview] = useState<{
    url: string
    workspaceId: string
  } | null>(null)
  const [previewDiagnostic, setPreviewDiagnostic] = useState<string | null>(null)
  const [fullPreview, setFullPreview] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logs, setLogs] = useState<PreviewLogEntry[]>([])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const nextLogId = useRef(1)
  const [instanceId] = useState(createPreviewInstanceId)
  const [deviceScale, setDeviceScale] = useState(1)
  const indexHtml = snapshot.files.find(file => file.name === 'index.html')?.content ?? ''

  useEffect(() => {
    let cancelled = false
    const capability = detectBrowserPreviewCapability()

    const fallBackToSrcDoc = (diagnostic: string) => {
      if (cancelled) return
      setPublishedPreview(null)
      setPreviewDiagnostic(diagnostic)
      const log: PreviewLogEntry = {
        channel: PREVIEW_BRIDGE_CHANNEL,
        direction: 'console' as const,
        level: 'warn' as const,
        method: 'preview',
        args: [diagnostic],
        timestamp: Date.now(),
        id: nextLogId.current++,
      }
      setLogs(current => current.some(entry =>
        entry.method === log.method && entry.args[0] === diagnostic,
      ) ? current : [...current.slice(-(maxPreviewLogs - 1)), log])
      echoPreviewLog(log)
    }

    if (!capability.supported) {
      fallBackToSrcDoc(capability.diagnostic)
      return () => {
        cancelled = true
      }
    }

    void Promise.all([
      activatePreviewServiceWorker(capability.serviceWorker),
      publishPreviewSnapshot({
        cacheStorage: capability.cacheStorage,
        instanceId,
        origin: window.location.origin,
        revision,
        snapshot,
        workspaceId,
      }),
    ]).then(([, indexUrl]) => {
      if (cancelled) return
      indexUrl.searchParams.set('refresh', `${refreshToken}-${previewKey}`)
      setPublishedPreview({ url: indexUrl.href, workspaceId })
      setPreviewDiagnostic(null)
    }).catch(error => {
      const reason = error instanceof Error ? error.message : 'Unable to start multi-file preview.'
      fallBackToSrcDoc(`Multi-file preview unavailable: ${reason}`)
    })

    return () => {
      cancelled = true
    }
  }, [instanceId, previewKey, refreshToken, revision, snapshot, workspaceId])

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

  // The mockup screen is far smaller than a phone, so scale the fixed-size viewport down to fit it.
  useLayoutEffect(() => {
    const screen = screenRef.current
    if (!screen) return

    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (!width) return
      setDeviceScale(width / deviceWidth)
    })

    observer.observe(screen)
    return () => observer.disconnect()
  }, [fullPreview])

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
    : previewDiagnostic
      ? 'Index-only preview'
      : warningCount > 0
      ? `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`
      : 'No issues'

  const previewUrl = publishedPreview?.workspaceId === workspaceId
    ? publishedPreview.url
    : null

  const preview = (
    <iframe
      ref={iframeRef}
      key={previewUrl ?? `fallback-${workspaceId}-${revision}-${refreshToken}-${previewKey}`}
      className="preview-iframe"
      {...(previewUrl
        ? { src: previewUrl }
        : { srcDoc: injectPreviewBridge(indexHtml) })}
      title={`${workspace} preview`}
    />
  )

  const deviceStyle = {
    '--device-width': `${deviceWidth}px`,
    '--device-height': `${deviceHeight}px`,
    '--device-scale': deviceScale,
  } as CSSProperties

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
          <span
            className={`preview-ok${errorCount ? ' preview-has-errors' : previewDiagnostic || warningCount ? ' preview-has-warnings' : ''}`}
            title={previewDiagnostic ?? undefined}
          ><i /> {previewStatus}</span>
          {logsButton}
          <button className="icon-button" aria-label="Refresh preview" onClick={refreshPreview}><Icon name="refresh" size={17} /></button>
          <button className="icon-button" aria-label="Open full screen" onClick={() => setFullPreview(true)}><Icon name="expand" size={17} /></button>
        </div>
      </div>
      <div className="device-stage">
        <div className="device-frame">
          <span className="device-button device-button-action" />
          <span className="device-button device-button-volume-up" />
          <span className="device-button device-button-volume-down" />
          <span className="device-button device-button-power" />
          <div className="device-screen" ref={screenRef} style={deviceStyle}>
            <div className="device-viewport">{preview}</div>
            <div className="device-island" />
            <div className="device-home" />
          </div>
        </div>
      </div>
      {logsPanel}
    </section>
  )
}
