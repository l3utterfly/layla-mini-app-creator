import assert from 'node:assert/strict'
import test from 'node:test'
import { nextWorkspaceName } from '../src/data/bootstrapWorkspace.ts'
import { attachWorkspaceAutosave } from '../src/persistence/WorkspaceAutosave.ts'
import { createWorkspaceRepository } from '../src/persistence/WorkspaceRepository.ts'
import { WorkspacePersistenceError } from '../src/persistence/errors.ts'
import { INDEX_BACKUP_FILE_NAME, INDEX_FILE_NAME } from '../src/persistence/layout.ts'
import type { HostFileStore } from '../src/persistence/hostFileStore.ts'
import type { PersistedIndex } from '../src/persistence/types.ts'

type TrackingStore = {
  store: HostFileStore
  contents: Map<string, string>
  writes: string[]
  failWrites: Set<string>
}

function createTrackingStore(seed: Record<string, string> = {}): TrackingStore {
  const contents = new Map(Object.entries(seed))
  const writes: string[] = []
  const failWrites = new Set<string>()

  return {
    contents,
    writes,
    failWrites,
    store: {
      async read(filename) {
        return contents.get(filename) ?? null
      },
      async write(filename, content) {
        if (failWrites.has(filename)) throw new Error(`refusing to write ${filename}`)
        writes.push(filename)
        contents.set(filename, content)
      },
    },
  }
}

function readIndex(tracking: TrackingStore): PersistedIndex {
  const raw = tracking.contents.get(INDEX_FILE_NAME)
  assert.ok(raw, `${INDEX_FILE_NAME} was never written`)
  return JSON.parse(raw) as PersistedIndex
}

const seedFiles = [
  { name: 'app.json', content: '{"title":"Weather"}' },
  { name: 'index.html', content: '<h1>Weather</h1>' },
  { name: '.agent/layla-sdk/SKILL.md', content: 'derived skill instructions' },
]

test('creating a workspace writes one blob per file and an index that references them', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)

  const summary = await repository.createWorkspace({ name: '  Weather  ', files: seedFiles })

  assert.equal(summary.name, 'Weather')
  assert.equal(summary.fileCount, 2)

  const index = readIndex(tracking)
  assert.equal(index.version, 1)
  assert.equal(index.activeWorkspaceId, summary.id)
  assert.equal(index.workspaces.length, 1)

  const entry = index.workspaces[0]!
  assert.deepEqual(entry.files.map(file => file.path), ['app.json', 'index.html'])
  for (const file of entry.files) {
    assert.ok(file.blob.startsWith(`${summary.id}.`), `${file.blob} is not scoped to the workspace`)
    assert.ok(tracking.contents.has(file.blob), `${file.blob} was not written`)
  }
  assert.equal(tracking.contents.get(entry.files[1]!.blob), '<h1>Weather</h1>')

  // Derived `.agent` files are re-seeded on load, never persisted.
  assert.ok(![...tracking.contents.values()].includes('derived skill instructions'))

  // Nothing to back up on a first run, so no backup file is produced.
  assert.equal(tracking.contents.has(INDEX_BACKUP_FILE_NAME), false)
})

test('hydrating restores persisted files and re-seeds derived ones', async () => {
  const tracking = createTrackingStore()
  const summary = await createWorkspaceRepository(tracking.store).createWorkspace({
    name: 'Weather',
    files: seedFiles,
  })

  // A fresh repository over the same store stands in for an app restart.
  const workspace = await createWorkspaceRepository(tracking.store).hydrateWorkspace(summary.id, {
    derivedFiles: [{ name: '.agent/layla-sdk/SKILL.md', content: 'skill from this build' }],
  })

  assert.deepEqual(workspace.listFiles().map(file => file.name), [
    '.agent/layla-sdk/SKILL.md',
    'app.json',
    'index.html',
  ])
  assert.equal(workspace.readFile('index.html').content, '<h1>Weather</h1>')
  assert.equal(workspace.readFile('app.json').mimeType, 'application/json')
  assert.equal(workspace.readFile('.agent/layla-sdk/SKILL.md').content, 'skill from this build')
})

test('a blob listed in the index but missing on the host is an integrity failure', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })

  const entry = readIndex(tracking).workspaces[0]!
  tracking.contents.delete(entry.files[0]!.blob)

  await assert.rejects(
    () => createWorkspaceRepository(tracking.store).hydrateWorkspace(summary.id),
    (error: WorkspacePersistenceError) => error.code === 'BLOB_MISSING',
  )
})

test('saving rewrites only the blobs whose revision moved', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const workspace = await repository.hydrateWorkspace(summary.id)

  const indexBefore = readIndex(tracking)
  const htmlBlob = indexBefore.workspaces[0]!.files[1]!.blob

  workspace.writeFile('index.html', '<h1>Sunny</h1>')
  tracking.writes.length = 0
  await repository.saveChangedFiles(summary.id, workspace.snapshot(), ['index.html', 'app.json'])

  // The unchanged app.json blob is skipped; the changed file keeps its blob
  // name so a rewrite never strands the previous one.
  assert.deepEqual(tracking.writes, [htmlBlob, INDEX_BACKUP_FILE_NAME, INDEX_FILE_NAME])
  assert.equal(tracking.contents.get(htmlBlob), '<h1>Sunny</h1>')

  const entry = readIndex(tracking).workspaces[0]!
  assert.equal(entry.revision, workspace.revision)
  assert.equal(entry.files[1]!.revision, workspace.readFile('index.html').revision)
})

test('deleting a file drops its index entry and clears the blob afterwards', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const workspace = await repository.hydrateWorkspace(summary.id)
  const removedBlob = readIndex(tracking).workspaces[0]!.files[0]!.blob

  workspace.deleteFile('app.json')
  await repository.saveChangedFiles(summary.id, workspace.snapshot(), ['app.json'])

  const entry = readIndex(tracking).workspaces[0]!
  assert.deepEqual(entry.files.map(file => file.path), ['index.html'])
  assert.deepEqual(entry.orphanedBlobs, [])
  assert.equal(tracking.contents.get(removedBlob), '')
})

test('a blob that cannot be cleared stays listed for a later sweep', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const workspace = await repository.hydrateWorkspace(summary.id)
  const removedBlob = readIndex(tracking).workspaces[0]!.files[0]!.blob

  tracking.failWrites.add(removedBlob)
  workspace.deleteFile('app.json')
  await repository.saveChangedFiles(summary.id, workspace.snapshot(), ['app.json'])

  assert.deepEqual(readIndex(tracking).workspaces[0]!.orphanedBlobs, [removedBlob])

  tracking.failWrites.clear()
  assert.equal(await repository.sweepOrphanedBlobs(summary.id), 1)
  assert.deepEqual(readIndex(tracking).workspaces[0]!.orphanedBlobs, [])
})

test('a second workspace is isolated from the first and becomes active', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)

  const first = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const firstWorkspace = await repository.hydrateWorkspace(first.id)
  firstWorkspace.writeFile('index.html', '<h1>Sunny</h1>')
  await repository.saveChangedFiles(first.id, firstWorkspace.snapshot(), ['index.html'])

  const second = await repository.createWorkspace({
    name: nextWorkspaceName([first.name]),
    files: [{ name: 'index.html', content: '<h1>Second</h1>' }],
  })

  assert.equal(second.name, 'New workspace')
  const index = readIndex(tracking)
  assert.equal(index.activeWorkspaceId, second.id)
  assert.deepEqual(index.workspaces.map(entry => entry.name), ['Weather', 'New workspace'])

  // Blobs are scoped per workspace, so neither can read or overwrite the other.
  const blobs = index.workspaces.flatMap(entry => entry.files.map(file => file.blob))
  assert.equal(new Set(blobs).size, blobs.length)

  const reopened = createWorkspaceRepository(tracking.store)
  assert.equal((await reopened.hydrateWorkspace(first.id)).readFile('index.html').content, '<h1>Sunny</h1>')
  assert.equal((await reopened.hydrateWorkspace(second.id)).readFile('index.html').content, '<h1>Second</h1>')
  assert.equal(await reopened.getActiveWorkspaceId(), second.id)
})

test('deleting a workspace clears its blobs and leaves the others intact', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const kept = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const doomed = await repository.createWorkspace({ name: 'Scratch', files: seedFiles })

  const before = readIndex(tracking)
  const keptBlobs = before.workspaces[0]!.files.map(file => file.blob)
  const doomedBlobs = before.workspaces[1]!.files.map(file => file.blob)

  await repository.deleteWorkspace(doomed.id)

  const index = readIndex(tracking)
  assert.deepEqual(index.workspaces.map(entry => entry.id), [kept.id])
  // The deleted workspace was active, so nothing is active until one is chosen.
  assert.equal(index.activeWorkspaceId, null)
  assert.deepEqual(index.orphanedBlobs, [])

  for (const blob of doomedBlobs) assert.equal(tracking.contents.get(blob), '')
  for (const blob of keptBlobs) assert.notEqual(tracking.contents.get(blob), '')

  const reopened = createWorkspaceRepository(tracking.store)
  assert.equal((await reopened.hydrateWorkspace(kept.id)).readFile('index.html').content, '<h1>Weather</h1>')
  await assert.rejects(
    () => reopened.hydrateWorkspace(doomed.id),
    (error: WorkspacePersistenceError) => error.code === 'WORKSPACE_NOT_FOUND',
  )
})

test('blobs a delete cannot clear survive in the index until a sweep', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const doomed = await repository.createWorkspace({ name: 'Scratch', files: seedFiles })
  const stubborn = readIndex(tracking).workspaces[0]!.files[0]!.blob

  tracking.failWrites.add(stubborn)
  await repository.deleteWorkspace(doomed.id)

  // The entry is gone either way; only the space reclamation is outstanding.
  const index = readIndex(tracking)
  assert.deepEqual(index.workspaces, [])
  assert.deepEqual(index.orphanedBlobs, [stubborn])

  tracking.failWrites.clear()
  assert.equal(await repository.sweepOrphanedBlobs(), 1)
  assert.deepEqual(readIndex(tracking).orphanedBlobs, [])
  assert.equal(tracking.contents.get(stubborn), '')
})

test('deleting an unknown workspace fails without changing the index', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  await repository.createWorkspace({ name: 'Weather', files: seedFiles })

  tracking.writes.length = 0
  await assert.rejects(
    () => repository.deleteWorkspace('wkmissing'),
    (error: WorkspacePersistenceError) => error.code === 'WORKSPACE_NOT_FOUND',
  )
  assert.deepEqual(tracking.writes, [])
  assert.equal(readIndex(tracking).workspaces.length, 1)
})

test('new workspace names avoid colliding with existing ones', () => {
  assert.equal(nextWorkspaceName([]), 'New workspace')
  assert.equal(nextWorkspaceName(['Weather']), 'New workspace')
  assert.equal(nextWorkspaceName(['New workspace']), 'New workspace 2')
  assert.equal(nextWorkspaceName(['New workspace', ' New workspace 2 ']), 'New workspace 3')
  assert.equal(nextWorkspaceName(['New workspace', 'New workspace 3']), 'New workspace 2')
})

test('renaming updates the index without touching any blob', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const blobs = readIndex(tracking).workspaces[0]!.files.map(file => file.blob)

  tracking.writes.length = 0
  const renamed = await repository.renameWorkspace(summary.id, '  Weather Now  ')

  assert.equal(renamed.name, 'Weather Now')
  assert.deepEqual(tracking.writes, [INDEX_BACKUP_FILE_NAME, INDEX_FILE_NAME])

  const entry = readIndex(tracking).workspaces[0]!
  assert.equal(entry.name, 'Weather Now')
  assert.deepEqual(entry.files.map(file => file.blob), blobs)

  // A no-op rename does not rewrite anything.
  tracking.writes.length = 0
  await repository.renameWorkspace(summary.id, 'Weather Now')
  assert.deepEqual(tracking.writes, [])

  await assert.rejects(
    () => repository.renameWorkspace(summary.id, '   '),
    (error: WorkspacePersistenceError) => error.code === 'INVALID_NAME',
  )
  await assert.rejects(
    () => repository.renameWorkspace('wkmissing', 'Anything'),
    (error: WorkspacePersistenceError) => error.code === 'WORKSPACE_NOT_FOUND',
  )
})

test('a renamed workspace keeps its name across a restart', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  await repository.renameWorkspace(summary.id, 'Weather Now')

  const reloaded = await createWorkspaceRepository(tracking.store).listWorkspaces()
  assert.deepEqual(reloaded.map(entry => entry.name), ['Weather Now'])
})

test('a corrupt index is recovered from the backup instead of being replaced', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const workspace = await repository.hydrateWorkspace(summary.id)

  // A second index write is what produces the backup.
  workspace.writeFile('index.html', '<h1>Sunny</h1>')
  await repository.saveChangedFiles(summary.id, workspace.snapshot(), ['index.html'])
  tracking.contents.set(INDEX_FILE_NAME, '{ this is not json')

  const recovered = await createWorkspaceRepository(tracking.store).loadIndex()
  assert.equal(recovered.workspaces.length, 1)
  assert.equal(recovered.workspaces[0]!.id, summary.id)
})

test('an index from a newer build is refused rather than overwritten', async () => {
  const tracking = createTrackingStore({
    [INDEX_FILE_NAME]: JSON.stringify({ version: 99, workspaces: [], activeWorkspaceId: null }),
  })

  await assert.rejects(
    () => createWorkspaceRepository(tracking.store).loadIndex(),
    (error: WorkspacePersistenceError) => error.code === 'INDEX_VERSION_UNSUPPORTED',
  )
  assert.deepEqual(tracking.writes, [])
})

test('autosave persists workspace changes and reports failures', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const workspace = await repository.hydrateWorkspace(summary.id, {
    derivedFiles: [{ name: '.agent/layla-sdk/SKILL.md', content: 'skill' }],
  })

  const states: string[] = []
  const { autosave, stop } = attachWorkspaceAutosave(repository, summary.id, workspace, {
    debounceMs: 1,
    onStateChange: state => states.push(state.status),
  })

  // Derived paths never make the workspace dirty.
  workspace.writeFile('.agent/layla-sdk/SKILL.md', 'edited skill')
  assert.deepEqual(states, [])

  workspace.writeFile('styles.css', 'body{margin:0}')
  await autosave.flush()

  const entry = readIndex(tracking).workspaces[0]!
  const added = entry.files.find(file => file.path === 'styles.css')
  assert.ok(added, 'styles.css was not persisted')
  assert.equal(tracking.contents.get(added.blob), 'body{margin:0}')
  assert.equal(entry.files.some(file => file.path.startsWith('.agent/')), false)
  assert.deepEqual(states, ['pending', 'saving', 'saved'])

  tracking.failWrites.add(INDEX_FILE_NAME)
  workspace.writeFile('styles.css', 'body{margin:1px}')
  await assert.rejects(() => autosave.flush())
  assert.equal(autosave.state.status, 'error')
  assert.deepEqual(autosave.state.pendingPaths, ['styles.css'])

  // The failed path is retried on the next flush once the host recovers.
  tracking.failWrites.clear()
  await autosave.flush()
  assert.equal(autosave.state.status, 'saved')
  const retried = readIndex(tracking).workspaces[0]!.files.find(file => file.path === 'styles.css')!
  assert.equal(tracking.contents.get(retried.blob), 'body{margin:1px}')

  stop()
})

test('autosave writes after the debounce without an explicit flush', async () => {
  const tracking = createTrackingStore()
  const repository = createWorkspaceRepository(tracking.store)
  const summary = await repository.createWorkspace({ name: 'Weather', files: seedFiles })
  const workspace = await repository.hydrateWorkspace(summary.id)

  const saved = new Promise<void>(resolve => {
    const { stop } = attachWorkspaceAutosave(repository, summary.id, workspace, {
      debounceMs: 1,
      onStateChange: state => {
        if (state.status !== 'saved') return
        stop()
        resolve()
      },
    })
  })

  workspace.writeFile('index.html', '<h1>Sunny</h1>')
  await saved

  const entry = readIndex(tracking).workspaces[0]!
  assert.equal(tracking.contents.get(entry.files[1]!.blob), '<h1>Sunny</h1>')
})
