import { useState } from 'react'
import { Icon } from '../common/Icon'

type PreviewPaneProps = {
  active: boolean
  indexHtml: string
  workspace: string
}

export function PreviewPane({ active, indexHtml, workspace }: PreviewPaneProps) {
  const [previewKey, setPreviewKey] = useState(0)
  const [fullPreview, setFullPreview] = useState(false)

  const preview = (
    <iframe
      key={previewKey}
      className="preview-iframe"
      srcDoc={indexHtml}
      title={`${workspace} preview`}
    />
  )

  if (fullPreview) {
    return (
      <section className="preview-pane fullscreen-preview" aria-label="Expanded preview">
        {preview}
        <button
          className="icon-button close-fullscreen-preview"
          aria-label="Close full screen"
          onClick={() => setFullPreview(false)}
        >
          <Icon name="x" size={17} />
        </button>
      </section>
    )
  }

  return (
    <section className={`preview-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Preview">
      <div className="pane-heading preview-heading">
        <div><span className="eyebrow">Live preview</span><h1>{workspace}</h1></div>
        <div className="preview-actions">
          <span className="preview-ok"><i /> No issues</span>
          <button className="icon-button" aria-label="Refresh preview" onClick={() => setPreviewKey(value => value + 1)}><Icon name="refresh" size={17} /></button>
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
    </section>
  )
}
