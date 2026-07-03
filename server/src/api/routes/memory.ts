import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { MemoryEngine } from '../../memory/engine.js';

/**
 * Resolve a UI scope bucket (`all`, `company`, `project`, `agent`) into a SQL
 * WHERE clause. Concrete scope values (`kunde-webshop`, `office@company`) are
 * passed through unchanged for backwards compatibility.
 */
function resolveScopeBucket(
  scope: string | undefined,
  projectIds: string[],
): { where: string; params: string[] } {
  if (!scope || scope === 'all') {
    // "All" means the union of configured projects + company + agent. Facts
    // scoped to a project that is *not* in the config (legacy, foreign,
    // mistyped) must not leak.
    if (projectIds.length === 0) {
      return { where: "scope IN ('company', 'agent')", params: [] };
    }
    const placeholders = projectIds.map(() => '?').join(', ');
    return {
      where: `(scope IN (${placeholders}) OR scope = 'company' OR scope = 'agent' OR scope LIKE '%@%')`,
      params: projectIds,
    };
  }
  if (scope === 'company') return { where: 'scope = ?', params: ['company'] };
  if (scope === 'agent') {
    // Agent-scoped facts use either the literal 'agent' marker or an
    // `<id>@<project>` form. Match both.
    return { where: "(scope = 'agent' OR scope LIKE '%@%')", params: [] };
  }
  if (scope === 'project') {
    if (projectIds.length === 0) return { where: '1=0', params: [] };
    const placeholders = projectIds.map(() => '?').join(', ');
    return { where: `scope IN (${placeholders})`, params: projectIds };
  }
  // Concrete scope value (e.g. project ID or agent ID) — only honor if it's
  // a configured project; otherwise reject by returning a contradictory WHERE.
  if (projectIds.includes(scope) || scope === 'company') {
    return { where: 'scope = ?', params: [scope] };
  }
  return { where: '1=0', params: [] };
}

export function createMemoryRoute(engine: MemoryEngine, config?: { projects: Record<string, unknown> }) {
  const r = new Hono();

  const projectIds = () => (config ? Object.keys(config.projects) : []);

  /**
   * Expand a UI scope bucket into the explicit list of scope values that
   * engine.recall() may search. The expansion never silently widens to "every
   * scope in the DB" — that was the C2 leak. Returns null when no expansion
   * applies (caller passed a concrete scope value to use verbatim).
   */
  function expandRecallScope(scope: string | undefined): string[] | null {
    if (!scope || scope === 'all') {
      // All configured projects + company-wide. Agent-scope is excluded from
      // "all" to avoid cross-agent private-memory leakage.
      return [...projectIds(), 'company'];
    }
    if (scope === 'project') return projectIds();
    if (scope === 'company' || scope === 'agent') return [scope];
    // Concrete scope value (e.g., specific project ID or agent ID) — accept
    // only when it's a configured project, else treat as company-style literal.
    return null;
  }

  r.get('/facts', async (c) => {
    const scope = c.req.query('scope');
    const search = c.req.query('search');
    const limit = parseInt(c.req.query('limit') || '50');

    if (search) {
      const expanded = expandRecallScope(scope);
      const recallScope: string | string[] = expanded ?? scope!;
      const facts = await engine.recall(search, recallScope, limit);
      return c.json(facts);
    }

    const db = getDb();
    const { where, params } = resolveScopeBucket(scope, projectIds());
    const rows = db
      .prepare(`SELECT * FROM facts WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit);
    return c.json(rows);
  });

  r.delete('/facts/:id', async (c) => {
    await engine.forget(c.req.param('id'));
    return c.json({ deleted: true });
  });

  // Scoped search across facts. The web UI sends one of four buckets
  // ('all', 'company', 'project', 'agent'); the recall semantics map
  // identically to /facts above.
  r.get('/search', async (c) => {
    const query = c.req.query('query');
    const scope = c.req.query('scope');
    const includeProject = c.req.query('includeProject');
    const limit = parseInt(c.req.query('limit') || '20');

    if (!query) {
      return c.json({ error: 'query parameter is required' }, 400);
    }

    // Cross-project (company) — backwards-compatible default for callers that
    // explicitly request company scope with an includeProject hint.
    if (scope === 'company') {
      const facts = await engine.searchGlobal(query, { includeProject: includeProject || undefined, limit });
      return c.json({ scope, query, count: facts.length, facts });
    }

    const expanded = expandRecallScope(scope);
    const recallScope: string | string[] = expanded ?? scope!;
    const facts = await engine.recall(query, recallScope, limit);
    return c.json({ scope: scope ?? 'all', query, count: facts.length, facts });
  });

  // Remember a new fact (POST for creating facts via API)
  r.post('/facts', async (c) => {
    const body = await c.req.json();
    const { scope, category, content, agentId } = body;
    if (!scope || !category || !content || !agentId) {
      return c.json({ error: 'scope, category, content, and agentId are required' }, 400);
    }
    const fact = engine.remember(scope, category, content, agentId);
    return c.json(fact, 201);
  });

  r.get('/stats', (c) => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as count FROM facts').get() as any).count;
    const byScope = db.prepare(
      'SELECT scope, COUNT(*) as count FROM facts GROUP BY scope ORDER BY count DESC',
    ).all();
    const byCategory = db.prepare(
      'SELECT category, COUNT(*) as count FROM facts GROUP BY category ORDER BY count DESC',
    ).all();
    return c.json({ total, byScope, byCategory });
  });

  r.get('/sessions', (c) => {
    const db = getDb();
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const rows = db.prepare(
      'SELECT id, agent_id as agentId, compressed_summary as summary, created_at as createdAt FROM sessions WHERE compressed_summary IS NOT NULL ORDER BY created_at DESC LIMIT ?',
    ).all(limit);
    return c.json(rows);
  });

  // Persisted session-message snapshots (written on session disposal).
  // session_id follows the agent id — filter by ?sessionId=<agentId>.
  r.get('/session-messages', (c) => {
    const db = getDb();
    const sessionId = c.req.query('sessionId');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const base =
      'SELECT id, session_id as sessionId, message_count as messageCount, created_at as createdAt FROM session_messages';
    const rows = sessionId
      ? db.prepare(`${base} WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`).all(sessionId, limit)
      : db.prepare(`${base} ORDER BY created_at DESC LIMIT ?`).all(limit);
    return c.json(rows);
  });

  r.get('/session-messages/:id', (c) => {
    const db = getDb();
    const row = db.prepare(
      'SELECT id, session_id as sessionId, messages_json, message_count as messageCount, created_at as createdAt FROM session_messages WHERE id = ?',
    ).get(c.req.param('id')) as
      | { id: string; sessionId: string; messages_json: string; messageCount: number; createdAt: string }
      | undefined;
    if (!row) return c.json({ error: 'Snapshot not found' }, 404);
    let messages: unknown[] = [];
    try {
      messages = JSON.parse(row.messages_json);
    } catch {
      return c.json({ error: 'Snapshot is corrupted' }, 500);
    }
    return c.json({
      id: row.id,
      sessionId: row.sessionId,
      messageCount: row.messageCount,
      createdAt: row.createdAt,
      messages,
    });
  });

  return r;
}
