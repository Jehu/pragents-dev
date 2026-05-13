import { Hono } from 'hono';
import type { NLDecomposer } from '../../nl/decomposer.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { PlanStore } from '../../plans/store.js';
import type { PlanExecutor } from '../../plans/executor.js';
import { getDb } from '../../db/sqlite.js';
import { logger } from '../../logging/index.js';

/**
 * Natural-language routes — thin wrappers over the unified Plan store (#28).
 *
 * /decompose   Produce a plan via the LLM, persist as `draft`, return
 *              `{ planId, plan, steps }`. Response stays additive — legacy
 *              clients that read `.steps` keep working.
 *
 * /execute     Supports two shapes:
 *                a) `{ planId }`                    — preferred (post-#28).
 *                                                     Fire-and-forget; client
 *                                                     polls GET /plans/:id.
 *                b) `{ prompt?, plan: { steps } }`  — legacy inline plan.
 *                                                     Awaits completion and
 *                                                     returns `{ planId, runId,
 *                                                     status: 'executing' }`
 *                                                     to preserve the original
 *                                                     synchronous contract.
 */
export function createNLRoutes(
  decomposer: NLDecomposer,
  agents: ResolvedAgent[],
  store: PlanStore,
  executor: PlanExecutor,
) {
  const r = new Hono();

  r.post('/decompose', async (c) => {
    const { prompt } = await c.req.json();
    if (!prompt?.trim()) return c.json({ error: 'Prompt is required' }, 400);

    try {
      const plan = await decomposer.decompose(prompt.trim(), agents);
      const persisted = store.create({
        origin: 'nl',
        prompt: prompt.trim(),
        steps: plan.steps,
      });
      // Backward-compat: legacy clients read `.steps`; new clients use `planId`.
      return c.json({
        planId: persisted.id,
        plan: { steps: persisted.steps },
        steps: persisted.steps,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  r.post('/execute', async (c) => {
    const body = await c.req.json();
    const { planId, prompt, plan } = body ?? {};

    // ---- Path A: new {planId} form (fire-and-forget) ----
    if (planId) {
      const existing = store.get(planId);
      if (!existing) return c.json({ error: 'Plan not found' }, 404);

      let approved = existing;
      if (existing.status === 'draft') {
        try {
          approved = store.approve(planId);
        } catch (err: any) {
          return c.json({ error: err.message }, 409);
        }
      } else if (existing.status !== 'approved') {
        return c.json(
          { error: `Plan cannot be executed from status "${existing.status}"` },
          409,
        );
      }

      executor.executePlan(approved).catch((err) => {
        logger.warn(
          { planId, err: err?.message || String(err) },
          'NL execute: background execution failed',
        );
      });
      return c.json({ planId, status: 'executing' }, 201);
    }

    // ---- Path B: legacy {plan: {steps}} form (sync, returns runId) ----
    if (!plan?.steps?.length) {
      return c.json({ error: 'Plan with steps is required' }, 400);
    }

    const draft = store.create({
      origin: 'nl',
      prompt: prompt || '',
      steps: plan.steps,
    });
    const approved = store.approve(draft.id);

    try {
      const { runId } = await executor.executePlan(approved);
      return c.json({ planId: draft.id, runId, status: 'executing' }, 201);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  r.get('/plans', (c) => {
    // Legacy endpoint kept for backward compat — returns the same shape
    // (id, prompt, status, created_at) but now backed by the unified
    // `plans` table, filtered to origin='nl'.
    const rows = getDb()
      .prepare(
        `SELECT id, prompt, status, created_at
         FROM plans
         WHERE origin = 'nl'
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .all();
    return c.json(rows);
  });

  return r;
}
