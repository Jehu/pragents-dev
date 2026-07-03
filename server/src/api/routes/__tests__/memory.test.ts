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

  // ---- Scope expansion (C2 regression) ----
  describe('scope expansion', () => {
    beforeAll(() => {
      const db = getDb();
      // Seed facts across multiple scopes.
      db.prepare("INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?,?,?,?,?)")
        .run('f-proj-a', 'project-alpha', 'note', 'alpha project fact', 'a');
      db.prepare("INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?,?,?,?,?)")
        .run('f-proj-b', 'project-beta', 'note', 'beta project fact', 'b');
      db.prepare("INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?,?,?,?,?)")
        .run('f-rogue', 'rogue-project', 'note', 'rogue project fact', 'r');
      db.prepare("INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?,?,?,?,?)")
        .run('f-company', 'company', 'note', 'company-wide fact', 'c');
      db.prepare("INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?,?,?,?,?)")
        .run('f-agent', 'agent', 'note', 'agent-private fact', 'p');
    });

    const config = { projects: { 'project-alpha': {}, 'project-beta': {} } };

    it('GET /facts?scope=project only returns configured project IDs', async () => {
      const app = createMemoryRoute(engine, config);
      const res = await app.request('/facts?scope=project');
      const body = await res.json();
      const scopes = new Set(body.map((f: any) => f.scope));
      expect(scopes.has('project-alpha')).toBe(true);
      expect(scopes.has('project-beta')).toBe(true);
      // The unconfigured "rogue-project" must NOT leak through.
      expect(scopes.has('rogue-project')).toBe(false);
      // Company and agent are not part of the 'project' bucket.
      expect(scopes.has('company')).toBe(false);
      expect(scopes.has('agent')).toBe(false);
    });

    it('GET /facts?scope=all excludes rogue (non-configured) project scopes', async () => {
      const app = createMemoryRoute(engine, config);
      const res = await app.request('/facts?scope=all');
      const body = await res.json();
      const scopes = new Set(body.map((f: any) => f.scope));
      expect(scopes.has('rogue-project')).toBe(false);
    });

    it('GET /search?scope=project routes through configured projects only', async () => {
      const app = createMemoryRoute(engine, config);
      const res = await app.request('/search?query=project&scope=project');
      const body = await res.json();
      const factScopes = new Set(body.facts.map((f: any) => f.scope));
      // Both configured projects can match; rogue must not.
      expect(factScopes.has('rogue-project')).toBe(false);
      // Agent-private memory must not leak through scope=project.
      expect(factScopes.has('agent')).toBe(false);
    });
  });

  describe('session-message snapshots', () => {
    it('lists snapshots filtered by sessionId and serves the message payload', async () => {
      const db = getDb();
      // session_messages.session_id has a FK to sessions(id) — create parents first.
      db.prepare("INSERT INTO sessions (id, agent_id) VALUES (?, ?)").run('dev@proj-a', 'dev@proj-a');
      db.prepare("INSERT INTO sessions (id, agent_id) VALUES (?, ?)").run('other@proj-b', 'other@proj-b');
      db.prepare(
        'INSERT INTO session_messages (id, session_id, messages_json, message_count) VALUES (?, ?, ?, ?)',
      ).run('snap-1', 'dev@proj-a', JSON.stringify([
        { role: 'user', content: 'do the thing' },
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ]), 2);
      db.prepare(
        'INSERT INTO session_messages (id, session_id, messages_json, message_count) VALUES (?, ?, ?, ?)',
      ).run('snap-2', 'other@proj-b', JSON.stringify([{ role: 'user', content: 'hi' }]), 1);

      const app = createMemoryRoute(engine);

      const listRes = await app.request('/session-messages?sessionId=dev@proj-a');
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: 'snap-1', sessionId: 'dev@proj-a', messageCount: 2 });

      const detailRes = await app.request('/session-messages/snap-1');
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[0]).toEqual({ role: 'user', content: 'do the thing' });
    });

    it('returns 404 for an unknown snapshot id', async () => {
      const app = createMemoryRoute(engine);
      const res = await app.request('/session-messages/nope');
      expect(res.status).toBe(404);
    });
  });
});
