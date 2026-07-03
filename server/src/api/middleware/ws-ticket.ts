import { randomBytes } from 'node:crypto';

/**
 * Short-lived, single-use WebSocket tickets.
 *
 * Browsers cannot set an Authorization header on a WebSocket upgrade, so
 * remote web clients first POST /api/v1/ws-ticket (Bearer-authenticated) to
 * mint a ticket, then connect with `?ticket=<value>`. Tickets expire after
 * TICKET_TTL_MS and are consumed on first use — a logged ticket is worthless
 * seconds later, unlike the long-lived API token.
 *
 * Storage is an in-memory map by design: tickets are ephemeral and
 * per-process; a restart invalidating outstanding tickets is fine (clients
 * simply re-fetch). Multi-instance deployments would need a shared store.
 */
const TICKET_TTL_MS = 30_000;

// Hot-reload safe singleton: survives tsx-watch module re-execution (issue #32)
const g = globalThis as any;
if (!g.__pragentsWsTickets) g.__pragentsWsTickets = new Map<string, number>();
const tickets: Map<string, number> = g.__pragentsWsTickets;

function sweepExpired(): void {
  const now = Date.now();
  for (const [ticket, expiresAt] of tickets) {
    if (expiresAt <= now) tickets.delete(ticket);
  }
}

export function issueWsTicket(): { ticket: string; expiresInMs: number } {
  sweepExpired();
  const ticket = randomBytes(32).toString('hex');
  tickets.set(ticket, Date.now() + TICKET_TTL_MS);
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

/** Returns true exactly once per valid, unexpired ticket; deletes it on use. */
export function consumeWsTicket(ticket: string): boolean {
  sweepExpired();
  const expiresAt = tickets.get(ticket);
  if (expiresAt === undefined) return false;
  tickets.delete(ticket);
  return expiresAt > Date.now();
}
