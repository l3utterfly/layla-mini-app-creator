import { useLayoutEffect, useRef } from 'react'
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
  const isWorking = runState === 'thinking'
  const textarea = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return

    element.style.height = 'auto'
    const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight)
    const contentHeight = element.scrollHeight
    element.style.height = `${Math.min(contentHeight, maxHeight)}px`
    element.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  }, [isWorking, value])

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className={`composer-box ${isWorking ? 'working' : ''}`}>
        {isWorking ? (
          <div className="composer-working" role="status" aria-live="polite">
            <i className="spinner" />
            <span>Layla is working</span>
          </div>
        ) : (
          <textarea ref={textarea} value={value} onChange={event => onChange(event.target.value)} placeholder="Ask Layla to build something…" rows={1} aria-label="Message Layla" onKeyDown={submitOnEnter} />
        )}
        <div className="composer-actions">
          {/* Attachment support will be added in a future release.
          <button type="button" className="attach-button" aria-label="Attach context" disabled={isWorking}><Icon name="attach" size={19} /></button>
          */}
          {isWorking ? (
            <button type="button" className="send-button stop-button" aria-label="Stop generation" onClick={onStop}><i className="stop-square" /></button>
          ) : (
            <button type="submit" className="send-button" aria-label="Send message" disabled={!value.trim()}><Icon name="send" size={17} /></button>
          )}
        </div>
      </div>
      <small className="composer-hint">Layla can make mistakes. Review changes in Preview.</small>
    </form>
  )
}
