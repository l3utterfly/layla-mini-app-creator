import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeWorkspacePath,
  VirtualWorkspace,
  VirtualWorkspaceError,
} from '../src/workspace/VirtualWorkspace.ts'
import { scaffoldWorkspaceFiles } from '../src/data/scaffoldWorkspace.ts'

test('ships a valid two-file Layla mini-app scaffold', () => {
  assert.deepEqual(scaffoldWorkspaceFiles.map(file => file.name), ['app.json', 'index.html'])

  const manifest = JSON.parse(scaffoldWorkspaceFiles[0]!.content) as Record<string, unknown>
  assert.equal(manifest.title, 'Untitled Mini-App')
  assert.equal(typeof manifest.tagline, 'string')
  assert.equal(typeof manifest.description, 'string')

  const html = scaffoldWorkspaceFiles[1]!.content
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /LLM: Replace the contents of main/)
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@layla-network\/sdk@7\.3\.3\/\+esm/)
  assert.match(html, /layla\.contextual\.getExecutionContext\(\)/)
  assert.match(html, /console\.log\("\[Layla mini-app\] execution context:"/)
})

test('normalizes workspace-relative paths and rejects escapes', () => {
  assert.equal(normalizeWorkspacePath('./pages\\home.html'), 'pages/home.html')
  assert.equal(normalizeWorkspacePath('assets//icons/logo.svg'), 'assets/icons/logo.svg')

  for (const path of ['', '../secret.txt', 'pages/../../secret.txt', '/etc/passwd', 'C:\\secret.txt']) {
    assert.throws(
      () => normalizeWorkspacePath(path),
      (error: unknown) => error instanceof VirtualWorkspaceError && error.code === 'INVALID_PATH',
    )
  }
})

test('provides filesystem operations entirely from memory', () => {
  let now = 100
  const workspace = new VirtualWorkspace(
    [
      { name: 'index.html', content: '<h1>Hello</h1>' },
      { name: 'styles/site.css', content: 'h1 { color: red; }' },
    ],
    { clock: () => now++ },
  )
  const changes: string[][] = []
  workspace.subscribe((_snapshot, change) => changes.push(change.changedPaths))

  assert.deepEqual(workspace.listFiles('styles').map(file => file.name), ['styles/site.css'])
  assert.equal(workspace.readFile('./index.html').content, '<h1>Hello</h1>')
  assert.deepEqual(workspace.searchFiles('color').map(match => match.path), ['styles/site.css'])

  const created = workspace.writeFile('scripts/app.js', 'const ready = true')
  assert.equal(created.mimeType, 'text/javascript')
  assert.equal(created.size, 18)

  const edited = workspace.editFile('scripts/app.js', created.revision, [
    { oldText: 'true', newText: 'false' },
  ])
  assert.equal(edited.content, 'const ready = false')
  workspace.deleteFile('scripts/app.js', edited.revision)

  assert.equal(workspace.hasFile('scripts/app.js'), false)
  assert.deepEqual(changes, [
    ['scripts/app.js'],
    ['scripts/app.js'],
    ['scripts/app.js'],
  ])
})

test('returns defensive copies and rejects stale writes', () => {
  const workspace = new VirtualWorkspace([{ name: 'index.html', content: 'original' }])
  const snapshot = workspace.snapshot()
  snapshot.files[0]!.content = 'changed outside'

  const observed = workspace.readFile('index.html')
  assert.equal(observed.content, 'original')

  workspace.writeFile('index.html', 'current', { expectedRevision: observed.revision })
  assert.throws(
    () => workspace.writeFile('index.html', 'stale', { expectedRevision: observed.revision }),
    (error: unknown) => error instanceof VirtualWorkspaceError && error.code === 'REVISION_CONFLICT',
  )
  assert.equal(workspace.readFile('index.html').content, 'current')
})

test('applies multi-file patches atomically', () => {
  const workspace = new VirtualWorkspace([
    { name: 'index.html', content: '<h1>Old</h1>' },
    { name: 'old.css', content: 'body {}' },
  ])
  const revision = workspace.revision

  workspace.applyPatch(`*** Begin Patch
*** Update File: index.html
@@
-<h1>Old</h1>
+<h1>New</h1>
*** Add File: app.js
+document.body.dataset.ready = 'true'
*** Delete File: old.css
*** End Patch`)

  assert.equal(workspace.revision, revision + 1)
  assert.equal(workspace.readFile('index.html').content, '<h1>New</h1>')
  assert.equal(workspace.hasFile('app.js'), true)
  assert.equal(workspace.hasFile('old.css'), false)

  const beforeFailure = workspace.snapshot()
  assert.throws(
    () => workspace.applyPatch(`*** Begin Patch
*** Update File: index.html
@@
-<h1>Stale</h1>
+<h1>Broken</h1>
*** Add File: leaked.txt
+must not be committed
*** End Patch`),
    (error: unknown) => error instanceof VirtualWorkspaceError && error.code === 'PATCH_CONTEXT_NOT_FOUND',
  )
  assert.deepEqual(workspace.snapshot(), beforeFailure)
})

test('rolls back a failed multi-operation transaction', async () => {
  const workspace = new VirtualWorkspace([{ name: 'index.html', content: 'safe' }])
  const before = workspace.snapshot()

  await assert.rejects(
    workspace.transaction(draft => {
      draft.writeFile('temporary.txt', 'temporary')
      draft.readFile('missing.txt')
    }),
    (error: unknown) => error instanceof VirtualWorkspaceError && error.code === 'FILE_NOT_FOUND',
  )
  assert.deepEqual(workspace.snapshot(), before)
})
