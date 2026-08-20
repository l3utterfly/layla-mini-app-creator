import { useState } from 'react'
import { Icon } from '../common/Icon'
import { PreviewScene } from './PreviewScene'

type PreviewPaneProps = {
  active: boolean
  workspace: string
}

export function PreviewPane({ active, workspace }: PreviewPaneProps) {
  const [previewKey, setPreviewKey] = useState(0)
  const [fullPreview, setFullPreview] = useState(false)

  return (
    <section className={`preview-pane pane ${active ? 'mobile-active' : ''} ${fullPreview ? 'fullscreen-preview' : ''}`} aria-label="Preview">
      <div className="pane-heading preview-heading">
        <div><span className="eyebrow">Live preview</span><h1>{workspace}</h1></div>
        <div className="preview-actions">
          <span className="preview-ok"><i /> No issues</span>
          <button className="icon-button" aria-label="Refresh preview" onClick={() => setPreviewKey(value => value + 1)}><Icon name="refresh" size={17} /></button>
          <button className="icon-button" aria-label={fullPreview ? 'Close full screen' : 'Open full screen'} onClick={() => setFullPreview(value => !value)}><Icon name={fullPreview ? 'x' : 'expand'} size={17} /></button>
        </div>
      </div>
      <div className="device-stage">
        <div className="device-frame" key={previewKey}>
          <div className="device-speaker" />
          <div className="device-screen"><PreviewScene /></div>
          <div className="device-home" />
        </div>
        <p className="viewport-label">390 × 844 · Mobile</p>
      </div>
    </section>
  )
}
