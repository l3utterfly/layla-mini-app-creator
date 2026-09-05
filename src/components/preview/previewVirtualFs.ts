import { exportableWorkspaceFiles, isStoredBinaryFile, workspaceFileBytes } from '../../workspace/exportWorkspace.ts'
import type { VirtualWorkspaceFile, VirtualWorkspaceSnapshot } from '../../workspace/index.ts'
import { injectPreviewBridge } from './previewBridge.ts'

export const PREVIEW_CACHE_NAME = 'layla-mini-app-preview-v1'
export const PREVIEW_SCOPE = '/preview/'
export const PREVIEW_SERVICE_WORKER_URL = '/preview/service-worker.js'

type PreviewCapabilityInput = {
  isSecureContext: boolean
  serviceWorker?: ServiceWorkerContainer
  cacheStorage?: CacheStorage
}

export type PreviewCapability =
  | {
      supported: true
      cacheStorage: CacheStorage
      serviceWorker: ServiceWorkerContainer
    }
  | {
      supported: false
      diagnostic: string
    }

type PublishPreviewSnapshotOptions = {
  cacheStorage: CacheStorage
  instanceId: string
  origin: string
  revision: number
  snapshot: VirtualWorkspaceSnapshot
  workspaceId: string
}

let serviceWorkerRegistration: Promise<ServiceWorkerRegistration> | null = null

export function detectPreviewCapability(input: PreviewCapabilityInput): PreviewCapability {
  if (!input.isSecureContext) {
    return { supported: false, diagnostic: 'Multi-file preview needs a secure context.' }
  }
  if (!input.serviceWorker) {
    return { supported: false, diagnostic: 'Service Workers are unavailable; using index-only preview.' }
  }
  if (!input.cacheStorage) {
    return { supported: false, diagnostic: 'Cache Storage is unavailable; using index-only preview.' }
  }
  return {
    supported: true,
    cacheStorage: input.cacheStorage,
    serviceWorker: input.serviceWorker,
  }
}

export function detectBrowserPreviewCapability() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, diagnostic: 'Browser preview APIs are unavailable.' } as const
  }
  try {
    return detectPreviewCapability({
      isSecureContext: window.isSecureContext,
      serviceWorker: navigator.serviceWorker,
      cacheStorage: window.caches,
    })
  } catch {
    return { supported: false, diagnostic: 'Browser preview APIs are unavailable.' } as const
  }
}

export function createPreviewInstanceId() {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const values = crypto.getRandomValues(new Uint32Array(4))
    return [...values].map(value => value.toString(36)).join('-')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function encodedSegment(value: string | number) {
  return encodeURIComponent(String(value))
}

export function previewRevisionBaseUrl(
  origin: string,
  instanceId: string,
  workspaceId: string,
  revision: number,
) {
  return new URL(
    `${PREVIEW_SCOPE}${encodedSegment(instanceId)}/${encodedSegment(workspaceId)}/${encodedSegment(revision)}/`,
    origin,
  )
}

export function previewFileUrl(baseUrl: URL, path: string) {
  const encodedPath = path.split('/').map(encodedSegment).join('/')
  return new URL(encodedPath, baseUrl)
}

function responseBody(file: VirtualWorkspaceFile, content: string): BodyInit {
  if (!isStoredBinaryFile(file)) return content
  return new Blob([workspaceFileBytes(file)], { type: file.mimeType })
}

export function createPreviewFileResponse(file: VirtualWorkspaceFile) {
  const content = file.mimeType.startsWith('text/html')
    ? injectPreviewBridge(file.content)
    : file.content
  return new Response(responseBody(file, content), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': file.mimeType,
    },
  })
}

/** Publishes every response before returning the URL that is safe to navigate to. */
export async function publishPreviewSnapshot(options: PublishPreviewSnapshotOptions) {
  const { cacheStorage, instanceId, origin, revision, snapshot, workspaceId } = options
  if (snapshot.revision !== revision) {
    throw new Error('The preview revision does not match its workspace snapshot.')
  }

  const baseUrl = previewRevisionBaseUrl(origin, instanceId, workspaceId, revision)
  const files = exportableWorkspaceFiles(snapshot.files)
  const entries = files.map(file => ({
    request: new Request(previewFileUrl(baseUrl, file.name), { method: 'GET' }),
    response: createPreviewFileResponse(file),
  }))
  const cache = await cacheStorage.open(PREVIEW_CACHE_NAME)
  await Promise.all(entries.map(entry => cache.put(entry.request, entry.response)))
  return previewFileUrl(baseUrl, 'index.html')
}

function waitForWorker(worker: ServiceWorker) {
  if (worker.state === 'activated') return Promise.resolve()
  if (worker.state === 'redundant') return Promise.reject(new Error('The preview Service Worker became redundant.'))

  return new Promise<void>((resolve, reject) => {
    const stateChanged = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', stateChanged)
        resolve()
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', stateChanged)
        reject(new Error('The preview Service Worker became redundant.'))
      }
    }
    worker.addEventListener('statechange', stateChanged)
  })
}

export function activatePreviewServiceWorker(serviceWorker: ServiceWorkerContainer) {
  serviceWorkerRegistration ??= serviceWorker
    .register(PREVIEW_SERVICE_WORKER_URL, { scope: PREVIEW_SCOPE, type: 'module' })
    .then(async registration => {
      const worker = registration.active ?? registration.waiting ?? registration.installing
      if (!worker) throw new Error('The preview Service Worker did not install.')
      await waitForWorker(worker)
      return registration
    })
    .catch(error => {
      serviceWorkerRegistration = null
      throw error
    })
  return serviceWorkerRegistration
}
