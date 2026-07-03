import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { issueWsTicket, consumeWsTicket } from '../ws-ticket.js';
import { authMiddleware } from '../auth.js';
import { createWsTicketRoute } from '../../routes/ws-ticket.js';

const TOKEN = 'b'.repeat(64);

describe('WS ticket store', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a hex ticket with a TTL', () => {
    const { ticket, expiresInMs } = issueWsTicket();
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresInMs).toBeGreaterThan(0);
  });

  it('consumes a valid ticket exactly once', () => {
    const { ticket } = issueWsTicket();
    expect(consumeWsTicket(ticket)).toBe(true);
    expect(consumeWsTicket(ticket)).toBe(false);
  });

  it('rejects an unknown ticket', () => {
    expect(consumeWsTicket('not-a-ticket')).toBe(false);
  });

  it('rejects an expired ticket', () => {
    vi.useFakeTimers();
    const { ticket, expiresInMs } = issueWsTicket();
    vi.advanceTimersByTime(expiresInMs + 1);
    expect(consumeWsTicket(ticket)).toBe(false);
  });
});

describe('POST /api/v1/ws-ticket', () => {
  function buildApp() {
    const app = new Hono();
    app.use('/api/*', authMiddleware(() => TOKEN));
    app.route('/api/v1/ws-ticket', createWsTicketRoute());
    return app;
  }

  it('rejects a non-localhost request without a Bearer token', async () => {
    const app = buildApp();
    const res = await app.request('http://example.com/api/v1/ws-ticket', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('mints a consumable ticket for a Bearer-authenticated request', async () => {
    const app = buildApp();
    const res = await app.request('http://example.com/api/v1/ws-ticket', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(body.expiresInMs).toBeGreaterThan(0);
    expect(consumeWsTicket(body.ticket)).toBe(true);
  });

  it('mints a ticket for a localhost request without a token', async () => {
    const app = buildApp();
    const res = await app.request('http://localhost/api/v1/ws-ticket', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(consumeWsTicket(body.ticket)).toBe(true);
  });
});
