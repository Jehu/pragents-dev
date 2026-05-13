/**
 * useSSE — Server-Sent Events hook for the pragents web UI.
 *
 * Uses the native EventSource API to connect to GET /api/v1/events/stream.
 * Falls back gracefully if SSE is unavailable.
 * Pushes all received events into the eventBus Zustand store.
 */

import { useEventBusStore, type SseEvent } from '../stores/eventBus';

type EventCallback = (event: any) => void;

let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let maxRetries = 30;
let retryCount = 0;
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

function normalizeToBusEvent(raw: any): SseEvent {
  return {
    id: raw.id,
    type: raw.type ?? 'unknown',
    agentId: raw.agentId ?? raw.agent_id,
    projectId: raw.projectId ?? raw.project_id,
    taskId: raw.taskId ?? raw.task_id,
    data: raw,
    ts: raw.ts ?? Date.now(),
  };
}

export function connectSSE(options: SSEOptions = {}): void {
  if (options.onEvent) listeners.push(options.onEvent);

  const store = useEventBusStore.getState();
  store.setConnectionStatus('connecting');

  const url = buildURL(options.project);

  try {
    es = new EventSource(url);
  } catch {
    store.setConnectionStatus('disconnected');
    return;
  }

  es.onopen = () => {
    retryCount = 0;
    retryDelay = 1000;
    useEventBusStore.getState().setConnectionStatus('connected');
    options.onConnect?.();
    listeners.forEach((l) => l({ type: 'sse_connected' }));
  };

  es.onmessage = (event) => {
    try {
      const raw = JSON.parse(event.data);
      // Push to event bus store
      useEventBusStore.getState().pushEvent(normalizeToBusEvent(raw));
      listeners.forEach((l) => l(raw));
    } catch { /* ignore malformed data */ }
  };

  es.onerror = () => {
    useEventBusStore.getState().setConnectionStatus('disconnected');
    options.onDisconnect?.();
    listeners.forEach((l) => l({ type: 'sse_disconnected' }));
    scheduleReconnect(options);
  };
}

function scheduleReconnect(options: SSEOptions): void {
  if (reconnectTimer) return;
  if (retryCount >= maxRetries) return;
  retryCount++;

  // EventSource auto-reconnects, but if it fails completely, we recreate
  if (es) {
    es.close();
    es = null;
  }

  const delay = Math.min(retryDelay * Math.pow(2, Math.min(retryCount - 1, 5)), 30_000);
  const jitter = Math.random() * 1000;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    retryDelay = delay;
    useEventBusStore.getState().setConnectionStatus('connecting');
    connectSSE(options);
  }, delay + jitter);
}

export function disconnectSSE(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  retryCount = maxRetries; // prevent further reconnects
  es?.close();
  es = null;
  useEventBusStore.getState().setConnectionStatus('disconnected');
}

/** Reset retry counter (call after explicit re-connect) */
export function resetSSERetries(): void {
  retryCount = 0;
  retryDelay = 1000;
}

/**
 * Returns true if SSE (EventSource) is available in this browser.
 */
export function isSSEAvailable(): boolean {
  return typeof EventSource !== 'undefined';
}
