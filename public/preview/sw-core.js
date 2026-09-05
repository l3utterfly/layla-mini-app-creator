export const PREVIEW_CACHE_NAME = 'layla-mini-app-preview-v1'
export const PREVIEW_SCOPE = '/preview/'

const workerAssets = new Set([
  `${PREVIEW_SCOPE}service-worker.js`,
  `${PREVIEW_SCOPE}sw-core.js`,
])

function decodeSegment(value) {
  const decoded = decodeURIComponent(value)
  if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
    throw new Error('Invalid virtual identifier.')
  }
  return decoded
}

export function normalizePreviewPath(value, directory = false) {
  let decoded
  try {
    decoded = decodeURIComponent(value).replaceAll('\\', '/')
  } catch {
    throw new Error('Malformed preview path encoding.')
  }

  if (decoded.includes('\0') || decoded.startsWith('/')) {
    throw new Error('The preview path escapes its workspace.')
  }
  const segments = decoded.split('/').filter(segment => segment && segment !== '.')
  if (segments.includes('..')) throw new Error('The preview path escapes its workspace.')
  if (!segments.length) return 'index.html'
  if (directory || decoded.endsWith('/')) segments.push('index.html')
  return segments.join('/')
}

function encodedPath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Distinguishes worker assets, malformed virtual requests, and preview files. */
export function parsePreviewUrl(input, expectedOrigin) {
  let url
  try {
    url = new URL(input)
  } catch {
    return { kind: 'outside' }
  }

  if (
    (expectedOrigin && url.origin !== expectedOrigin)
    || !url.pathname.startsWith(PREVIEW_SCOPE)
    || workerAssets.has(url.pathname)
  ) {
    return { kind: 'outside' }
  }

  const parts = url.pathname.slice(PREVIEW_SCOPE.length).split('/')
  if (parts.length < 3) return { kind: 'invalid', reason: 'Malformed virtual preview URL.' }

  try {
    const instanceId = decodeSegment(parts[0])
    const workspaceId = decodeSegment(parts[1])
    const revision = decodeSegment(parts[2])
    const rawPath = parts.slice(3).join('/')
    const path = normalizePreviewPath(rawPath, url.pathname.endsWith('/'))
    const base = `${PREVIEW_SCOPE}${encodeURIComponent(instanceId)}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(revision)}/`
    return {
      kind: 'file',
      instanceId,
      workspaceId,
      revision,
      path,
      cacheUrl: `${url.origin}${base}${encodedPath(path)}`,
    }
  } catch (error) {
    return {
      kind: 'invalid',
      reason: error instanceof Error ? error.message : 'Invalid virtual preview URL.',
    }
  }
}

function plainResponse(message, status, headers = {}) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      ...headers,
    },
  })
}

/** Returns null only for requests that should continue to the normal network. */
export async function servePreviewRequest(request, cacheStorage = caches, expectedOrigin) {
  const parsed = parsePreviewUrl(request.url, expectedOrigin)
  if (parsed.kind === 'outside') return null
  if (parsed.kind === 'invalid') return plainResponse(parsed.reason, 400)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return plainResponse('Method not allowed for virtual preview files.', 405, { Allow: 'GET, HEAD' })
  }

  const cache = await cacheStorage.open(PREVIEW_CACHE_NAME)
  const cached = await cache.match(new Request(parsed.cacheUrl, { method: 'GET' }))
  if (!cached) return plainResponse(`Preview file not found: ${parsed.path}`, 404)
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
    })
  }
  return cached
}
