import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {
  PREVIEW_BRIDGE_CHANNEL,
  createPreviewBridgeError,
  injectPreviewBridge,
  isLaylaHostEventMessage,
  isPreviewBridgeRequest,
} from '../src/components/preview/previewBridge.ts'

test('injects the React Native bridge before preview application scripts', () => {
  const html = '<!doctype html><html><body><script>startMiniApp()</script></body></html>'
  const bridged = injectPreviewBridge(html)

  assert.match(bridged, /^<!doctype html><script>/i)
  assert.ok(bridged.indexOf("Object.defineProperty(window, 'ReactNativeWebView'") < bridged.indexOf('startMiniApp()'))
  assert.match(bridged, new RegExp(PREVIEW_BRIDGE_CHANNEL))
})

test('the injected bridge posts SDK messages to the parent unchanged', () => {
  const bridged = injectPreviewBridge('<main>Preview</main>')
  const bootstrap = bridged.match(/^<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(bootstrap)

  const posted: unknown[][] = []
  const previewWindow: {
    parent: { postMessage: (...args: unknown[]) => void }
    ReactNativeWebView?: { postMessage: (message: string) => void }
  } = {
    parent: {
      postMessage: (...args) => posted.push(args),
    },
  }

  vm.runInNewContext(bootstrap, { window: previewWindow })
  const message = '{"cmd":"get_execution_context","data":null}'
  previewWindow.ReactNativeWebView?.postMessage(message)

  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [[{
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'to-host',
    message,
  }, '*']])
})

test('recognizes only well-formed messages from the preview bridge', () => {
  assert.equal(isPreviewBridgeRequest({
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'to-host',
    message: '{"cmd":"get_execution_context","data":null}',
  }), true)
  assert.equal(isPreviewBridgeRequest({
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'to-host',
    message: null,
  }), false)
  assert.equal(isPreviewBridgeRequest({
    channel: 'another-channel',
    direction: 'to-host',
    message: '{}',
  }), false)
})

test('forwards only serialized Layla host events to the preview', () => {
  assert.equal(isLaylaHostEventMessage('{"event":"on_message","data":{"delta":"Hi"}}'), true)
  assert.equal(isLaylaHostEventMessage('{"cmd":"send_message"}'), false)
  assert.equal(isLaylaHostEventMessage('not json'), false)
  assert.equal(isLaylaHostEventMessage({ event: 'on_message' }), false)

  assert.deepEqual(JSON.parse(createPreviewBridgeError('Host unavailable')), {
    event: 'on_error',
    data: { message: 'Host unavailable' },
  })
})
