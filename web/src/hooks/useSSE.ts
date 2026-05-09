/**
 * useSSE — Server-Sent Events hook for the pragents web UI.
 *
 * Uses the native EventSource API to connect to GET /api/v1/events/stream.
 * Falls back gracefully if SSE is unavailable.
 */

type EventCallback = (event: any) => void;

let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
const listeners: EventCallback[] = [];

export interface SSEOptions {
  /** Filter events to a single project */
  project?: string;
  /** Callback for each event */
  onEvent?: EventCallback;
  /** Called when connected */
  onConnect?: () => void;
  /** Called when disconnected */
  onDisconnect?: () => void;
}

function buildURL(project?: string): string {
  const base = `${location.protocol}//${location.host}/api/v1/events/stream`;
  if (project) {
    return `${base}?project=${encodeURIComponent(project)}`;
  }
  return base;
}

export function connectSSE(options: SSEOptions = {}): void {
  if (options.onEvent) listeners.push(options.onEvent);

  const url = buildURL(options.project);

  try {
    es = new EventSource(url);
  } catch {
    return;
  }

  es.onopen = () => {
    (window as any).__sseRetries = 0;
    retryDelay = 1000;
    options.onConnect?.();
    listeners.forEach((l) => l({ type: 'sse_connected' }));
  };

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      listeners.forEach((l) => l(data));
    } catch { /* ignore malformed data */ }
  };

  es.onerror = () => {
    options.onDisconnect?.();
    listeners.forEach((l) => l({ type: 'sse_disconnected' }));
    scheduleReconnect(options);
  };
}

function scheduleReconnect(options: SSEOptions): void {
  if (reconnectTimer) return;
  // Max 15 reconnects then stop
  let retryCount = (window as any).__sseRetries || 0;
  if (retryCount >= 15) return;
  (window as any).__sseRetries = retryCount + 1;
  // EventSource auto-reconnects, but if it fails completely, we recreate
  if (es) {
    es.close();
    es = null;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    retryDelay = Math.min(retryDelay * 2, 30000);
    connectSSE(options);
  }, retryDelay + Math.random() * 1000);
}

export function disconnectSSE(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  es?.close();
  es = null;
}

/**
 * Returns true if SSE (EventSource) is available in this browser.
 */
export function isSSEAvailable(): boolean {
  return typeof EventSource !== 'undefined';
}
