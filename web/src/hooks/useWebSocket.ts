let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;

type EventCallback = (event: any) => void;
const listeners: EventCallback[] = [];

export function connectWebSocket(onEvent?: EventCallback) {
  if (onEvent) listeners.push(onEvent);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

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
    connectWebSocket();
  }, retryDelay + Math.random() * 1000);
}

export function disconnectWebSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}
