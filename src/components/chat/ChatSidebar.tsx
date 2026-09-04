import type { PersistedChat } from '../../persistence'
import { Icon } from '../common/Icon'

type ChatSidebarProps = {
  open: boolean
  chats: PersistedChat[]
  activeChatId: string
  busy: boolean
  onClose: () => void
  onCreateChat: () => void
  onSelectChat: (chatId: string) => void
}

function formatChatTime(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function ChatSidebar({
  open,
  chats,
  activeChatId,
  busy,
  onClose,
  onCreateChat,
  onSelectChat,
}: ChatSidebarProps) {
  if (!open) return null

  const orderedChats = [...chats].sort((left, right) => right.updatedAt - left.updatedAt)
  return (
    <div
      className="chat-sidebar-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside className="chat-sidebar" role="dialog" aria-modal="true" aria-labelledby="chat-sidebar-title">
        <header>
          <div><span className="eyebrow">Workspace</span><h2 id="chat-sidebar-title">Chats</h2></div>
          <button type="button" className="icon-button" aria-label="Close chats" onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
        </header>

        <button type="button" className="new-chat-button" disabled={busy} onClick={onCreateChat}>
          <Icon name="plus" size={16} />
          <span>New chat</span>
        </button>

        <div className="chat-session-list">
          {orderedChats.map(chat => (
            <button
              type="button"
              key={chat.id}
              className={chat.id === activeChatId ? 'active' : undefined}
              disabled={busy && chat.id !== activeChatId}
              onClick={() => onSelectChat(chat.id)}
            >
              <span className="chat-session-icon"><Icon name="message" size={15} /></span>
              <span className="chat-session-copy">
                <strong>{chat.title}</strong>
                <small>{chat.messages.length === 0 ? 'Empty chat' : `${chat.messages.length} messages`}</small>
              </span>
              <time dateTime={new Date(chat.updatedAt).toISOString()}>{formatChatTime(chat.updatedAt)}</time>
            </button>
          ))}
        </div>

        {busy && <p className="chat-sidebar-hint">Finish the current run before changing chats.</p>}
      </aside>
    </div>
  )
}
