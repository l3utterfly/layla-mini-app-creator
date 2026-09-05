import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPreviewFileResponse,
  detectPreviewCapability,
  previewFileUrl,
  previewRevisionBaseUrl,
  publishPreviewSnapshot,
} from '../src/components/preview/previewVirtualFs.ts'
import { PREVIEW_BRIDGE_CHANNEL } from '../src/components/preview/previewBridge.ts'
import { createVirtualWorkspace } from '../src/workspace/index.ts'
import {
  normalizePreviewPath,
  parsePreviewUrl,
  servePreviewRequest,
} from '../public/preview/sw-core.js'

class MemoryCache {
  readonly entries = new Map<string, Response>()

  async put(request: Request, response: Response) {
    this.entries.set(request.url, response.clone())
  }

  async match(request: Request) {
    return this.entries.get(request.url)?.clone()
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>()

  async open(name: string) {
    let cache = this.caches.get(name)
    if (!cache) {
      cache = new MemoryCache()
      this.caches.set(name, cache)
    }
    return cache
  }
}

const origin = 'https://creator.test'

function cacheStorage(memory: MemoryCacheStorage) {
  return memory as unknown as CacheStorage
}

test('parses virtual URLs, decodes safe paths, and normalizes directories', () => {
  const parsed = parsePreviewUrl(`${origin}/preview/instance/workspace/7/pages/hello%20world.html?theme=dark`)
  assert.deepEqual(parsed, {
    kind: 'file',
    instanceId: 'instance',
    workspaceId: 'workspace',
    revision: '7',
    path: 'pages/hello world.html',
    cacheUrl: `${origin}/preview/instance/workspace/7/pages/hello%20world.html`,
  })
  assert.equal(normalizePreviewPath('pages\\about\\'), 'pages/about/index.html')
  assert.equal(parsePreviewUrl(`${origin}/preview/instance/workspace/7/docs/`).path, 'docs/index.html')
})

test('nested relative CSS and JavaScript stay inside the same virtual revision', () => {
  const page = new URL(`${origin}/preview/i/w/3/pages/about/index.html`)
  const stylesheet = new URL('../../styles/site.css', page)
  const script = new URL('../../src/main.js', page)

  assert.equal(parsePreviewUrl(stylesheet.href).path, 'styles/site.css')
  assert.equal(parsePreviewUrl(script.href).path, 'src/main.js')
  assert.equal(parsePreviewUrl(stylesheet.href).revision, '3')
  assert.equal(parsePreviewUrl(script.href).revision, '3')
})

test('leaves external HTTP resources on the normal network', async () => {
  const external = 'https://cdn.test/preview/i/w/3/library.js'
  assert.deepEqual(parsePreviewUrl(external, origin), { kind: 'outside' })
  assert.equal(
    await servePreviewRequest(new Request(external), new MemoryCacheStorage(), origin),
    null,
  )
})

test('publishes modules and runtime JSON with their workspace MIME types', async () => {
  const workspace = createVirtualWorkspace([
    { name: 'index.html', content: '<script type="module" src="./src/main.js"></script>' },
    { name: 'src/main.js', content: 'fetch("../data/config.json")' },
    { name: 'data/config.json', content: '{"enabled":true}' },
  ])
  const memory = new MemoryCacheStorage()
  const indexUrl = await publishPreviewSnapshot({
    cacheStorage: cacheStorage(memory),
    instanceId: 'i',
    origin,
    revision: workspace.revision,
    snapshot: workspace.snapshot(),
    workspaceId: 'w',
  })

  const moduleResponse = await servePreviewRequest(
    new Request(new URL('./src/main.js', indexUrl)),
    memory,
  )
  const jsonResponse = await servePreviewRequest(
    new Request(new URL('./data/config.json?cache=no', indexUrl)),
    memory,
  )
  assert.equal(moduleResponse?.headers.get('Content-Type'), 'text/javascript')
  assert.equal(await moduleResponse?.text(), 'fetch("../data/config.json")')
  assert.equal(jsonResponse?.headers.get('Content-Type'), 'application/json')
  assert.deepEqual(await jsonResponse?.json(), { enabled: true })
})

test('returns virtual 404s, ignores queries, and supports HEAD', async () => {
  const workspace = createVirtualWorkspace([{ name: 'index.html', content: '<h1>Hello</h1>' }])
  const memory = new MemoryCacheStorage()
  const indexUrl = await publishPreviewSnapshot({
    cacheStorage: cacheStorage(memory),
    instanceId: 'i',
    origin,
    revision: workspace.revision,
    snapshot: workspace.snapshot(),
    workspaceId: 'w',
  })

  const queried = await servePreviewRequest(new Request(`${indexUrl.href}?refresh=2`), memory)
  const head = await servePreviewRequest(new Request(indexUrl, { method: 'HEAD' }), memory)
  const missing = await servePreviewRequest(new Request(new URL('./missing.js', indexUrl)), memory)
  assert.equal(queried?.status, 200)
  assert.match(await queried?.text() ?? '', /<h1>Hello<\/h1>/)
  assert.equal(head?.status, 200)
  assert.equal(await head?.text(), '')
  assert.equal(missing?.status, 404)
  assert.match(await missing?.text() ?? '', /Preview file not found: missing\.js/)
})

test('rejects traversal and malformed encodings without using the network', async () => {
  const traversal = parsePreviewUrl(`${origin}/preview/i/w/1/%2e%2e%2fsecret.txt`)
  const malformed = parsePreviewUrl(`${origin}/preview/i/w/1/%E0%A4%A`)
  assert.equal(traversal.kind, 'invalid')
  assert.equal(malformed.kind, 'invalid')
  assert.throws(() => normalizePreviewPath('../secret.txt'), /escapes/)

  const response = await servePreviewRequest(
    new Request(`${origin}/preview/i/w/1/%2e%2e%2fsecret.txt`),
    new MemoryCacheStorage(),
  )
  assert.equal(response?.status, 400)
})

test('excludes .agent files from preview publication', async () => {
  const workspace = createVirtualWorkspace([
    { name: 'index.html', content: '<h1>Public</h1>' },
    { name: '.agent/layla-sdk/SKILL.md', content: 'private guidance' },
  ])
  const memory = new MemoryCacheStorage()
  const indexUrl = await publishPreviewSnapshot({
    cacheStorage: cacheStorage(memory),
    instanceId: 'i',
    origin,
    revision: workspace.revision,
    snapshot: workspace.snapshot(),
    workspaceId: 'w',
  })
  const privateUrl = new URL('./.agent/layla-sdk/SKILL.md', indexUrl)
  const response = await servePreviewRequest(new Request(privateUrl), memory)
  assert.equal(response?.status, 404)
  assert.equal([...memory.caches.values()][0]?.entries.has(privateUrl.href), false)
})

test('decodes imported data-URL images into response bytes', async () => {
  const file = createVirtualWorkspace([{
    name: 'pixel.png',
    content: 'data:image/png;base64,iVBORw0KGgo=',
    mimeType: 'image/png',
  }]).readFile('pixel.png')
  const response = createPreviewFileResponse({
    name: file.path,
    content: file.content,
    mimeType: file.mimeType,
    size: file.size,
    revision: file.revision,
    updatedAt: file.updatedAt,
  })
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(response.headers.get('Content-Type'), 'image/png')
})

test('decodes imported non-image binary files into response bytes', async () => {
  const response = createPreviewFileResponse({
    name: 'manual.pdf',
    content: 'data:application/pdf;base64,AQIDBA==',
    mimeType: 'application/pdf',
    size: 4,
    revision: '1-test',
    updatedAt: 1,
  })

  assert.equal(response.headers.get('Content-Type'), 'application/pdf')
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4])
})

test('injects the bridge into every HTML response without mutating source', async () => {
  const source = '<!doctype html><script>start()</script>'
  const workspace = createVirtualWorkspace([
    { name: 'index.html', content: source },
    { name: 'pages/next.html', content: '<script>next()</script>' },
  ])
  const before = workspace.snapshot()
  const rootResponse = createPreviewFileResponse(before.files.find(file => file.name === 'index.html')!)
  const nestedResponse = createPreviewFileResponse(before.files.find(file => file.name === 'pages/next.html')!)

  assert.match(await rootResponse.text(), new RegExp(PREVIEW_BRIDGE_CHANNEL))
  assert.match(await nestedResponse.text(), new RegExp(PREVIEW_BRIDGE_CHANNEL))
  assert.equal(workspace.readFile('index.html').content, source)
})

test('keeps two revisions of the same path isolated', async () => {
  const workspace = createVirtualWorkspace([{ name: 'index.html', content: '<h1>one</h1>' }])
  const first = workspace.snapshot()
  workspace.writeFile('index.html', '<h1>two</h1>')
  const second = workspace.snapshot()
  const memory = new MemoryCacheStorage()

  const firstUrl = await publishPreviewSnapshot({
    cacheStorage: cacheStorage(memory), instanceId: 'i', origin,
    revision: first.revision, snapshot: first, workspaceId: 'w',
  })
  const secondUrl = await publishPreviewSnapshot({
    cacheStorage: cacheStorage(memory), instanceId: 'i', origin,
    revision: second.revision, snapshot: second, workspaceId: 'w',
  })
  const firstResponse = await servePreviewRequest(new Request(firstUrl), memory)
  const secondResponse = await servePreviewRequest(new Request(secondUrl), memory)
  assert.match(await firstResponse?.text() ?? '', /<h1>one<\/h1>/)
  assert.match(await secondResponse?.text() ?? '', /<h1>two<\/h1>/)
})

test('builds versioned URLs and reports an index-only fallback without Service Workers', () => {
  const base = previewRevisionBaseUrl(origin, 'instance', 'workspace', 12)
  assert.equal(previewFileUrl(base, 'src/main.js').href, `${origin}/preview/instance/workspace/12/src/main.js`)

  const capability = detectPreviewCapability({
    isSecureContext: true,
    cacheStorage: {} as CacheStorage,
  })
  assert.deepEqual(capability, {
    supported: false,
    diagnostic: 'Service Workers are unavailable; using index-only preview.',
  })
})
