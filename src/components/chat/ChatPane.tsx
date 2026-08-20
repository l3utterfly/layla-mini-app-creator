import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LaylaAbortError } from '@layla-network/sdk'
import { buildMiniAppSystemPrompt } from '../../agent/systemPrompt'
import { layla } from '../../lib/layla'
import type { RunState } from '../../types/ui'
import { AssistantMessage } from './AssistantMessage'
import { Composer } from './Composer'
import { Icon } from '../common/Icon'

type ChatPaneProps = {
  active: boolean
  workspace: string
  runState: RunState
  onRunStateChange: (state: RunState) => void
}

export function ChatPane({ active, workspace, runState, onRunStateChange }: ChatPaneProps) {
  const [composer, setComposer] = useState('')
  const [sentPrompt, setSentPrompt] = useState<string | null>(null)
  const [assistantResponse, setAssistantResponse] = useState('')
  const [assistantReasoning, setAssistantReasoning] = useState('')
  const [runError, setRunError] = useState<string | null>(null)
  const activeStream = useRef<ReturnType<typeof layla.chat.completions.stream> | null>(null)

  useEffect(() => () => {
    activeStream.current?.abort()
  }, [])

  const sendPrompt = async (event: FormEvent) => {
    event.preventDefault()
    const prompt = composer.trim()
    if (!prompt || runState === 'thinking') return
    setSentPrompt(prompt)
    setAssistantResponse('')
    setAssistantReasoning('')
    setRunError(null)
    setComposer('')
    onRunStateChange('thinking')

    const stream = layla.chat.completions.stream({
      messages: [
        {
          role: 'system',
          content: buildMiniAppSystemPrompt(workspace),
        },
        { role: 'user', content: prompt },
      ],
    })
    activeStream.current = stream
    stream.on('content', (_delta, snapshot) => setAssistantResponse(snapshot))
    stream.on('reasoning', (_delta, snapshot) => setAssistantReasoning(snapshot))

    try {
      await stream.finalContent()
      onRunStateChange('complete')
    } catch (error) {
      if (error instanceof LaylaAbortError) {
        onRunStateChange('cancelled')
      } else {
        setRunError(error instanceof Error ? error.message : 'Unable to reach the inference engine.')
        onRunStateChange('error')
      }
    } finally {
      if (activeStream.current === stream) activeStream.current = null
    }
  }

  const stopRun = () => {
    activeStream.current?.abort()
  }

  return (
    <section className={`chat-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Chat">
      <div className="pane-heading desktop-only">
        <div><span className="eyebrow">Build with Layla</span><h1>Chat</h1></div>
        <span className="ready-badge"><i /> Ready</span>
      </div>

      <div className="conversation">
        {sentPrompt && (
          <>
            <div className="date-label">Today</div>
            <article className="user-message"><p>{sentPrompt}</p></article>
            <AssistantMessage live>
              {runState === 'thinking' ? (
                assistantReasoning || assistantResponse
                  ? <>
                      {assistantReasoning && <div className="reasoning-output"><span>Thinking</span><pre>{assistantReasoning}</pre></div>}
                      {assistantResponse
                        ? <pre className="raw-assistant-output">{assistantResponse}</pre>
                        : <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span><span>Forming response…</span></div>}
                    </>
                  : <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span><span>Waiting for the model…</span></div>
              ) : runState === 'cancelled' ? (
                <>
                  {assistantReasoning && <div className="reasoning-output"><span>Thinking</span><pre>{assistantReasoning}</pre></div>}
                  <p className="cancelled-copy">{assistantResponse || 'Stopped. Your workspace is unchanged.'}</p>
                </>
              ) : runState === 'error' ? (
                <>
                  {assistantReasoning && <div className="reasoning-output"><span>Thinking</span><pre>{assistantReasoning}</pre></div>}
                  {assistantResponse && <pre className="raw-assistant-output">{assistantResponse}</pre>}
                  <p className="cancelled-copy">{runError || 'The inference request failed.'}</p>
                </>
              ) : (
                <>
                  {assistantReasoning && <div className="reasoning-output"><span>Thinking</span><pre>{assistantReasoning}</pre></div>}
                  <pre className="raw-assistant-output">{assistantResponse}</pre>
                  <div className="compact-success"><Icon name="check" size={14} /> Response complete</div>
                </>
              )}
            </AssistantMessage>
          </>
        )}
      </div>

      <Composer value={composer} runState={runState} onChange={setComposer} onSubmit={sendPrompt} onStop={stopRun} />
    </section>
  )
}
