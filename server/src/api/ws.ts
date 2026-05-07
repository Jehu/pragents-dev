import type { ServerWebSocket } from 'bun';
import { EventBuffer, type PragentsEvent } from '../events/buffer.js';

export function setupWebSocket(app: any, buffer: EventBuffer) {
  // Using Hono's WebSocket helper
  try {
    const { upgradeWebSocket } = require('@hono/node-ws');

    app.get(
      '/ws',
      upgradeWebSocket((c: any) => ({
        onOpen(_event: any, ws: ServerWebSocket<any>) {
          console.log('WebSocket client connected');
        },
        onMessage(event: any, ws: ServerWebSocket<any>) {
          try {
            const msg = JSON.parse(event.data.toString());
            if (msg.type === 'subscribe' && msg.lastEventId !== undefined) {
              const events = buffer.getSince(msg.lastEventId, msg.projectId);
              ws.send(JSON.stringify({ type: 'replay', events }));
            }
          } catch { /* ignore invalid messages */ }
        },
        onClose() {
          console.log('WebSocket client disconnected');
        },
      })),
    );
  } catch {
    console.warn('WebSocket support requires @hono/node-ws. Install with: npm install @hono/node-ws');
  }
}

export function broadcast(buffer: EventBuffer, event: PragentsEvent, app: any): void {
  // Events are buffered; clients pull on reconnect
  // Real-time push requires tracking connected clients
  buffer.push(event.projectId, event.agentId, event.type, event.data);
}
