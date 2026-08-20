import { useMemo, useState } from 'react'
import { Icon } from '../common/Icon'

type ToolCallDisclosureProps = {
  content: string
  live?: boolean
}

function getToolNames(content: string) {
  return [...content.matchAll(/<tool_call\s+name="([a-z][a-z0-9_]*)"/g)]
    .map(match => match[1])
    .filter((name): name is string => Boolean(name))
}

export function ToolCallDisclosure({ content, live = false }: ToolCallDisclosureProps) {
  const [expanded, setExpanded] = useState(false)
  const toolNames = useMemo(() => getToolNames(content), [content])
  const title = toolNames.length > 1
    ? `Calling ${toolNames.length} tools`
    : `Calling ${toolNames[0] ?? 'tool'}`

  return (
    <>
      <button
        type="button"
        className="tool-card"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        <span className={`tool-status ${live ? 'running' : 'completed'}`}>
          {live ? <i className="spinner" /> : <Icon name="check" size={15} />}
        </span>
        <span className="tool-copy">
          <strong>{title}</strong>
          <small>{live ? 'Receiving tool input…' : 'Tool input received'}</small>
        </span>
        <Icon name="chevron" size={16} />
      </button>

      {expanded && (
        <div className="tool-details">
          <pre className="tool-code-block"><code>{content}</code></pre>
        </div>
      )}
    </>
  )
}
