import { useMemo, useState } from 'react'
import { summarizeToolRun } from '../../tools/registry'
import type { ToolRunGroup } from '../../tools/types'
import { Icon } from '../common/Icon'

type ToolCallCardProps = {
  run: ToolRunGroup
  rawContent?: string
  undone?: boolean
  onUndo?: () => void
  onShowPreview?: () => void
}

export function ToolCallCard({ run, rawContent, undone = false, onUndo, onShowPreview }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const presentation = useMemo(() => {
    const base = summarizeToolRun(run.activities)
    if (run.activities.some(activity => activity.status === 'cancelled')) {
      return {
        ...base,
        title: 'Tool batch cancelled',
        subtitle: 'Remaining calls were not executed',
      }
    }
    const failedActivity = run.activities.find(activity => activity.result && !activity.result.ok)
    return failedActivity ? {
      ...base,
      title: `${failedActivity.call.name} failed`,
      subtitle: failedActivity.result?.error?.message,
    } : base
  }, [run])
  const status = run.activities.some(activity => activity.status === 'running')
    ? 'running'
    : run.activities.some(activity => activity.status === 'error')
      ? 'error'
      : run.activities.some(activity => activity.status === 'cancelled') ? 'cancelled' : 'completed'

  return (
    <>
      <button type="button" className="tool-card" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className={`tool-status ${status}`}>
          {status === 'running' ? <i className="spinner" /> : <Icon name={status === 'completed' ? 'check' : 'x'} size={15} />}
        </span>
        <span className="tool-copy"><strong>{presentation.title}</strong><small>{presentation.subtitle}</small></span>
        <Icon name="chevron" size={16} />
      </button>

      {expanded && (
        <div className="tool-details">
          {presentation.details?.map(detail => (
            <div key={detail.label}><Icon name="file" size={15} /> {detail.label} <span>{detail.value}</span></div>
          ))}
          {rawContent && <pre className="tool-code-block"><code>{rawContent}</code></pre>}
        </div>
      )}

      {(onUndo || onShowPreview) && (
        <div className="message-actions">
          {onUndo && <button className={undone ? 'undone' : ''} onClick={onUndo} disabled={undone}>
            <Icon name={undone ? 'check' : 'undo'} size={15} /> {undone ? 'Changes undone' : 'Undo changes'}
          </button>}
          {onShowPreview && <button onClick={onShowPreview}><Icon name="eye" size={15} /> View preview</button>}
        </div>
      )}
    </>
  )
}
