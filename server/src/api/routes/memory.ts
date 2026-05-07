import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { MemoryEngine } from '../../memory/engine.js';

export function createMemoryRoute(engine: MemoryEngine) {
  const r = new Hono();

  r.get('/facts', async (c) => {
    const scope = c.req.query('scope');
    const search = c.req.query('search');
    const limit = parseInt(c.req.query('limit') || '50');

    if (search) {
      const facts = await engine.recall(search, scope || 'company', limit);
      return c.json(facts);
    }

    const db = getDb();
    const rows = scope
      ? db.prepare('SELECT * FROM facts WHERE scope = ? ORDER BY created_at DESC LIMIT ?').all(scope, limit)
      : db.prepare('SELECT * FROM facts ORDER BY created_at DESC LIMIT ?').all(limit);
    return c.json(rows);
  });

  r.delete('/facts/:id', async (c) => {
    await engine.forget(c.req.param('id'));
    return c.json({ deleted: true });
  });

  // Cross-project search: search company-scope facts (visible to all projects)
  r.get('/search', async (c) => {
    const query = c.req.query('query');
    const scope = c.req.query('scope') || 'company';
    const includeProject = c.req.query('includeProject');
    const limit = parseInt(c.req.query('limit') || '20');

    if (!query) {
      return c.json({ error: 'query parameter is required' }, 400);
    }

    // If scope=company, use global search (cross-project)
    if (scope === 'company') {
      const facts = await engine.searchGlobal(query, { includeProject: includeProject || undefined, limit });
      return c.json({ scope, query, count: facts.length, facts });
    }

    // Otherwise, standard scoped recall
    const facts = await engine.recall(query, scope, limit);
    return c.json({ scope, query, count: facts.length, facts });
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

  return r;
}
