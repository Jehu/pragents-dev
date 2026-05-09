import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../../db/sqlite.js';
import { MemoryEngine } from '../../../memory/engine.js';
import { createMemoryRoute } from '../memory.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Memory API', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-memory-test-'));
  let engine: MemoryEngine;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    engine = new MemoryEngine();
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  // ---- Sessions ----
  it('GET /sessions returns empty when no summaries exist', async () => {
    const app = createMemoryRoute(engine);
    const res = await app.request('/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /sessions returns session summaries', async () => {
    const db = getDb();
    db.prepare("INSERT INTO sessions (id, agent_id, compressed_summary) VALUES (?, ?, ?)").run('sess-1', 'dev', 'Fixed auth bug');
    db.prepare("INSERT INTO sessions (id, agent_id, compressed_summary) VALUES (?, ?, ?)").run('sess-2', 'seo', 'Keyword research done');

    const app = createMemoryRoute(engine);
    const res = await app.request('/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty('agentId');
    expect(body[0]).toHaveProperty('summary');
    expect(body[0]).toHaveProperty('createdAt');
  });

  it('GET /sessions excludes NULL summaries', async () => {
    const db = getDb();
    db.prepare("INSERT INTO sessions (id, agent_id, compressed_summary) VALUES (?, ?, ?)").run('sess-3', 'pm', null);
    db.prepare("INSERT INTO sessions (id, agent_id, compressed_summary) VALUES (?, ?, ?)").run('sess-4', 'office', 'Invoice processed');

    const app = createMemoryRoute(engine);
    const res = await app.request('/sessions');
    const body = await res.json();
    const nullSession = body.find((s: any) => s.id === 'sess-3');
    expect(nullSession).toBeUndefined();
  });

  it('GET /sessions respects limit', async () => {
    const app = createMemoryRoute(engine);
    const res = await app.request('/sessions?limit=1');
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(1);
  });
});
