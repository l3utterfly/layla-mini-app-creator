import { useEffect, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { LaylaAbortError, type ChatCompletionMessageParam } from '@layla-network/sdk'
import { buildMiniAppSystemPrompt } from '../../agent/systemPrompt'
import { layla } from '../../lib/layla'
import { advanceToolFailureBudget, MAX_CONSECUTIVE_TOOL_FAILURES } from '../../tools/failureBudget'
import { isToolCallCandidate, parseToolCalls } from '../../tools/protocol'
import type { ToolCall, ToolResultEnvelope, ToolRunGroup } from '../../tools/types'
import type { ConversationMessage, RunState } from '../../types/ui'
import type { VirtualWorkspaceSnapshot } from '../../workspace'
import { AssistantMessage } from './AssistantMessage'
import { Composer } from './Composer'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallCard } from './ToolCallCard'
import { ToolCallDisclosure } from './ToolCallDisclosure'
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
const STREAM_RENDER_INTERVAL_MS = 200

function createMessageId() {
  return `message_${nextMessageNumber++}`
}

function reconstructRawOutput(reasoning: string, content: string) {
  return reasoning ? `<think>${reasoning}</think>${content}` : content
}

function serializeToolResult(result: ToolResultEnvelope) {
  return `<tool_result>${JSON.stringify(result)}</tool_result>`
}

function serializeToolResults(results: ToolResultEnvelope[]) {
  return results.map(serializeToolResult).join('\n')
}

function summarizeToolCall(call: ToolCall) {
  const path = typeof call.arguments.path === 'string' ? call.arguments.path : undefined
  return {
    callId: call.callId,
    name: call.name,
    argumentKeys: Object.keys(call.arguments),
    ...(path === undefined ? {} : { path }),
  }
}

function summarizeToolResult(result: ToolResultEnvelope) {
  return {
    callId: result.callId,
    name: result.tool,
    ok: result.ok,
    workspaceRevision: result.workspaceRevision,
    changedPaths: result.changedPaths,
    ...(result.error ? { error: result.error } : {}),
  }
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
  const conversation = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  useEffect(() => () => {
    activeStream.current?.abort()
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = conversation.current
      if (element && shouldAutoScroll.current) element.scrollTop = element.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [messages])

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

    let cancelPendingStreamRender = () => {}
    let consecutiveToolFailures = 0

    try {
      for (let iteration = 0; ; iteration += 1) {
        if (cancellationRequested.current) throw new LaylaAbortError('Generation cancelled')

        const workspaceSnapshot = getWorkspaceSnapshot()
        console.debug('[tool-loop] starting inference iteration', {
          iteration: iteration + 1,
          contextMessageCount: contextMessages.current.length,
          workspaceRevision: workspaceSnapshot.revision,
          consecutiveToolFailures,
        })

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
        let renderTimer: ReturnType<typeof setTimeout> | null = null
        let lastRenderTime = performance.now() - STREAM_RENDER_INTERVAL_MS

        const renderStreamSnapshot = () => {
          renderTimer = null
          lastRenderTime = performance.now()
          updateAssistant(assistantId, {
            content: contentSnapshot,
            reasoning: reasoningSnapshot,
            rawOutput: reconstructRawOutput(reasoningSnapshot, contentSnapshot),
          })
        }
        const scheduleStreamRender = () => {
          if (renderTimer) return
          const delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - (performance.now() - lastRenderTime))
          if (delay === 0) {
            renderStreamSnapshot()
          } else {
            renderTimer = setTimeout(renderStreamSnapshot, delay)
          }
        }
        cancelPendingStreamRender = () => {
          if (renderTimer) clearTimeout(renderTimer)
          renderTimer = null
        }

        const stream = layla.chat.completions.stream({
          messages: [
            {
              role: 'system',
              content: buildMiniAppSystemPrompt(workspace, workspaceSnapshot),
            },
            ...contextMessages.current,
          ],
        })
        activeStream.current = stream
        stream.on('content', (_delta, snapshot) => {
          contentSnapshot = snapshot
          scheduleStreamRender()
        })
        stream.on('reasoning', (_delta, snapshot) => {
          reasoningSnapshot = snapshot
          scheduleStreamRender()
        })

        const finalContent = await stream.finalContent()
        cancelPendingStreamRender()
        contentSnapshot = finalContent
        activeStream.current = null
        updateAssistant(assistantId, {
          content: finalContent,
          reasoning: reasoningSnapshot,
          rawOutput: reconstructRawOutput(reasoningSnapshot, finalContent),
          state: 'complete',
        })
        contextMessages.current.push({ role: 'assistant', content: finalContent })

        const startsWithToolCall = isToolCallCandidate(finalContent)
        const containsToolCallMarker = finalContent.includes('<tool_call')
        console.debug('[tool-loop] inspecting assistant output', {
          iteration: iteration + 1,
          contentLength: finalContent.length,
          startsWithToolCall,
          containsToolCallMarker,
        })

        const parsed = parseToolCalls(finalContent)
        if (parsed.ok) {
          console.info('[tool-loop] detected tool calls', {
            iteration: iteration + 1,
            count: parsed.calls.length,
            calls: parsed.calls.map(summarizeToolCall),
          })
          let activities: ToolRunGroup['activities'] = parsed.calls.map((call, index) => ({
            call,
            status: index === 0 ? 'running' : 'pending',
          }))
          const runningTool: ToolRunGroup = {
            id: `run_${parsed.calls[0]!.callId}`,
            activities,
          }
          updateAssistant(assistantId, { toolRun: runningTool })

          const results: ToolResultEnvelope[] = []
          for (let callIndex = 0; callIndex < parsed.calls.length; callIndex += 1) {
            if (cancellationRequested.current) {
              activities = activities.map(activity => (
                activity.status === 'pending' || activity.status === 'running'
                  ? { ...activity, status: 'cancelled' }
                  : activity
              ))
              updateAssistant(assistantId, {
                toolRun: { ...runningTool, activities },
              })
              throw new LaylaAbortError('Generation cancelled')
            }

            const call = parsed.calls[callIndex]!
            console.info('[tool-loop] dispatching tool call', {
              iteration: iteration + 1,
              position: callIndex + 1,
              total: parsed.calls.length,
              call: summarizeToolCall(call),
            })
            let result: ToolResultEnvelope
            try {
              result = await onRunTool(call)
            } catch (error) {
              console.error('[tool-loop] tool dispatch threw', {
                iteration: iteration + 1,
                position: callIndex + 1,
                total: parsed.calls.length,
                call: summarizeToolCall(call),
                error: error instanceof Error ? error.message : String(error),
              })
              throw error
            }
            console[result.ok ? 'info' : 'warn']('[tool-loop] tool call completed', {
              iteration: iteration + 1,
              position: callIndex + 1,
              total: parsed.calls.length,
              result: summarizeToolResult(result),
            })
            results.push(result)
            const failureBudget = advanceToolFailureBudget(consecutiveToolFailures, result.ok)
            consecutiveToolFailures = failureBudget.consecutiveFailures
            activities = activities.map((activity, index) => {
              if (index === callIndex) {
                return { call, status: result.ok ? 'completed' : 'error', result }
              }
              if (failureBudget.exhausted && index > callIndex) {
                return { ...activity, status: 'cancelled' }
              }
              return index === callIndex + 1 ? { ...activity, status: 'running' } : activity
            })
            updateAssistant(assistantId, {
              toolRun: { ...runningTool, activities },
            })
            console.debug('[tool-loop] updated consecutive failure budget', {
              callId: call.callId,
              succeeded: result.ok,
              consecutiveToolFailures,
              maxConsecutiveToolFailures: MAX_CONSECUTIVE_TOOL_FAILURES,
            })
            if (failureBudget.exhausted) {
              console.error('[tool-loop] consecutive tool failure budget exhausted', {
                iteration: iteration + 1,
                call: summarizeToolCall(call),
                consecutiveToolFailures,
                maxConsecutiveToolFailures: MAX_CONSECUTIVE_TOOL_FAILURES,
              })
              throw new Error(`The model made ${MAX_CONSECUTIVE_TOOL_FAILURES} consecutive failed tool calls.`)
            }
          }

          contextMessages.current.push({ role: 'user', content: serializeToolResults(results) })
          console.debug('[tool-loop] queued tool results and continuing', {
            iteration: iteration + 1,
            resultCount: results.length,
            nextIteration: iteration + 2,
          })
          continue
        }

        if (containsToolCallMarker) {
          const failureBudget = advanceToolFailureBudget(consecutiveToolFailures, false)
          consecutiveToolFailures = failureBudget.consecutiveFailures
          updateAssistant(assistantId, { error: parsed.error })
          console.warn('[tool-loop] rejected tool call candidate', {
            iteration: iteration + 1,
            startsWithToolCall,
            error: parsed.error,
            contentLength: finalContent.length,
            consecutiveToolFailures,
            maxConsecutiveToolFailures: MAX_CONSECUTIVE_TOOL_FAILURES,
          })
          if (failureBudget.exhausted) {
            console.error('[tool-loop] consecutive tool failure budget exhausted', {
              iteration: iteration + 1,
              consecutiveToolFailures,
              maxConsecutiveToolFailures: MAX_CONSECUTIVE_TOOL_FAILURES,
            })
            throw new Error(`The model made ${MAX_CONSECUTIVE_TOOL_FAILURES} consecutive failed tool calls.`)
          }
          contextMessages.current.push({
            role: 'user',
            content: `<tool_result>${JSON.stringify({ ok: false, error: { code: 'INVALID_TOOL_CALL', message: parsed.error } })}</tool_result>`,
          })
          continue
        }

        console.debug('[tool-loop] assistant output contains no tool call; ending loop', {
          iteration: iteration + 1,
          contentLength: finalContent.length,
        })
        onRunStateChange('complete')
        return
      }
    } catch (error) {
      cancelPendingStreamRender()
      activeStream.current = null
      if (error instanceof LaylaAbortError || cancellationRequested.current) {
        onMessagesChange(current => current.map(message => message.state === 'streaming'
          ? { ...message, state: 'cancelled', rawOutput: reconstructRawOutput(message.reasoning, message.content) }
          : message))
        onRunStateChange('cancelled')
      } else {
        const message = error instanceof Error ? error.message : 'Unable to reach the inference engine.'
        onMessagesChange(current => {
          let updatedStreamingMessage = false
          const updated = current.map(entry => {
            if (entry.state !== 'streaming') return entry
            updatedStreamingMessage = true
            return { ...entry, state: 'error' as const, error: message, rawOutput: reconstructRawOutput(entry.reasoning, entry.content) }
          })
          if (updatedStreamingMessage) return updated
          return [...updated, {
            id: createMessageId(),
            role: 'assistant',
            content: '',
            reasoning: '',
            rawOutput: message,
            state: 'error',
            error: message,
          }]
        })
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

      <div
        className="conversation"
        ref={conversation}
        onScroll={event => {
          const element = event.currentTarget
          shouldAutoScroll.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 2
        }}
      >
        {messages.length === 0 ? (
          <div className="conversation-welcome">
            <span className="eyebrow">Build with Layla</span>
            <h2>What should we build today?</h2>
          </div>
        ) : (
          <div className="date-label">Today</div>
        )}
        {messages.map(message => message.role === 'user' ? (
          <article className="user-message" key={message.id}><p>{message.content}</p></article>
        ) : (
          <AssistantMessage key={message.id} live={message.state === 'streaming'}>
            {message.reasoning && (
              <div className="reasoning-output"><span>Thinking</span><MarkdownContent className="reasoning-markdown">{message.reasoning}</MarkdownContent></div>
            )}
            {message.toolRun ? (
              <ToolCallCard run={message.toolRun} rawContent={message.content} />
            ) : isToolCallCandidate(message.content) ? (
              <ToolCallDisclosure content={message.content} live={message.state === 'streaming'} error={message.error} />
            ) : message.state === 'streaming' ? (
              message.content
                ? <MarkdownContent>{message.content}</MarkdownContent>
                : <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span><span>Waiting for the model…</span></div>
            ) : message.state === 'cancelled' ? (
              message.content
                ? <MarkdownContent className="cancelled-copy">{message.content}</MarkdownContent>
                : <p className="cancelled-copy">Stopped. No incomplete tool call was executed.</p>
            ) : message.state === 'error' ? (
              <>
                {message.content && <MarkdownContent>{message.content}</MarkdownContent>}
                <p className="cancelled-copy">{message.error || 'The inference request failed.'}</p>
              </>
            ) : (
              <>
                <MarkdownContent>{message.content}</MarkdownContent>
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
