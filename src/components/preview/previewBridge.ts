export const PREVIEW_BRIDGE_CHANNEL = 'layla-mini-app-preview'

export type PreviewBridgeRequest = {
  channel: typeof PREVIEW_BRIDGE_CHANNEL
  direction: 'to-host'
  message: string
}

export type PreviewConsoleLevel = 'debug' | 'error' | 'info' | 'log' | 'warn'

export type PreviewConsoleMessage = {
  channel: typeof PREVIEW_BRIDGE_CHANNEL
  direction: 'console'
  level: PreviewConsoleLevel
  method: string
  args: string[]
  timestamp: number
}

const previewBridgeBootstrap = `<script>
(() => {
  const channel = ${JSON.stringify(PREVIEW_BRIDGE_CHANNEL)};
  const maxArgumentLength = 20000;

  const serialize = (value) => {
    if (typeof value === 'string') return value.slice(0, maxArgumentLength);
    if (value === null) return 'null';
    if (typeof value === 'bigint') return value.toString() + 'n';
    if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'undefined') return 'undefined';
    if (value instanceof Error) {
      return (value.stack || (value.name + ': ' + value.message)).slice(0, maxArgumentLength);
    }

    try {
      const seen = new WeakSet();
      const serialized = JSON.stringify(value, (_key, current) => {
        if (typeof current === 'bigint') return current.toString() + 'n';
        if (typeof current === 'function') return '[Function ' + (current.name || 'anonymous') + ']';
        if (typeof current === 'symbol') return current.toString();
        if (current instanceof Error) {
          return { name: current.name, message: current.message, stack: current.stack };
        }
        if (typeof Element !== 'undefined' && current instanceof Element) {
          return current.outerHTML;
        }
        if (current && typeof current === 'object') {
          if (seen.has(current)) return '[Circular]';
          seen.add(current);
        }
        return current;
      }, 2);

      return (serialized === undefined ? String(value) : serialized).slice(0, maxArgumentLength);
    } catch {
      try {
        return String(value).slice(0, maxArgumentLength);
      } catch {
        return '[Unserializable value]';
      }
    }
  };

  const emitConsole = (method, level, args) => {
    window.parent.postMessage({
      channel,
      direction: 'console',
      level,
      method,
      args: args.map(serialize),
      timestamp: Date.now(),
    }, '*');
  };

  const capturedMethods = {
    debug: 'debug',
    dir: 'log',
    dirxml: 'log',
    error: 'error',
    info: 'info',
    log: 'log',
    table: 'log',
    trace: 'debug',
    warn: 'warn',
  };

  Object.entries(capturedMethods).forEach(([method, level]) => {
    const original = window.console[method];
    if (typeof original !== 'function') return;

    window.console[method] = (...args) => {
      original.apply(window.console, args);
      emitConsole(method, level, args);
    };
  });

  const originalAssert = window.console.assert;
  if (typeof originalAssert === 'function') {
    window.console.assert = (condition, ...args) => {
      originalAssert.call(window.console, condition, ...args);
      if (!condition) emitConsole('assert', 'error', args.length ? args : ['Assertion failed']);
    };
  }

  window.addEventListener('error', (event) => {
    const location = event.filename
      ? ' (' + event.filename + ':' + event.lineno + ':' + event.colno + ')'
      : '';
    emitConsole('uncaught', 'error', [event.error || event.message + location]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    emitConsole('unhandledrejection', 'error', ['Unhandled promise rejection', event.reason]);
  });

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

/** Phones use overlay scrollbars, so hide the desktop ones and keep the preview viewport a true 390px wide. */
const previewMobileChrome = `<style>
  html, body { scrollbar-width: none; }
  ::-webkit-scrollbar { width: 0; height: 0; }
</style>`

export function injectPreviewBridge(indexHtml: string) {
  const doctype = indexHtml.match(/^\s*<!doctype[^>]*>/i)
  const insertionPoint = doctype?.[0].length ?? 0

  return `${indexHtml.slice(0, insertionPoint)}${previewBridgeBootstrap}${previewMobileChrome}${indexHtml.slice(insertionPoint)}`
}

export function isPreviewBridgeRequest(value: unknown): value is PreviewBridgeRequest {
  if (!value || typeof value !== 'object') return false

  const request = value as Partial<PreviewBridgeRequest>
  return request.channel === PREVIEW_BRIDGE_CHANNEL
    && request.direction === 'to-host'
    && typeof request.message === 'string'
}

export function isPreviewConsoleMessage(value: unknown): value is PreviewConsoleMessage {
  if (!value || typeof value !== 'object') return false

  const message = value as Partial<PreviewConsoleMessage>
  return message.channel === PREVIEW_BRIDGE_CHANNEL
    && message.direction === 'console'
    && ['debug', 'error', 'info', 'log', 'warn'].includes(message.level ?? '')
    && typeof message.method === 'string'
    && Array.isArray(message.args)
    && message.args.every(argument => typeof argument === 'string')
    && typeof message.timestamp === 'number'
    && Number.isFinite(message.timestamp)
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
