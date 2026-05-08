import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { EventBuffer } from '../../events/buffer.js';

export function createGatesRoute(eventBuffer: EventBuffer) {
  const r = new Hono();

  r.get('/pending', (c) => {
    const rows = getDb().prepare(
      "SELECT * FROM human_gates WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20",
    ).all();
    return c.json(rows);
  });

  r.post('/:id/approve', (c) => {
    const gate = getDb().prepare('SELECT * FROM human_gates WHERE id = ?').get(c.req.param('id')) as any;
    if (!gate) return c.json({ error: 'Gate not found' }, 404);
    if (gate.status !== 'pending') return c.json({ error: 'Gate is not pending' }, 400);
    getDb().prepare(
      "UPDATE human_gates SET status = 'approved', approved_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), gate.id);

    eventBuffer.push('workflow', undefined, 'gate.approved', {
      gateId: gate.id,
      workflowRunId: gate.workflow_run_id,
      stepId: gate.step_id,
      label: gate.label,
    });

    return c.json({ status: 'approved' });
  });

  r.post('/:id/reject', (c) => {
    const gate = getDb().prepare('SELECT * FROM human_gates WHERE id = ?').get(c.req.param('id')) as any;
    if (!gate) return c.json({ error: 'Gate not found' }, 404);
    if (gate.status !== 'pending') return c.json({ error: 'Gate is not pending' }, 400);
    getDb().prepare(
      "UPDATE human_gates SET status = 'rejected', approved_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), gate.id);

    eventBuffer.push('workflow', undefined, 'gate.rejected', {
      gateId: gate.id,
      workflowRunId: gate.workflow_run_id,
      stepId: gate.step_id,
      label: gate.label,
    });

    return c.json({ status: 'rejected' });
  });

  return r;
}
