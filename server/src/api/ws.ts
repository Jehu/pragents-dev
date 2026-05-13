import { EventBuffer, type PragentsEvent } from '../events/buffer.js';
import { logger } from '../logging/index.js';

// Hot-reload safe singleton: survives tsx-watch module re-execution (issue #32)
const g = globalThis as any;
if (!g.__pragentsWsClients) g.__pragentsWsClients = new Set<any>();
const wsClients: Set<any> = g.__pragentsWsClients;

export async function setupWebSocket(app: any, buffer: EventBuffer) {
  try {
    const { createNodeWebSocket } = await import('@hono/node-ws');
    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

    app.get(
      '/ws',
      upgradeWebSocket(() => ({
        onOpen(_event: any, ws: any) {
          wsClients.add(ws);
          const events = buffer.getRecent(50);
          ws.send(JSON.stringify({ type: 'replay', events }));
        },
        onMessage(event: any, ws: any) {
          try {
            const msg = JSON.parse(event.data.toString());
            if (msg.type === 'subscribe' && msg.lastEventId !== undefined) {
              const events = buffer.getSince(msg.lastEventId, msg.projectId);
              ws.send(JSON.stringify({ type: 'replay', events }));
            }
          } catch { /* ignore */ }
        },
        onClose(_event: any, ws: any) {
          wsClients.delete(ws);
        },
      })),
    );
    logger.info('WebSocket endpoint ready at /ws');
    return injectWebSocket;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'WebSocket not available');
    return null;
  }
}

export function broadcast(event: PragentsEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { wsClients.delete(ws); }
  }
}
