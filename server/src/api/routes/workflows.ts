import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { WorkflowRegistry } from '../../workflows/loader.js';
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { WorkflowTracker } from '../../workflows/tracker.js';

export function createWorkflowsRoute(registry: WorkflowRegistry, engine: WorkflowEngine, tracker: WorkflowTracker) {
  const r = new Hono();

  function enrichStepsWithGates(runId: string, steps: any[]) {
    const db = getDb();
    return steps.map((step: any) => {
      const gate = db.prepare(
        'SELECT status as gateStatus, feedback as gateFeedback FROM human_gates WHERE workflow_run_id = ? AND step_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(runId, step.stepId) as any;
      return {
        ...step,
        gateStatus: gate?.gateStatus || null,
        gateFeedback: gate?.gateFeedback || null,
      };
    });
  }

  r.get('/', (c) => {
    const workflows = registry.list().map((w) => ({ name: w.name, description: w.description, steps: w.steps.length, trigger: w.trigger?.event }));
    return c.json(workflows);
  });

  // /runs must come before /:name to avoid name="runs" matching
  r.get('/runs', (c) => {
    const runs = tracker.listRuns(50);
    const includeSteps = c.req.query('includeSteps') === 'true';

    if (!includeSteps) return c.json(runs);

    // Enrich each run with steps + gate info (avoids N+1 on the frontend)
    const runsWithSteps = runs.map((run: any) => ({
      ...run,
      steps: enrichStepsWithGates(run.id, tracker.getSteps(run.id)),
    }));

    return c.json(runsWithSteps);
  });

  r.get('/runs/:id', (c) => {
    const run = tracker.getRun(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json({ ...run, steps: enrichStepsWithGates(run.id, tracker.getSteps(run.id)) });
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
      const runId = engine.executeAsync(def, body.params);
      return c.json({ runId, status: 'started' }, 202);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return r;
}
