import type { ConversationMessage } from '../types/ui.ts'
import { WorkspacePersistenceError } from './errors.ts'
import { randomId, workspaceDirectory } from './layout.ts'

export const CHAT_SCHEMA_VERSION = 1
export const DEFAULT_CHAT_TITLE = 'New chat'

export type PersistedChat = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
}

export type PersistedChats = {
  version: number
  activeChatId: string
  chats: PersistedChat[]
}

export function chatsFileName(workspaceId: string) {
  return `${workspaceDirectory(workspaceId)}/chats.json`
}

export function createChat(now: number): PersistedChat {
  return {
    id: `chat${randomId(10)}`,
    title: DEFAULT_CHAT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

export function createEmptyChats(now: number): PersistedChats {
  const chat = createChat(now)
  return { version: CHAT_SCHEMA_VERSION, activeChatId: chat.id, chats: [chat] }
}

export function titleFromMessages(messages: ConversationMessage[]) {
  const prompt = messages.find(message => message.role === 'user')?.content
    .replace(/\s+/g, ' ')
    .trim()
  if (!prompt) return DEFAULT_CHAT_TITLE
  return prompt.length > 48 ? `${prompt.slice(0, 47).trimEnd()}…` : prompt
}

function corrupt(filename: string, detail: string): never {
  throw new WorkspacePersistenceError(
    'CHATS_CORRUPT',
    `${filename} is malformed: ${detail}`,
    { filename },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, filename: string, field: string) {
  if (typeof value !== 'string' || !value) corrupt(filename, `${field} must be a non-empty string.`)
  return value
}

function requireNumber(value: unknown, filename: string, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    corrupt(filename, `${field} must be a number.`)
  }
  return value
}

function normalizeMessage(value: unknown, filename: string): ConversationMessage {
  if (!isRecord(value)) corrupt(filename, 'each message must be an object.')
  const role = value.role
  const state = value.state
  if (role !== 'user' && role !== 'assistant') {
    corrupt(filename, 'messages[].role must be user or assistant.')
  }
  if (state !== 'complete' && state !== 'streaming' && state !== 'cancelled' && state !== 'error') {
    corrupt(filename, 'messages[].state is invalid.')
  }

  const toolRun = isRecord(value.toolRun)
    && typeof value.toolRun.id === 'string'
    && Array.isArray(value.toolRun.activities)
    ? value.toolRun as ConversationMessage['toolRun']
    : undefined

  return {
    id: requireString(value.id, filename, 'messages[].id'),
    role,
    content: typeof value.content === 'string' ? value.content : '',
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : '',
    rawOutput: typeof value.rawOutput === 'string' ? value.rawOutput : '',
    // A stream cannot still be live after an app restart or chat switch.
    state: state === 'streaming' ? 'cancelled' : state,
    ...(toolRun ? { toolRun } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}

function normalizeChat(value: unknown, filename: string): PersistedChat {
  if (!isRecord(value)) corrupt(filename, 'each chat must be an object.')
  if (!Array.isArray(value.messages)) corrupt(filename, 'chats[].messages must be an array.')
  return {
    id: requireString(value.id, filename, 'chats[].id'),
    title: requireString(value.title, filename, 'chats[].title'),
    createdAt: requireNumber(value.createdAt, filename, 'chats[].createdAt'),
    updatedAt: requireNumber(value.updatedAt, filename, 'chats[].updatedAt'),
    messages: value.messages.map(message => normalizeMessage(message, filename)),
  }
}

export function normalizeChats(value: unknown, filename: string): PersistedChats {
  if (!isRecord(value)) corrupt(filename, 'the document must be an object.')
  if (value.version !== CHAT_SCHEMA_VERSION) {
    corrupt(filename, `version must be ${CHAT_SCHEMA_VERSION}.`)
  }
  if (!Array.isArray(value.chats) || value.chats.length === 0) {
    corrupt(filename, 'chats must contain at least one chat.')
  }

  const chats = value.chats.map(chat => normalizeChat(chat, filename))
  const ids = new Set(chats.map(chat => chat.id))
  if (ids.size !== chats.length) corrupt(filename, 'chat ids must be unique.')
  const activeChatId = requireString(value.activeChatId, filename, 'activeChatId')
  if (!ids.has(activeChatId)) corrupt(filename, 'activeChatId must identify a chat in chats.')
  return { version: CHAT_SCHEMA_VERSION, activeChatId, chats }
}
