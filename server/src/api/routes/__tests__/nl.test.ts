import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, closeDb } from '../../../db/sqlite.js';
import { PlanStore } from '../../../plans/store.js';
import { PlanExecutor } from '../../../plans/executor.js';
import { createNLRoutes } from '../nl.js';
import type { NLDecomposer } from '../../../nl/decomposer.js';
import type { ResolvedAgent } from '../../../config/schema.js';

describe('NL routes — /api/v1/nl', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-nl-route-'));
  let store: PlanStore;
  let executor: PlanExecutor;
  const wfEngine = { execute: vi.fn().mockResolvedValue('run-1') } as any;
  const agents: ResolvedAgent[] = [
    {
      id: 'dev', projectId: 'p', type: 'dev', model: 'm', personality: '',
      memory: {}, capabilities: [], projectDir: '/tmp', tokenBudget: 1000, keepWarm: false,
    } as any,
  ];
  const mockDecomposer = {
    decompose: vi.fn().mockResolvedValue({
      steps: [
        { description: 'do x', agentId: 'dev' },
        { description: 'do y', agentId: 'dev', dependsOn: 0 },
      ],
    }),
  } as unknown as NLDecomposer;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    store = new PlanStore();
    executor = new PlanExecutor(store, wfEngine);
  });
  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  function makeApp() {
    return createNLRoutes(mockDecomposer, agents, store, executor);
  }

  it('POST /decompose persists a draft plan and returns { planId, plan, steps }', async () => {
    const app = makeApp();
    const res = await app.request('/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'build a thing' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.planId).toBeTruthy();
    expect(body.steps).toHaveLength(2);
    expect(body.plan.steps).toHaveLength(2);

    // The plan should be in `draft` status
    const stored = store.get(body.planId);
    expect(stored?.status).toBe('draft');
    expect(stored?.origin).toBe('nl');
  });

  it('POST /decompose 400s on empty prompt', async () => {
    const app = makeApp();
    const res = await app.request('/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /execute with {planId} approves + executes the plan (async)', async () => {
    const plan = store.create({
      origin: 'nl', prompt: 'pre-existing',
      steps: [{ description: 'a', agentId: 'dev' }],
    });
    const app = makeApp();
    const res = await app.request('/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: plan.id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.planId).toBe(plan.id);
    expect(body.status).toBe('executing');

    // Eventually the plan reaches done
    await new Promise((r) => setTimeout(r, 30));
    const final = store.get(plan.id);
    expect(final!.status).toBe('done');
  });

  it('POST /execute with legacy {plan} form persists, executes, returns runId', async () => {
    const app = makeApp();
    const res = await app.request('/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'inline',
        plan: { steps: [{ description: 'a', agentId: 'dev' }] },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.planId).toBeTruthy();
    expect(body.runId).toBe('run-1');
    expect(body.status).toBe('executing');

    // The plan should now be 'done' in the store (synchronous legacy path)
    const stored = store.get(body.planId);
    expect(stored?.status).toBe('done');
    expect(stored?.origin).toBe('nl');
  });

  it('POST /execute returns 400 when neither planId nor plan provided', async () => {
    const app = makeApp();
    const res = await app.request('/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /execute returns 404 for unknown planId', async () => {
    const app = makeApp();
    const res = await app.request('/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /plans returns NL-origin plans backed by the unified table', async () => {
    const app = makeApp();
    const res = await app.request('/plans');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Each row carries the legacy shape — id, prompt, status, created_at
    for (const row of body) {
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('prompt');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('created_at');
    }
  });
});
