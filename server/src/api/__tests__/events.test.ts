import { describe, it, expect, beforeEach } from 'vitest';
import { EventBuffer } from '../../events/buffer.js';
import { createEventsRoute } from '../../api/routes/events.js';
import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import type { PragentsEvent } from '../../events/buffer.js';

// Helper to collect SSE events from a ReadableStream
async function collectSSE(stream: ReadableStream<Uint8Array>, maxEvents: number = 100, timeoutMs: number = 2000): Promise<string[]> {
  const events: string[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const timer = setTimeout(() => {
    reader.cancel();
  }, timeoutMs);

  try {
    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      // Split on double-newline (SSE event boundary)
      for (const chunk of text.split('\n\n')) {
        const trimmed = chunk.trim();
        if (trimmed) events.push(trimmed);
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  return events;
}

function parseSSEData(lines: string[]): any[] {
  const events: any[] = [];
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        events.push(JSON.parse(line.substring(6)));
      } catch {}
    }
  }
  return events;
}

describe('SSE Events Route', () => {
  let buffer: EventBuffer;
  let app: Hono;

  beforeEach(() => {
    buffer = new EventBuffer(100);
    app = new Hono();
    app.route('/api/v1/events', createEventsRoute(buffer));
  });

  describe('REST polling endpoint', () => {
    it('GET / returns recent events', async () => {
      buffer.push('proj-1', 'agent-1', 'task.started', { task: 'build' });
      buffer.push('proj-1', 'agent-1', 'task.completed', { task: 'build' });

      const res = await app.request('/api/v1/events');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.events).toHaveLength(2);
      expect(body.events[0].type).toBe('task.started');
      expect(body.events[1].type).toBe('task.completed');
    });

    it('GET / filters by project', async () => {
      buffer.push('proj-1', 'a1', 'e1', {});
      buffer.push('proj-2', 'a2', 'e2', {});

      const res = await app.request('/api/v1/events?project=proj-1');
      const body = await res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].projectId).toBe('proj-1');
    });

    it('GET /?since=N returns events after given ID', async () => {
      buffer.push('p1', 'a1', 'e1', {});
      const e2 = buffer.push('p1', 'a1', 'e2', {});
      buffer.push('p1', 'a1', 'e3', {});

      const res = await app.request(`/api/v1/events?since=${e2.id}`);
      const body = await res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe('e3');
    });

    it('GET / respects limit param', async () => {
      for (let i = 0; i < 20; i++) {
        buffer.push('p1', 'a1', 'test', {});
      }

      const res = await app.request('/api/v1/events?limit=5');
      const body = await res.json();
      expect(body.events).toHaveLength(5);
    });

    it('GET / caps limit at 200', async () => {
      const bigBuf = new EventBuffer(300);
      for (let i = 0; i < 250; i++) {
        bigBuf.push('p1', 'a1', 'test', {});
      }
      const bigApp = new Hono();
      bigApp.route('/api/v1/events', createEventsRoute(bigBuf));

      const res = await bigApp.request('/api/v1/events?limit=500');
      const body = await res.json();
      expect(body.events).toHaveLength(200);
    });
  });

  describe('SSE stream endpoint', () => {
    it('GET /stream returns text/event-stream content type', async () => {
      const res = await app.request('/api/v1/events/stream');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      // Clean up the stream
      if (res.body) {
        await res.body.cancel();
      }
    });

    it('GET /stream sends recent events on connect', async () => {
      const e1 = buffer.push('p1', 'a1', 'task.started', { task: 'build' });
      buffer.push('p1', 'a1', 'task.completed', { task: 'build' });

      const res = await app.request('/api/v1/events/stream');
      expect(res.body).toBeTruthy();

      const sseLines = await collectSSE(res.body!, 5, 1000);
      const events = parseSSEData(sseLines);

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].type).toBe('task.started');
      expect(events[1].type).toBe('task.completed');

      // Each event should have the required fields
      for (const evt of events) {
        expect(evt).toHaveProperty('id');
        expect(evt).toHaveProperty('type');
        expect(evt).toHaveProperty('projectId');
        expect(evt).toHaveProperty('timestamp');
      }
    });

    it('GET /stream filters by project query param', async () => {
      buffer.push('proj-1', 'a1', 'e1', {});
      buffer.push('proj-2', 'a2', 'e2', {});

      const res = await app.request('/api/v1/events/stream?project=proj-1');
      const sseLines = await collectSSE(res.body!, 5, 1000);
      const events = parseSSEData(sseLines);

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('proj-1');
    });

    it('GET /stream replays from Last-Event-ID', async () => {
      const e1 = buffer.push('p1', 'a1', 'e1', {});
      buffer.push('p1', 'a1', 'e2', {});
      buffer.push('p1', 'a1', 'e3', {});

      const res = await app.request('/api/v1/events/stream', {
        headers: { 'Last-Event-ID': String(e1.id) },
      });

      const sseLines = await collectSSE(res.body!, 5, 1000);
      const events = parseSSEData(sseLines);

      // Should only get events after ID e1.id (i.e., e2 and e3)
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('e2');
      expect(events[1].type).toBe('e3');
    });

    it('SSE format uses newline-delimited JSON with data: prefix', async () => {
      buffer.push('p1', 'a1', 'test', { msg: 'hello' });

      const res = await app.request('/api/v1/events/stream');
      const sseText = await collectSSE(res.body!, 5, 1000);

      // Each SSE event should start with "data: "
      for (const chunk of sseText) {
        if (chunk.startsWith(':')) continue; // heartbeat comment
        expect(chunk.startsWith('data: ')).toBe(true);
        const jsonStr = chunk.substring(6);
        expect(() => JSON.parse(jsonStr)).not.toThrow();
      }
    });
  });
});
