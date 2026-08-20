import { createToolCall } from '../tools/registry'
import type { ToolActivity, ToolResultEnvelope, ToolRunGroup } from '../tools/types'

const changedFiles = [
  { path: 'index.html', revision: 'rev_43_html', changeSummary: '+18' },
  { path: 'styles.css', revision: 'rev_43_css', changeSummary: '+64' },
  { path: 'app.js', revision: 'rev_43_js', changeSummary: '+12' },
]

const activities: ToolActivity[] = changedFiles.map(({ path, revision, changeSummary }, index) => {
  const call = createToolCall('edit_file', {
    path,
    expectedRevision: `rev_42_${index}`,
    replacements: [{ oldText: 'before', newText: 'after' }],
  }, `call_demo_${index + 1}`)
  const result: ToolResultEnvelope = {
    callId: call.callId,
    tool: call.name,
    ok: true,
    workspaceRevision: 43,
    changedPaths: [path],
    data: { path, revision, changeSummary },
    diagnostics: [],
  }
  return { call, result, status: 'completed' }
})

export const demoToolRun: ToolRunGroup = {
  id: 'run_demo_weather_edit',
  activities,
}
