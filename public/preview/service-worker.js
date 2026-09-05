import { parsePreviewUrl, servePreviewRequest } from './sw-core.js'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  if (parsePreviewUrl(event.request.url, self.location.origin).kind === 'outside') return
  event.respondWith(servePreviewRequest(event.request, caches, self.location.origin))
})
