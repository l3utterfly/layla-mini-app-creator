import type { FormEvent, KeyboardEvent } from 'react'
import type { RunState } from '../../types/ui'
import { Icon } from '../common/Icon'

type ComposerProps = {
  value: string
  runState: RunState
  onChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onStop: () => void
}

export function Composer({ value, runState, onChange, onSubmit, onStop }: ComposerProps) {
  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      {runState === 'thinking' && (
        <div className="run-strip">
          <span><i className="spinner" /> Layla is working</span>
          <button type="button" onClick={onStop}><i className="stop-square" /> Stop</button>
        </div>
      )}
      <div className="composer-box">
        <textarea value={value} onChange={event => onChange(event.target.value)} placeholder="Ask Layla to build something…" rows={1} aria-label="Message Layla" onKeyDown={submitOnEnter} />
        <div className="composer-actions">
          <button type="button" className="attach-button" aria-label="Attach context"><Icon name="attach" size={19} /></button>
          <div className="context-chip"><span className="context-dot" /> index.html <button type="button" aria-label="Remove context"><Icon name="x" size={12} /></button></div>
          <button type="submit" className="send-button" aria-label="Send message" disabled={!value.trim() || runState === 'thinking'}><Icon name="send" size={17} /></button>
        </div>
      </div>
      <small className="composer-hint">Layla can make mistakes. Review changes in Preview.</small>
    </form>
  )
}
