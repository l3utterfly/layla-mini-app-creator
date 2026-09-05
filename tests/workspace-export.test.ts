import assert from 'node:assert/strict'
import test from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import { VirtualWorkspace } from '../src/workspace/VirtualWorkspace.ts'
import {
  bytesToBase64,
  createWorkspaceZip,
  exportableWorkspaceFiles,
  saveWorkspaceZip,
  workspaceZipFileName,
} from '../src/workspace/exportWorkspace.ts'

test('exports workspace files as a flat-root zip without .agent files', () => {
  const workspace = new VirtualWorkspace([
    { name: 'app.json', content: '{"title":"Weather / Now"}' },
    { name: 'index.html', content: '<h1>Weather</h1>' },
    { name: 'assets/app.js', content: 'document.body.dataset.ready = "true"' },
    { name: 'icon.png', content: 'data:image/png;base64,AQIDBA==', mimeType: 'image/png' },
    { name: 'manual.pdf', content: 'data:application/pdf;base64,BQYHCA==', mimeType: 'application/pdf' },
    { name: 'data.txt', content: 'data:text/plain;base64,keep-this-literal', mimeType: 'text/plain' },
    { name: '.agent/layla-sdk/SKILL.md', content: 'private skill instructions' },
    { name: '.agentless/readme.txt', content: 'include this similarly named folder' },
  ])

  const snapshot = workspace.snapshot()
  const exportFiles = exportableWorkspaceFiles(snapshot.files)
  const entries = unzipSync(createWorkspaceZip(exportFiles))

  assert.deepEqual(Object.keys(entries).sort(), [
    '.agentless/readme.txt',
    'app.json',
    'assets/app.js',
    'data.txt',
    'icon.png',
    'index.html',
    'manual.pdf',
  ])
  assert.equal(strFromU8(entries['index.html']!), '<h1>Weather</h1>')
  assert.equal(strFromU8(entries['data.txt']!), 'data:text/plain;base64,keep-this-literal')
  assert.deepEqual([...entries['icon.png']!], [1, 2, 3, 4])
  assert.deepEqual([...entries['manual.pdf']!], [5, 6, 7, 8])
  assert.equal(workspaceZipFileName(snapshot.files), 'Weather - Now.zip')
  assert.match(bytesToBase64(createWorkspaceZip(exportFiles)), /^[A-Za-z0-9+/]+=*$/)
})

test('uses a safe fallback name when app metadata is invalid', () => {
  const workspace = new VirtualWorkspace([{ name: 'app.json', content: '{not json' }])
  assert.equal(workspaceZipFileName(workspace.listFiles()), 'layla-mini-app.zip')
})

test('saves the zip through Layla with sharing enabled', async () => {
  const workspace = new VirtualWorkspace([
    { name: 'app.json', content: '{"title":"Share Me"}' },
    { name: 'index.html', content: '<main>Ready</main>' },
  ])
  const calls: Array<{ fileName: string; contentBase64: string; share?: boolean }> = []

  const fileName = await saveWorkspaceZip(workspace.listFiles(), {
    saveFile: async (savedName, contentBase64, share) => {
      calls.push({ fileName: savedName, contentBase64, share })
      return { success: true }
    },
  })

  assert.equal(fileName, 'Share Me.zip')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.fileName, 'Share Me.zip')
  assert.equal(calls[0]?.share, true)
  assert.match(calls[0]?.contentBase64 ?? '', /^UEsDB/)
})
