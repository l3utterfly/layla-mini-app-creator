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

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
    }
  }>
  error?: {
    message?: string
  }
}

const llamaModel = import.meta.env.VITE_LLAMA_MODEL || 'local-model'

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

async function requestLocalCompletion(messages: LaylaChatMessage[]) {
  const response = await fetch('/llama/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llamaModel,
      messages: messages.map(toOpenAIMessage),
      stream: false,
      chat_template_kwargs: {
        enable_thinking: true,
      },
      reasoning_format: 'deepseek',
    }),
  })

  const payload = await response.json() as ChatCompletionResponse
  if (!response.ok) {
    throw new Error(payload.error?.message || `llama-server returned HTTP ${response.status}`)
  }

  const message = payload.choices?.[0]?.message
  const content = message?.content ?? ''
  const reasoning = message?.reasoning_content ?? ''
  if (!content && !reasoning) {
    throw new Error('llama-server returned a completion without assistant content')
  }

  return reasoning ? `<think>${reasoning}</think>${content}` : content
}

if (import.meta.env.DEV) {
  installLaylaMock({
    debug: true,
    inferenceEngines: [`llama-server:${llamaModel}`],
    respond: requestLocalCompletion,
  })
}

export const layla = new LaylaSDK()
