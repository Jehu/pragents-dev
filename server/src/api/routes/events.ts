import { Hono } from 'hono';
import type { EventBuffer, PragentsEvent } from '../../events/buffer.js';

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * SSE manager: tracks active SSE connections so the broadcast
 * path can push to both WebSocket and SSE clients.
 */
const sseClients: Set<{ projectId?: string; write: (data: string) => void }> = new Set();

export function broadcastSSE(event: PragentsEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    // Only send if no project filter or project matches
    if (!client.projectId || client.projectId === event.projectId) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

export function createEventsRoute(buffer: EventBuffer): Hono {
  const app = new Hono();

  app.get('/stream', async (c) => {
    const projectId = c.req.query('project') || undefined;
    const lastEventId = c.req.header('Last-Event-ID');

    // SSE requires raw stream access – use the Node http Response
    // that Hono wraps. We fall back gracefully if not available.
    const nodeRes = (c.env?.outgoing ?? c.runtime) as any;

    // Try to get the underlying Node response through different Hono versions
    const res = c.req.raw;
    // @ts-ignore - accessing internal node response
    const underlying: any = nodeRes ?? res?.[Symbol.for('hono-node-res')];

    // Build SSE headers
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    };

    // Stream helper
    const client = { projectId, write: (_data: string) => {} };
    let closed = false;

    // Use Response + ReadableStream approach (works in all Hono runtimes)
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        client.write = (data: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            closed = true;
            sseClients.delete(client);
            try { controller.close(); } catch {}
          }
        };

        sseClients.add(client);

        // Replay missed events if Last-Event-ID provided
        if (lastEventId) {
          const sinceId = parseInt(lastEventId, 10);
          if (!isNaN(sinceId)) {
            const missed = buffer.getSince(sinceId, projectId);
            for (const evt of missed) {
              client.write(`data: ${JSON.stringify(evt)}\n\n`);
            }
          }
        } else {
          // Send recent events on initial connect
          const recent = buffer.getRecent(50, projectId);
          for (const evt of recent) {
            client.write(`data: ${JSON.stringify(evt)}\n\n`);
          }
        }

        // Heartbeat keep-alive
        const heartbeat = setInterval(() => {
          if (closed) {
            clearInterval(heartbeat);
            return;
          }
          // SSE comment as keep-alive (ignored by EventSource but keeps connection alive)
          client.write(': heartbeat\n\n');
        }, HEARTBEAT_INTERVAL_MS);

        // Handle abort / client disconnect
        const onClose = () => {
          closed = true;
          clearInterval(heartbeat);
          sseClients.delete(client);
          try { controller.close(); } catch {}
        };

        // AbortSignal is the standard way to detect client disconnect in ReadableStream
        if (res.signal) {
          res.signal.addEventListener('abort', onClose, { once: true });
        }

        // Also handle request close through the Node request
        // This covers older environments where AbortSignal might not fire
        const rawReq = c.req.raw;
        if (rawReq.signal) {
          rawReq.signal.addEventListener('abort', onClose, { once: true });
        }
      },
      cancel() {
        closed = true;
        sseClients.delete(client);
      },
    });

    return new Response(stream, { status: 200, headers });
  });

  // REST endpoint for polling (complements SSE)
  app.get('/', (c) => {
    const projectId = c.req.query('project') || undefined;
    const since = c.req.query('since');
    if (since) {
      const events = buffer.getSince(parseInt(since, 10), projectId);
      return c.json({ events });
    }
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const events = buffer.getRecent(limit, projectId);
    return c.json({ events });
  });

  return app;
}
