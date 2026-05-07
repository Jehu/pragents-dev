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
