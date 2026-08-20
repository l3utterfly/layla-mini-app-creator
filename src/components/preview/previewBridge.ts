export const PREVIEW_BRIDGE_CHANNEL = 'layla-mini-app-preview'

export type PreviewBridgeRequest = {
  channel: typeof PREVIEW_BRIDGE_CHANNEL
  direction: 'to-host'
  message: string
}

const previewBridgeBootstrap = `<script>
(() => {
  const channel = ${JSON.stringify(PREVIEW_BRIDGE_CHANNEL)};

  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: Object.freeze({
      postMessage(message) {
        if (typeof message !== 'string') {
          throw new TypeError('ReactNativeWebView.postMessage expects a string.');
        }

        window.parent.postMessage({
          channel,
          direction: 'to-host',
          message,
        }, '*');
      },
    }),
  });
})();
</script>`

export function injectPreviewBridge(indexHtml: string) {
  const doctype = indexHtml.match(/^\s*<!doctype[^>]*>/i)
  const insertionPoint = doctype?.[0].length ?? 0

  return `${indexHtml.slice(0, insertionPoint)}${previewBridgeBootstrap}${indexHtml.slice(insertionPoint)}`
}

export function isPreviewBridgeRequest(value: unknown): value is PreviewBridgeRequest {
  if (!value || typeof value !== 'object') return false

  const request = value as Partial<PreviewBridgeRequest>
  return request.channel === PREVIEW_BRIDGE_CHANNEL
    && request.direction === 'to-host'
    && typeof request.message === 'string'
}

export function isLaylaHostEventMessage(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    const event = JSON.parse(value) as { event?: unknown } | null
    return !!event && typeof event === 'object' && typeof event.event === 'string'
  } catch {
    return false
  }
}

export function createPreviewBridgeError(message: string) {
  return JSON.stringify({ event: 'on_error', data: { message } })
}
