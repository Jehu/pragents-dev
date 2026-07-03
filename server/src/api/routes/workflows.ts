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

  /**
   * Plan-run linkage: ad-hoc workflows compiled from NL/chat plans are named
   * `plan-<id-prefix>` and carry no human-readable context of their own. The
   * originating plan stores the workflow run id in result_json on completion
   * (PlanExecutor.setDone), so we can attach the plan's prompt and per-step
   * descriptions for display.
   */
  function planContextForRun(runId: string, workflowName: string) {
    if (!workflowName?.startsWith('plan-')) return null;
    try {
      const db = getDb();
      const row = db.prepare(
        "SELECT id, prompt, steps_json FROM plans WHERE json_extract(result_json, '$.runId') = ? LIMIT 1",
      ).get(runId) as { id: string; prompt: string | null; steps_json: string | null } | undefined;
      if (!row) return null;
      let stepDescriptions: string[] = [];
      try {
        const steps = JSON.parse(row.steps_json ?? '[]');
        if (Array.isArray(steps)) stepDescriptions = steps.map((s: any) => s?.description ?? '');
      } catch { /* corrupt steps_json — descriptions stay empty */ }
      return { id: row.id, prompt: row.prompt ?? '', stepDescriptions };
    } catch {
      return null; // enrichment is best-effort; never break the runs list
    }
  }

  r.get('/', (c) => {
    const workflows = registry.listEntries().map(({ def, projectId }) => ({
      name: def.name,
      projectId,
      description: def.description,
      steps: def.steps.length,
      trigger: def.trigger?.event,
    }));
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
      plan: planContextForRun(run.id, run.workflowName),
    }));

    return c.json(runsWithSteps);
  });

  r.get('/runs/:id', (c) => {
    const run = tracker.getRun(c.req.param('id'));
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json({
      ...run,
      steps: enrichStepsWithGates(run.id, tracker.getSteps(run.id)),
      plan: planContextForRun(run.id, run.workflowName),
    });
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
