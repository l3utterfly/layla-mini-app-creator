import assert from 'node:assert/strict'
import test from 'node:test'
import { applyWorkspacePatch, ApplyPatchError } from '../src/tools/applyPatch.ts'
import {
  isFreeformToolCallCandidate,
  parseFreeformToolEnvelope,
  serializeFreeformToolEnvelope,
} from '../src/tools/freeformEnvelope.ts'
import type { VirtualWorkspaceFile } from '../src/workspace/VirtualWorkspace.ts'

type PatchTestFile = {
  name: string
  content: string
  size: string
  type: string
  color: string
}

function createFile(path: string, content: string): PatchTestFile {
  return { name: path, content, size: `${content.length} B`, type: 'TEXT', color: '#fff' }
}

function normalizePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('..')) throw new Error('invalid path')
  return path.replaceAll('\\', '/')
}

test('write_file envelopes preserve literal multiline content', () => {
  const content = `const value = { quote: "hello", slash: "c:\\tmp" }\n</tool_call>\n<section>still content</section>\n`
  const serialized = serializeFreeformToolEnvelope('write_file', content, 'pages/a&b.html')
  const parsed = parseFreeformToolEnvelope(serialized)

  assert.deepEqual(parsed, {
    name: 'write_file',
    path: 'pages/a&b.html',
    payload: content,
  })
  assert.equal(isFreeformToolCallCandidate(serialized), true)
  assert.equal(parseFreeformToolEnvelope(`before\n${serialized}`), null)
})

test('apply_patch updates, adds, and deletes files atomically', () => {
  const files = [
    createFile('index.html', '<main>\n  <h1>Old</h1>\n</main>'),
    createFile('old.css', 'body { color: red; }'),
  ]
  const patch = `*** Begin Patch
*** Update File: index.html
@@
 <main>
-  <h1>Old</h1>
+  <h1>New</h1>
 </main>
*** Add File: app.js
+document.body.dataset.ready = 'true'
*** Delete File: old.css
*** End Patch`

  const applied = applyWorkspacePatch(files, patch, normalizePath, createFile)

  assert.deepEqual(applied.changedPaths, ['index.html', 'app.js', 'old.css'])
  assert.equal(applied.files.find(file => file.name === 'index.html')?.content, '<main>\n  <h1>New</h1>\n</main>')
  assert.equal(applied.files.find(file => file.name === 'app.js')?.content, "document.body.dataset.ready = 'true'")
  assert.equal(applied.files.some(file => file.name === 'old.css'), false)
})

test('apply_patch rejects stale context without mutating input files', () => {
  const files = [createFile('index.html', '<h1>Current</h1>')]
  const patch = `*** Begin Patch
*** Update File: index.html
@@
-<h1>Stale</h1>
+<h1>New</h1>
*** End Patch`

  assert.throws(
    () => applyWorkspacePatch(files, patch, normalizePath, createFile),
    (error: unknown) => error instanceof ApplyPatchError && error.code === 'PATCH_CONTEXT_NOT_FOUND',
  )
  assert.equal(files[0]?.content, '<h1>Current</h1>')
})

test('apply_patch rejects ambiguous context', () => {
  const files = [createFile('app.js', 'const value = 1\nconst value = 1')]
  const patch = `*** Begin Patch
*** Update File: app.js
@@
-const value = 1
+const value = 2
*** End Patch`

  assert.throws(
    () => applyWorkspacePatch(files, patch, normalizePath, createFile),
    (error: unknown) => error instanceof ApplyPatchError && error.code === 'PATCH_CONTEXT_AMBIGUOUS',
  )
})

test('model protocol executes virtual workspace tools end to end', async () => {
  const { createServer } = await import('vite')
  const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })

  try {
    const { parseToolCall } = await server.ssrLoadModule('/src/tools/protocol.ts')
    const { executeToolCall } = await server.ssrLoadModule('/src/tools/runtime.ts')
    const { buildMiniAppSystemPrompt } = await server.ssrLoadModule('/src/agent/systemPrompt.ts')
    const workspace = { files: [] as VirtualWorkspaceFile[], revision: 1 }
    const writeEnvelope = `<tool_call name="write_file" path="index.html">
<h1 data-label="raw">Hello</h1>
</tool_call>`
    const writeCall = parseToolCall(writeEnvelope, 'call_write')

    assert.equal(writeCall.ok, true)
    if (!writeCall.ok) return

    const written = await executeToolCall(writeCall.call, workspace)
    assert.equal(written.result.ok, true)
    assert.equal(written.workspace.files[0]?.content, '<h1 data-label="raw">Hello</h1>')

    const patchEnvelope = `<tool_call name="apply_patch">
*** Begin Patch
*** Update File: index.html
@@
-<h1 data-label="raw">Hello</h1>
+<h1 data-label="raw">Hello, Layla</h1>
*** End Patch
</tool_call>`
    const patchCall = parseToolCall(patchEnvelope, 'call_patch')

    assert.equal(patchCall.ok, true)
    if (!patchCall.ok) return

    const patched = await executeToolCall(patchCall.call, written.workspace)
    assert.equal(patched.result.ok, true)
    assert.deepEqual(patched.result.changedPaths, ['index.html'])
    assert.equal(patched.workspace.files[0]?.content, '<h1 data-label="raw">Hello, Layla</h1>')

    const readCall = parseToolCall(`<tool_call name="read_file">
{"path":"index.html"}
</tool_call>`, 'call_read')
    assert.equal(readCall.ok, true)
    if (!readCall.ok) return

    const read = await executeToolCall(readCall.call, patched.workspace)
    assert.equal(read.result.ok, true)
    assert.equal(read.result.data?.content, '<h1 data-label="raw">Hello, Layla</h1>')
    const fileRevision = String(read.result.data?.revision)

    const editCall = parseToolCall(`<tool_call name="edit_file">
${JSON.stringify({
  path: 'index.html',
  expectedRevision: fileRevision,
  replacements: [{ oldText: 'Hello, Layla', newText: 'Hello, virtual workspace' }],
})}
</tool_call>`, 'call_edit')
    assert.equal(editCall.ok, true)
    if (!editCall.ok) return

    const edited = await executeToolCall(editCall.call, read.workspace)
    assert.equal(edited.result.ok, true)
    assert.equal(edited.workspace.files[0]?.content, '<h1 data-label="raw">Hello, virtual workspace</h1>')

    const searchCall = parseToolCall(`<tool_call name="search_files">
{"query":"virtual workspace"}
</tool_call>`, 'call_search')
    assert.equal(searchCall.ok, true)
    if (!searchCall.ok) return

    const searched = await executeToolCall(searchCall.call, edited.workspace)
    assert.deepEqual(searched.result.data?.matches, [{
      path: 'index.html',
      line: 1,
      text: '<h1 data-label="raw">Hello, virtual workspace</h1>',
    }])

    const systemPrompt = buildMiniAppSystemPrompt('Test Workspace', searched.workspace)
    assert.match(systemPrompt, /Workspace: "Test Workspace" \(revision 4\)/)
    assert.match(systemPrompt, /"read_file"/)
    assert.match(systemPrompt, /"index\.html" \| text\/html/)
    assert.equal(systemPrompt.includes('Hello, virtual workspace'), false)

    const listCall = parseToolCall(`<tool_call name="list_files">
{}
</tool_call>`, 'call_list')
    assert.equal(listCall.ok, true)
    if (!listCall.ok) return
    const listed = await executeToolCall(listCall.call, searched.workspace)
    assert.deepEqual(listed.result.data?.paths, ['index.html'])

    const deleteCall = parseToolCall(`<tool_call name="delete_file">
${JSON.stringify({ path: 'index.html', expectedRevision: edited.result.data?.revision })}
</tool_call>`, 'call_delete')
    assert.equal(deleteCall.ok, true)
    if (!deleteCall.ok) return
    const deleted = await executeToolCall(deleteCall.call, listed.workspace)
    assert.equal(deleted.result.ok, true)
    assert.deepEqual(deleted.workspace.files, [])
  } finally {
    await server.close()
  }
})
