import { useEffect, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { LaylaAbortError, type ChatCompletionMessageParam } from '@layla-network/sdk'
import { buildMiniAppSystemPrompt } from '../../agent/systemPrompt'
import { layla } from '../../lib/layla'
import { parseToolCall } from '../../tools/protocol'
import type { ToolCall, ToolResultEnvelope, ToolRunGroup } from '../../tools/types'
import type { ConversationMessage, RunState } from '../../types/ui'
import type { VirtualWorkspaceSnapshot } from '../../workspace'
import { AssistantMessage } from './AssistantMessage'
import { Composer } from './Composer'
import { ToolCallCard } from './ToolCallCard'
import { Icon } from '../common/Icon'

type ChatPaneProps = {
  active: boolean
  workspace: string
  runState: RunState
  messages: ConversationMessage[]
  onMessagesChange: Dispatch<SetStateAction<ConversationMessage[]>>
  onRunStateChange: (state: RunState) => void
  onRunTool: (call: ToolCall) => Promise<ToolResultEnvelope>
  getWorkspaceSnapshot: () => VirtualWorkspaceSnapshot
}

let nextMessageNumber = 1

function createMessageId() {
  return `message_${nextMessageNumber++}`
}

function reconstructRawOutput(reasoning: string, content: string) {
  return reasoning ? `<think>${reasoning}</think>${content}` : content
}

function serializeToolResult(result: ToolResultEnvelope) {
  return `<tool_result>${JSON.stringify(result)}</tool_result>`
}

export function ChatPane({
  active,
  workspace,
  runState,
  messages,
  onMessagesChange,
  onRunStateChange,
  onRunTool,
  getWorkspaceSnapshot,
}: ChatPaneProps) {
  const [composer, setComposer] = useState('')
  const activeStream = useRef<ReturnType<typeof layla.chat.completions.stream> | null>(null)
  const contextMessages = useRef<ChatCompletionMessageParam[]>([])
  const cancellationRequested = useRef(false)

  useEffect(() => () => {
    activeStream.current?.abort()
  }, [])

  const updateAssistant = (id: string, update: Partial<ConversationMessage>) => {
    onMessagesChange(current => current.map(message => message.id === id ? { ...message, ...update } : message))
  }

  const sendPrompt = async (event: FormEvent) => {
    event.preventDefault()
    const prompt = composer.trim()
    if (!prompt || runState === 'thinking') return

    const userMessage: ConversationMessage = {
      id: createMessageId(),
      role: 'user',
      content: prompt,
      reasoning: '',
      rawOutput: prompt,
      state: 'complete',
    }
    onMessagesChange(current => [...current, userMessage])
    contextMessages.current.push({ role: 'user', content: prompt })
    cancellationRequested.current = false
    setComposer('')
    onRunStateChange('thinking')

    try {
      for (let iteration = 0; iteration < 8; iteration += 1) {
        if (cancellationRequested.current) throw new LaylaAbortError('Generation cancelled')

        const assistantId = createMessageId()
        const assistantMessage: ConversationMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          reasoning: '',
          rawOutput: '',
          state: 'streaming',
        }
        onMessagesChange(current => [...current, assistantMessage])

        let contentSnapshot = ''
        let reasoningSnapshot = ''
        const stream = layla.chat.completions.stream({
          messages: [
            {
              role: 'system',
              content: buildMiniAppSystemPrompt(workspace, getWorkspaceSnapshot()),
            },
            ...contextMessages.current,
          ],
        })
        activeStream.current = stream
        stream.on('content', (_delta, snapshot) => {
          contentSnapshot = snapshot
          updateAssistant(assistantId, {
            content: snapshot,
            rawOutput: reconstructRawOutput(reasoningSnapshot, snapshot),
          })
        })
        stream.on('reasoning', (_delta, snapshot) => {
          reasoningSnapshot = snapshot
          updateAssistant(assistantId, {
            reasoning: snapshot,
            rawOutput: reconstructRawOutput(snapshot, contentSnapshot),
          })
        })

        const finalContent = await stream.finalContent()
        contentSnapshot = finalContent
        activeStream.current = null
        updateAssistant(assistantId, {
          content: finalContent,
          reasoning: reasoningSnapshot,
          rawOutput: reconstructRawOutput(reasoningSnapshot, finalContent),
          state: 'complete',
        })
        contextMessages.current.push({ role: 'assistant', content: finalContent })

        const parsed = parseToolCall(finalContent)
        if (parsed.ok) {
          const runningTool: ToolRunGroup = {
            id: `run_${parsed.call.callId}`,
            activities: [{ call: parsed.call, status: 'running' }],
          }
          updateAssistant(assistantId, { toolRun: runningTool })

          const result = await onRunTool(parsed.call)
          const completedTool: ToolRunGroup = {
            ...runningTool,
            activities: [{
              call: parsed.call,
              status: result.ok ? 'completed' : 'error',
              result,
            }],
          }
          updateAssistant(assistantId, { toolRun: completedTool })
          contextMessages.current.push({ role: 'user', content: serializeToolResult(result) })
          continue
        }

        if (finalContent.includes('<tool_call')) {
          contextMessages.current.push({
            role: 'user',
            content: `<tool_result>${JSON.stringify({ ok: false, error: { code: 'INVALID_TOOL_CALL', message: parsed.error } })}</tool_result>`,
          })
          continue
        }

        onRunStateChange('complete')
        return
      }

      throw new Error('The model reached the maximum of 8 tool iterations without a final response.')
    } catch (error) {
      activeStream.current = null
      if (error instanceof LaylaAbortError || cancellationRequested.current) {
        onMessagesChange(current => current.map(message => message.state === 'streaming'
          ? { ...message, state: 'cancelled', rawOutput: reconstructRawOutput(message.reasoning, message.content) }
          : message))
        onRunStateChange('cancelled')
      } else {
        const message = error instanceof Error ? error.message : 'Unable to reach the inference engine.'
        onMessagesChange(current => current.map(entry => entry.state === 'streaming'
          ? { ...entry, state: 'error', error: message, rawOutput: reconstructRawOutput(entry.reasoning, entry.content) }
          : entry))
        onRunStateChange('error')
      }
    }
  }

  const stopRun = () => {
    cancellationRequested.current = true
    activeStream.current?.abort()
  }

  return (
    <section className={`chat-pane pane ${active ? 'mobile-active' : ''}`} aria-label="Chat">
      <div className="pane-heading desktop-only">
        <div><span className="eyebrow">Build with Layla</span><h1>Chat</h1></div>
        <span className="ready-badge"><i /> Ready</span>
      </div>

      <div className="conversation">
        {messages.length > 0 && <div className="date-label">Today</div>}
        {messages.map(message => message.role === 'user' ? (
          <article className="user-message" key={message.id}><p>{message.content}</p></article>
        ) : (
          <AssistantMessage key={message.id} live={message.state === 'streaming'}>
            {message.reasoning && (
              <div className="reasoning-output"><span>Thinking</span><pre>{message.reasoning}</pre></div>
            )}
            {message.toolRun ? (
              <ToolCallCard run={message.toolRun} />
            ) : message.state === 'streaming' ? (
              message.content
                ? <pre className="raw-assistant-output">{message.content}</pre>
                : <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span><span>Waiting for the model…</span></div>
            ) : message.state === 'cancelled' ? (
              <p className="cancelled-copy">{message.content || 'Stopped. No incomplete tool call was executed.'}</p>
            ) : message.state === 'error' ? (
              <>
                {message.content && <pre className="raw-assistant-output">{message.content}</pre>}
                <p className="cancelled-copy">{message.error || 'The inference request failed.'}</p>
              </>
            ) : (
              <>
                <pre className="raw-assistant-output">{message.content}</pre>
                <div className="compact-success"><Icon name="check" size={14} /> Response complete</div>
              </>
            )}
          </AssistantMessage>
        ))}
      </div>

      <Composer value={composer} runState={runState} onChange={setComposer} onSubmit={sendPrompt} onStop={stopRun} />
    </section>
  )
}
