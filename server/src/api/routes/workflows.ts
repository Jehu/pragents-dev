import { Hono } from 'hono';
import type { WorkflowRegistry } from '../../workflows/loader.js';
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { WorkflowTracker } from '../../workflows/tracker.js';

export function createWorkflowsRoute(registry: WorkflowRegistry, engine: WorkflowEngine, tracker: WorkflowTracker) {
  const r = new Hono();

  r.get('/', (c) => {
    const workflows = registry.list().map((w) => ({ name: w.name, description: w.description, steps: w.steps.length, trigger: w.trigger?.event }));
    return c.json(workflows);
  });

  // /runs must come before /:name to avoid name="runs" matching
  r.get('/runs', (c) => {
    const runs = tracker.listRuns(50);
    return c.json(runs);
  });

  r.get('/runs/:id', (c) => {
    const run = tracker.getRun(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    const steps = tracker.getSteps(run.id);
    return c.json({ ...run, steps });
  });

  r.get('/:name', (c) => {
    const def = registry.get(c.req.param('name'));
    if (!def) return c.json({ error: 'Workflow not found' }, 404);
    return c.json(def);
  });

  r.post('/:name/run', async (c) => {
    const def = registry.get(c.req.param('name'));
    if (!def) return c.json({ error: 'Workflow not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    try {
      const runId = await engine.execute(def, body.params);
      return c.json({ runId, status: 'complete' }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return r;
}
