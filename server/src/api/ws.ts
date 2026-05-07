import { EventBuffer, type PragentsEvent } from '../events/buffer.js';

const wsClients: Set<any> = new Set();

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
    console.log('WebSocket endpoint ready at /ws');
    return injectWebSocket;
  } catch (err: any) {
    console.warn(`WebSocket not available: ${err.message}`);
    return null;
  }
}

export function broadcast(event: PragentsEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { wsClients.delete(ws); }
  }
}
