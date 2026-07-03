import { Hono } from 'hono';
import { issueWsTicket } from '../middleware/ws-ticket.js';

/**
 * POST /api/v1/ws-ticket — mint a short-lived, single-use WebSocket ticket.
 * Sits behind the global /api/* auth middleware, so only localhost callers or
 * holders of a valid Bearer token can mint one. The client connects with
 * `/ws?ticket=<value>` immediately afterwards.
 */
export function createWsTicketRoute() {
  return new Hono().post('/', (c) => {
    return c.json(issueWsTicket());
  });
}
