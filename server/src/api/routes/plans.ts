import { Hono } from 'hono';
import type { PlanStore, ListPlansOptions } from '../../plans/store.js';
import type { PlanExecutor } from '../../plans/executor.js';
import { PlanStatusSchema, PlanOriginSchema } from '../../plans/schema.js';
import { logger } from '../../logging/index.js';

/**
 * REST surface for the unified plan store.
 *
 * GET    /              list plans (optional ?status=&origin=&conversationId=&limit=&offset=)
 * GET    /:id           fetch a single plan
 * POST   /:id/approve   approve a draft AND kick off execution (async)
 * POST   /:id/cancel    set status=cancelled (only meaningful pre-execution)
 */
export function createPlansRoute(store: PlanStore, executor: PlanExecutor) {
  const r = new Hono();

  r.get('/', (c) => {
    const opts: ListPlansOptions = {};
    const status = c.req.query('status');
    if (status) {
      const parsed = PlanStatusSchema.safeParse(status);
      if (!parsed.success) return c.json({ error: `Invalid status: ${status}` }, 400);
      opts.status = parsed.data;
    }
    const origin = c.req.query('origin');
    if (origin) {
      const parsed = PlanOriginSchema.safeParse(origin);
      if (!parsed.success) return c.json({ error: `Invalid origin: ${origin}` }, 400);
      opts.origin = parsed.data;
    }
    const conversationId = c.req.query('conversationId');
    if (conversationId) opts.conversationId = conversationId;

    const limit = c.req.query('limit');
    if (limit) {
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) opts.limit = Math.min(n, 200);
    }
    const offset = c.req.query('offset');
    if (offset) {
      const n = parseInt(offset, 10);
      if (Number.isFinite(n) && n >= 0) opts.offset = n;
    }

    const plans = store.list(opts);
    return c.json({ plans });
  });

  r.get('/:id', (c) => {
    const id = c.req.param('id');
    const plan = store.get(id);
    if (!plan) return c.json({ error: 'Plan not found' }, 404);
    return c.json(plan);
  });

  r.post('/:id/approve', async (c) => {
    const id = c.req.param('id');
    const existing = store.get(id);
    if (!existing) return c.json({ error: 'Plan not found' }, 404);
    if (existing.status !== 'draft') {
      return c.json(
        { error: `Plan cannot be approved from status "${existing.status}"` },
        409,
      );
    }

    let approved;
    try {
      approved = store.approve(id);
    } catch (err: any) {
      return c.json({ error: err.message }, 409);
    }

    // Dispatch execution asynchronously — clients observe the run via SSE /
    // events or by polling GET /plans/:id. The executor updates lifecycle.
    executor.executePlan(approved).catch((err) => {
      logger.warn(
        { planId: id, err: err?.message || String(err) },
        'Plans API: background execution failed',
      );
    });

    return c.json({ planId: id, status: 'approved' }, 200);
  });

  r.post('/:id/cancel', (c) => {
    const id = c.req.param('id');
    const existing = store.get(id);
    if (!existing) return c.json({ error: 'Plan not found' }, 404);
    if (existing.status === 'done' || existing.status === 'failed' || existing.status === 'cancelled') {
      return c.json(
        { error: `Plan cannot be cancelled from status "${existing.status}"` },
        409,
      );
    }
    const plan = store.setCancelled(id);
    return c.json(plan, 200);
  });

  return r;
}
