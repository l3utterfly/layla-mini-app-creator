import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {
  PREVIEW_BRIDGE_CHANNEL,
  createPreviewBridgeError,
  injectPreviewBridge,
  isLaylaHostEventMessage,
  isPreviewBridgeRequest,
  isPreviewConsoleMessage,
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
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const previewConsole = {
    assert: () => undefined,
    debug: () => undefined,
    dir: () => undefined,
    dirxml: () => undefined,
    error: () => undefined,
    info: () => undefined,
    log: () => undefined,
    table: () => undefined,
    trace: () => undefined,
    warn: () => undefined,
  }
  const previewWindow: {
    addEventListener: (name: string, listener: (...args: unknown[]) => void) => void
    console: typeof previewConsole
    parent: { postMessage: (...args: unknown[]) => void }
    ReactNativeWebView?: { postMessage: (message: string) => void }
  } = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    console: previewConsole,
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

test('the injected console mirror serializes log arguments safely', () => {
  const bridged = injectPreviewBridge('<main>Preview</main>')
  const bootstrap = bridged.match(/^<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(bootstrap)

  const posted: unknown[][] = []
  const previewConsole = {
    assert: () => undefined,
    debug: () => undefined,
    dir: () => undefined,
    dirxml: () => undefined,
    error: () => undefined,
    info: () => undefined,
    log: () => undefined,
    table: () => undefined,
    trace: () => undefined,
    warn: () => undefined,
  }
  const previewWindow = {
    addEventListener: () => undefined,
    console: previewConsole,
    parent: { postMessage: (...args: unknown[]) => posted.push(args) },
  }

  vm.runInNewContext(bootstrap, { window: previewWindow, Element: undefined })
  const circular: { self?: unknown } = {}
  circular.self = circular
  previewConsole.warn('Watch out', circular, 12n)

  const message = posted[0]?.[0]
  assert.equal(isPreviewConsoleMessage(message), true)
  assert.deepEqual(JSON.parse(JSON.stringify(message)), {
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'console',
    level: 'warn',
    method: 'warn',
    args: ['Watch out', '{\n  "self": "[Circular]"\n}', '12n'],
    timestamp: (message as { timestamp: number }).timestamp,
  })
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

test('recognizes only safely serialized preview console messages', () => {
  assert.equal(isPreviewConsoleMessage({
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'console',
    level: 'error',
    method: 'unhandledrejection',
    args: ['Unhandled promise rejection', 'Error: nope'],
    timestamp: Date.now(),
  }), true)
  assert.equal(isPreviewConsoleMessage({
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'console',
    level: 'error',
    method: 'error',
    args: [new Error('not cloned')],
    timestamp: Date.now(),
  }), false)
  assert.equal(isPreviewConsoleMessage({
    channel: PREVIEW_BRIDGE_CHANNEL,
    direction: 'console',
    level: 'log',
    method: 'log',
    args: ['invalid timestamp'],
    timestamp: Number.NaN,
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
