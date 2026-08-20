import type { ReactNode } from 'react'
import { Icon } from '../common/Icon'

type AssistantMessageProps = {
  children: ReactNode
  live?: boolean
}

export function AssistantMessage({ children, live = false }: AssistantMessageProps) {
  return (
    <article className={`assistant-message${live ? ' live-message' : ''}`}>
      <div className="assistant-avatar"><Icon name="sparkles" size={16} /></div>
      <div className="assistant-body">{children}</div>
    </article>
  )
}
