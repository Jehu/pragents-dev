import { EventBuffer, type PragentsEvent } from '../events/buffer.js';
import { logger } from '../logging/index.js';
import { checkWsAuth } from './middleware/auth.js';
import { consumeWsTicket } from './middleware/ws-ticket.js';

// Hot-reload safe singleton: survives tsx-watch module re-execution (issue #32)
const g = globalThis as any;
if (!g.__pragentsWsClients) g.__pragentsWsClients = new Set<any>();
const wsClients: Set<any> = g.__pragentsWsClients;

export async function setupWebSocket(
  app: any,
  buffer: EventBuffer,
  getToken: () => string = () => process.env.PRAGENTS_API_TOKEN || '',
) {
  try {
    const { createNodeWebSocket } = await import('@hono/node-ws');
    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

    // Auth gate: runs before the upgrade. On failure we return 401 instead of
    // accepting the socket — the client never gets a connection.
    app.use('/ws', async (c: any, next: any) => {
      const expected = getToken();
      const incoming = (c.env as any)?.incoming;
      const result = checkWsAuth(
        {
          url: c.req.url,
          headers: incoming?.headers ?? Object.fromEntries(
            // Hono's c.req.raw.headers is a Headers instance; flatten for our helper.
            (() => {
              try {
                const h: Headers = c.req.raw.headers;
                return [...h.entries()];
              } catch {
                return [];
              }
            })(),
          ),
          socket: incoming?.socket,
        },
        expected,
      );
      if (!result.ok) {
        // Fallback: short-lived single-use ticket minted via POST /api/v1/ws-ticket
        // (browsers cannot set an Authorization header on a WebSocket upgrade).
        let ticketOk = false;
        try {
          const ticket = new URL(c.req.url, 'http://localhost').searchParams.get('ticket');
          ticketOk = !!ticket && consumeWsTicket(ticket);
        } catch { /* malformed url */ }
        if (!ticketOk) {
          return c.json(
            {
              error: 'Unauthorized',
              hint: 'use Authorization: Bearer header, or POST /api/v1/ws-ticket for a WebSocket ticket',
            },
            401,
          );
        }
      }
      return next();
    });

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
