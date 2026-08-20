import { useMemo, useState } from 'react'
import { summarizeToolRun } from '../../tools/registry'
import type { ToolRunGroup } from '../../tools/types'
import { Icon } from '../common/Icon'

type ToolCallCardProps = {
  run: ToolRunGroup
  undone: boolean
  onUndo: () => void
  onShowPreview: () => void
}

export function ToolCallCard({ run, undone, onUndo, onShowPreview }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const presentation = useMemo(() => summarizeToolRun(run.activities), [run])

  return (
    <>
      <button className="tool-card" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className="tool-status"><Icon name="check" size={15} /></span>
        <span className="tool-copy"><strong>{presentation.title}</strong><small>{presentation.subtitle}</small></span>
        <Icon name="chevron" size={16} />
      </button>

      {expanded && (
        <div className="tool-details">
          {presentation.details?.map(detail => (
            <div key={detail.label}><Icon name="file" size={15} /> {detail.label} <span>{detail.value}</span></div>
          ))}
        </div>
      )}

      <div className="message-actions">
        <button className={undone ? 'undone' : ''} onClick={onUndo} disabled={undone}>
          <Icon name={undone ? 'check' : 'undo'} size={15} /> {undone ? 'Changes undone' : 'Undo changes'}
        </button>
        <button onClick={onShowPreview}><Icon name="eye" size={15} /> View preview</button>
      </div>
    </>
  )
}
