import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { demoToolRun } from '../../data/mockToolRun'
import type { RunState } from '../../types/ui'
import { AssistantMessage } from './AssistantMessage'
import { Composer } from './Composer'
import { ToolCallCard } from './ToolCallCard'
import { Icon } from '../common/Icon'

type ChatPaneProps = {
  active: boolean
  runState: RunState
  onRunStateChange: (state: RunState) => void
  onShowPreview: () => void
}

export function ChatPane({ active, runState, onRunStateChange, onShowPreview }: ChatPaneProps) {
  const [composer, setComposer] = useState('')
  const [sentPrompt, setSentPrompt] = useState<string | null>(null)
  const [undone, setUndone] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const sendPrompt = (event: FormEvent) => {
    event.preventDefault()
    const prompt = composer.trim()
    if (!prompt || runState === 'thinking') return
    setSentPrompt(prompt)
    setComposer('')
    setUndone(false)
    onRunStateChange('thinking')
    timer.current = window.setTimeout(() => onRunStateChange('complete'), 5_000)
  }

  const stopRun = () => {
    if (timer.current) window.clearTimeout(timer.current)
    onRunStateChange('cancelled')
  }

  return (
    <section className={`chat-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Chat">
      <div className="pane-heading desktop-only">
        <div><span className="eyebrow">Build with Layla</span><h1>Chat</h1></div>
        <span className="ready-badge"><i /> Ready</span>
      </div>

      <div className="conversation">
        <div className="date-label">Today</div>
        <AssistantMessage>
          <p>I’ve opened <strong>Quiet Weather</strong>. It’s a small offline mini-app with four files.</p>
          <p>What would you like to make?</p>
        </AssistantMessage>

        <article className="user-message"><p>Make the weather card feel calm and cinematic. Add an hourly forecast and make sure it works well on a phone.</p></article>

        <AssistantMessage>
          <p>I gave the card a quieter rainy atmosphere, added the next four hours, and tightened the layout for smaller screens.</p>
          <ToolCallCard run={demoToolRun} undone={undone} onUndo={() => setUndone(true)} onShowPreview={onShowPreview} />
        </AssistantMessage>

        {sentPrompt && (
          <>
            <article className="user-message"><p>{sentPrompt}</p></article>
            <AssistantMessage live>
              {runState === 'thinking' ? (
                <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span><span>Checking the workspace…</span></div>
              ) : runState === 'cancelled' ? (
                <p className="cancelled-copy">Stopped. Your workspace is unchanged.</p>
              ) : (
                <><p>Done — I refined that in the prototype and checked the mobile preview.</p><div className="compact-success"><Icon name="check" size={14} /> Preview checked · No issues</div></>
              )}
            </AssistantMessage>
          </>
        )}
      </div>

      <Composer value={composer} runState={runState} onChange={setComposer} onSubmit={sendPrompt} onStop={stopRun} />
    </section>
  )
}
