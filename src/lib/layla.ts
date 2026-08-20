import {
  LaylaSDK,
  installLaylaMock,
  type LaylaChatMessage,
} from '@layla-network/sdk'

type OpenAIMessage = {
  role: LaylaChatMessage['role']
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >
  name?: string
}

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
    }
  }>
  error?: {
    message?: string
  }
}

const llamaModel = import.meta.env.VITE_LLAMA_MODEL || 'local-model'
let activeMockRequest: AbortController | null = null

function toOpenAIMessage(message: LaylaChatMessage): OpenAIMessage {
  const name = message.name ? { name: message.name } : {}

  if (!message.image_base64) {
    return {
      role: message.role,
      content: message.content ?? '',
      ...name,
    }
  }

  const content: OpenAIMessage['content'] = []
  if (message.content) content.push({ type: 'text', text: message.content })
  content.push({
    type: 'image_url',
    image_url: { url: message.image_base64 },
  })

  return { role: message.role, content, ...name }
}

function parseSseData(event: string) {
  return event
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
}

async function* requestLocalCompletion(messages: LaylaChatMessage[]) {
  const controller = new AbortController()
  activeMockRequest = controller

  try {
    const response = await fetch('/llama/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llamaModel,
        messages: messages.map(toOpenAIMessage),
        stream: true,
        chat_template_kwargs: {
          enable_thinking: true,
        },
        reasoning_format: 'deepseek',
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as ChatCompletionChunk | null
      throw new Error(payload?.error?.message || `llama-server returned HTTP ${response.status}`)
    }
    if (!response.body) throw new Error('llama-server returned a streaming response without a body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let structuredReasoningOpen = false

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      let separator = buffer.match(/\r?\n\r?\n/)
      while (separator?.index !== undefined) {
        const event = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const data = parseSseData(event)

        if (data === '[DONE]') {
          if (structuredReasoningOpen) yield '</think>'
          return
        }
        if (data) {
          const chunk = JSON.parse(data) as ChatCompletionChunk
          if (chunk.error?.message) throw new Error(chunk.error.message)

          const delta = chunk.choices?.[0]?.delta
          const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? ''
          const content = delta?.content ?? ''

          if (reasoning) {
            if (!structuredReasoningOpen) {
              yield '<think>'
              structuredReasoningOpen = true
            }
            yield reasoning
          }
          if (content) {
            if (structuredReasoningOpen) {
              yield '</think>'
              structuredReasoningOpen = false
            }
            yield content
          }
        }

        separator = buffer.match(/\r?\n\r?\n/)
      }

      if (done) {
        if (structuredReasoningOpen) yield '</think>'
        return
      }
    }
  } catch (error) {
    // The SDK mock owns the user-facing cancellation result. Returning prevents
    // its fire-and-forget responder from logging an unhandled
    // AbortError after the bridge has already acknowledged the cancellation.
    if (controller.signal.aborted) return
    throw error
  } finally {
    if (activeMockRequest === controller) activeMockRequest = null
  }
}

function forwardMockCancellationToFetch() {
  const bridge = window.ReactNativeWebView
  if (!bridge) return

  const postMessage = bridge.postMessage.bind(bridge)
  bridge.postMessage = (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage) as { cmd?: unknown }
      if (message.cmd === 'cancel') activeMockRequest?.abort()
    } catch {
      // Let the SDK mock handle malformed bridge messages as it normally does.
    }

    postMessage(rawMessage)
  }
}

if (import.meta.env.DEV) {
  installLaylaMock({
    debug: true,
    inferenceEngines: [`llama-server:${llamaModel}`],
    respond: requestLocalCompletion,
    latencyMs: 0,
    tokenDelayMs: 0,
  })
  forwardMockCancellationToFetch()
}

export const layla = new LaylaSDK()
