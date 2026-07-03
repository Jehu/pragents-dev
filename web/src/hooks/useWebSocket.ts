let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
// Bumped on disconnect so an in-flight ticket fetch cannot open a stale socket.
let generation = 0;

type EventCallback = (event: any) => void;
const listeners: EventCallback[] = [];

/**
 * Fetch a short-lived, single-use WS ticket (POST /api/v1/ws-ticket).
 * Returns null when unavailable — the caller then connects bare, which still
 * works on localhost (auth bypass). Tickets are single-use, so every
 * (re)connect fetches a fresh one.
 */
async function fetchWsTicket(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/ws-ticket', { method: 'POST' });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.ticket === 'string' ? body.ticket : null;
  } catch {
    return null;
  }
}

export async function connectWebSocket(onEvent?: EventCallback) {
  if (onEvent) listeners.push(onEvent);

  const myGeneration = generation;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = `${protocol}//${location.host}/ws`;
  const ticket = await fetchWsTicket();
  if (myGeneration !== generation) return; // disconnected while fetching the ticket
  const wsUrl = ticket ? `${baseUrl}?ticket=${encodeURIComponent(ticket)}` : baseUrl;

  try {
    ws = new WebSocket(wsUrl);
  } catch { return; }

  ws.onopen = () => {
    retryDelay = 1000;
    listeners.forEach((l) => l({ type: 'ws_connected' }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      listeners.forEach((l) => l(data));
    } catch {}
  };

  ws.onclose = () => {
    listeners.forEach((l) => l({ type: 'ws_disconnected' }));
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    retryDelay = Math.min(retryDelay * 2, 30000);
    void connectWebSocket();
  }, retryDelay + Math.random() * 1000);
}

export function disconnectWebSocket() {
  generation++;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  listeners.length = 0;
  ws?.close();
  ws = null;
}
