import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { GoalRegistry } from '../../goals/loader.js';

export function createGoalsRoute(registry: GoalRegistry) {
  const r = new Hono();

  r.get('/', (c) => {
    const goals = registry.list().map(g => ({ id: g.id, description: g.description, cadence: g.cadence, deadline: g.deadline, workflow: g.workflow }));
    return c.json(goals);
  });

  // /runs must come before /:id
  r.get('/runs', (c) => {
    const goalId = c.req.query('goal');
    const db = getDb();
    const rows = goalId
      ? db.prepare('SELECT * FROM goal_runs WHERE goal_id = ? ORDER BY triggered_at DESC LIMIT 30').all(goalId)
      : db.prepare('SELECT * FROM goal_runs ORDER BY triggered_at DESC LIMIT 30').all();
    return c.json(rows);
  });

  r.get('/:id', (c) => {
    const goal = registry.get(c.req.param('id'));
    if (!goal) return c.json({ error: 'Goal not found' }, 404);
    return c.json(goal);
  });

  return r;
}
