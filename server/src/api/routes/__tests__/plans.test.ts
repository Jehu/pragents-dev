import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, closeDb } from '../../../db/sqlite.js';
import { PlanStore } from '../../../plans/store.js';
import { PlanExecutor } from '../../../plans/executor.js';
import { createPlansRoute } from '../plans.js';
import { WorkflowTracker } from '../../../workflows/tracker.js';

describe('Plans API — /api/v1/plans', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-plans-route-'));
  let store: PlanStore;
  let executor: PlanExecutor;
  let wfTracker: WorkflowTracker;
  // Mock workflow engine — execute() resolves quickly with a fake runId.
  const wfEngine = { execute: vi.fn().mockResolvedValue('run-xyz') } as any;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    store = new PlanStore();
    executor = new PlanExecutor(store, wfEngine);
    wfTracker = new WorkflowTracker();
  });
  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  function makeApp() {
    return createPlansRoute(store, executor, wfTracker);
  }

  it('GET / returns a list under { plans }', async () => {
    store.create({ origin: 'nl', prompt: 'p', steps: [{ description: 'x', agentId: 'dev' }] });
    const app = makeApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThan(0);
  });

  it('GET / filters by status and origin', async () => {
    const draft = store.create({
      origin: 'chat',
      prompt: 'chat-only',
      conversationId: 'c1',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const app = makeApp();
    const res = await app.request('/?status=draft&origin=chat&conversationId=c1');
    const body = await res.json();
    expect(body.plans.some((p: any) => p.id === draft.id)).toBe(true);
    for (const p of body.plans) {
      expect(p.origin).toBe('chat');
      expect(p.status).toBe('draft');
      expect(p.conversationId).toBe('c1');
    }
  });

  it('GET / rejects invalid status', async () => {
    const app = makeApp();
    const res = await app.request('/?status=bogus');
    expect(res.status).toBe(400);
  });

  it('GET /:id returns 404 when missing', async () => {
    const app = makeApp();
    const res = await app.request('/missing-id');
    expect(res.status).toBe(404);
  });

  it('GET /:id returns the plan', async () => {
    const plan = store.create({
      origin: 'nl', prompt: 'p',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const app = makeApp();
    const res = await app.request(`/${plan.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(plan.id);
    expect(body.steps).toHaveLength(1);
  });

  it('GET /:id enriches completed plans with workflow run steps', async () => {
    const plan = store.create({
      origin: 'nl',
      prompt: 'p',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const run = wfTracker.createRun('plan-test');
    const step = wfTracker.createStep(run.id, 'step-0', 'dev');
    wfTracker.startStep(step.id);
    wfTracker.completeStep(step.id, 'artifact output');
    wfTracker.completeRun(run.id);
    store.approve(plan.id);
    store.setExecuting(plan.id);
    store.setDone(plan.id, { runId: run.id });

    const app = makeApp();
    const res = await app.request(`/${plan.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workflowRun.id).toBe(run.id);
    expect(body.workflowRun.steps[0]).toMatchObject({
      stepId: 'step-0',
      agentId: 'dev',
      status: 'complete',
      output: 'artifact output',
    });
  });

  it('POST /:id/approve transitions draft and kicks off execution', async () => {
    const plan = store.create({
      origin: 'nl', prompt: 'p',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const app = makeApp();
    const res = await app.request(`/${plan.id}/approve`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.planId).toBe(plan.id);
    expect(body.status).toBe('approved');

    // Let the async executor settle
    await new Promise((r) => setTimeout(r, 20));
    const after = store.get(plan.id);
    // After approve+execute, plan should be `done` (mock wfEngine.execute resolves immediately)
    expect(['approved', 'executing', 'done']).toContain(after!.status);
    // Eventually done after one tick
    await new Promise((r) => setTimeout(r, 20));
    const final = store.get(plan.id);
    expect(final!.status).toBe('done');
    expect(final!.result).toEqual({ runId: 'run-xyz' });
  });

  it('POST /:id/approve returns 404 when missing', async () => {
    const app = makeApp();
    const res = await app.request('/nope/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /:id/approve returns 409 when plan is already approved', async () => {
    const plan = store.create({
      origin: 'nl', prompt: 'p',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    store.approve(plan.id);
    const app = makeApp();
    const res = await app.request(`/${plan.id}/approve`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('POST /:id/cancel transitions a draft to cancelled', async () => {
    const plan = store.create({
      origin: 'nl', prompt: 'p',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const app = makeApp();
    const res = await app.request(`/${plan.id}/cancel`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('cancelled');
  });

  it('POST /:id/cancel returns 409 when terminal', async () => {
    const plan = store.create({
      origin: 'nl', prompt: 'p',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    store.approve(plan.id);
    store.setExecuting(plan.id);
    store.setDone(plan.id, { runId: 'r' });
    const app = makeApp();
    const res = await app.request(`/${plan.id}/cancel`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});
