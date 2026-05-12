import { Hono } from 'hono';
import type { NLDecomposer } from '../../nl/decomposer.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { WorkflowDef } from '../../workflows/schema.js';
import { getDb } from '../../db/sqlite.js';
import { randomUUID } from 'node:crypto';

export function createNLRoutes(decomposer: NLDecomposer, agents: ResolvedAgent[], wfEngine: WorkflowEngine) {
  const r = new Hono();

  r.post('/decompose', async (c) => {
    const { prompt } = await c.req.json();
    if (!prompt?.trim()) return c.json({ error: 'Prompt is required' }, 400);

    try {
      const plan = await decomposer.decompose(prompt.trim(), agents);
      return c.json(plan);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  r.post('/execute', async (c) => {
    const { prompt, plan } = await c.req.json();
    if (!plan?.steps?.length) return c.json({ error: 'Plan with steps is required' }, 400);

    // Store plan in DB
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO nl_plans (id, prompt, plan_json, status, created_at) VALUES (?, ?, ?, 'approved', ?)",
    ).run(id, prompt || '', JSON.stringify(plan), new Date().toISOString());

    // Build ad-hoc workflow
    const wfDef: WorkflowDef = {
      name: `nl-${id.substring(0, 8)}`,
      description: prompt || 'NL Delegated Plan',
      steps: plan.steps.map((s: any, i: number) => ({
        id: `step-${i}`,
        agent: s.agentId,
        prompt: s.description,
        output: `step-${i}-output`,
        ...(s.dependsOn != null
          ? { input: `step-${Array.isArray(s.dependsOn) ? s.dependsOn[0] : s.dependsOn}-output` }
          : {}),
      })),
    };

    try {
      const runId = await wfEngine.execute(wfDef);
      db.prepare("UPDATE nl_plans SET status = 'executed' WHERE id = ?").run(id);
      return c.json({ planId: id, runId, status: 'executing' }, 201);
    } catch (err: any) {
      db.prepare("UPDATE nl_plans SET status = 'failed' WHERE id = ?").run(id);
      return c.json({ error: err.message }, 500);
    }
  });

  r.get('/plans', (c) => {
    const rows = getDb().prepare(
      "SELECT id, prompt, status, created_at FROM nl_plans ORDER BY created_at DESC LIMIT 20",
    ).all();
    return c.json(rows);
  });

  return r;
}
