import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../../db/sqlite.js';
import { WorkflowTracker } from '../../../workflows/tracker.js';
import { WorkflowRegistry } from '../../../workflows/loader.js';
import { createWorkflowsRoute } from '../workflows.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Minimal mock engine — only execute is needed for the route
function mockEngine() {
  return { execute: async () => 'mock-run-id' } as any;
}

describe('Workflows Route', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-wf-route-test-'));
  let tracker: WorkflowTracker;
  let registry: WorkflowRegistry;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new WorkflowTracker();
    registry = new WorkflowRegistry();
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  it('GET /runs/:id returns gateStatus and gateFeedback for gate steps', async () => {
    const db = getDb();
    const run = tracker.createRun('test-wf');
    const step = tracker.createStep(run.id, 'review');
    tracker.startStep(step.id);
    tracker.completeStep(step.id, 'approved');

    // Create a gate for this step
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('gate-test-1', run.id, 'review', 'Review please', 'approved', new Date(Date.now() + 3600000).toISOString());

    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request(`/runs/${run.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].gateStatus).toBe('approved');
    expect(body.steps[0].gateFeedback).toBeNull();
  });

  it('GET /runs/:id attaches plan context for plan-* runs', async () => {
    const db = getDb();
    const run = tracker.createRun('plan-abcd1234');
    const step = tracker.createStep(run.id, 'step-0');
    tracker.startStep(step.id);
    tracker.completeStep(step.id, 'first step done');

    db.prepare(
      `INSERT INTO plans (id, status, origin, prompt, steps_json, result_json, created_at)
       VALUES (?, 'done', 'chat', ?, ?, ?, datetime('now'))`,
    ).run(
      'abcd1234-full-plan-id',
      'read and implement the gist',
      JSON.stringify([{ agentId: 'dev@wiki', description: 'Read the gist and summarize it' }]),
      JSON.stringify({ runId: run.id }),
    );

    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request(`/runs/${run.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.plan).toEqual({
      id: 'abcd1234-full-plan-id',
      prompt: 'read and implement the gist',
      stepDescriptions: ['Read the gist and summarize it'],
    });

    // List endpoint carries the same enrichment
    const listRes = await app.request('/runs?includeSteps=true');
    const runs = await listRes.json();
    const planRun = runs.find((r: any) => r.id === run.id);
    expect(planRun.plan.id).toBe('abcd1234-full-plan-id');
  });

  it('GET /runs/:id returns plan=null for non-plan runs and unlinked plan runs', async () => {
    const app = createWorkflowsRoute(registry, mockEngine(), tracker);

    const normal = tracker.createRun('content-pipeline');
    const res1 = await app.request(`/runs/${normal.id}`);
    expect((await res1.json()).plan).toBeNull();

    // plan-* name but no plan row pointing at this run
    const orphan = tracker.createRun('plan-ffffffff');
    const res2 = await app.request(`/runs/${orphan.id}`);
    expect((await res2.json()).plan).toBeNull();
  });

  it('GET /runs/:id returns gateStatus=null for steps without gates', async () => {
    const run = tracker.createRun('test-wf-2');
    const step = tracker.createStep(run.id, 'research');
    tracker.startStep(step.id);
    tracker.completeStep(step.id, 'research done');

    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request(`/runs/${run.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].gateStatus).toBeNull();
    expect(body.steps[0].gateFeedback).toBeNull();
  });

  it('GET /runs/:id returns latest gate per step (revision case)', async () => {
    const db = getDb();
    const run = tracker.createRun('test-wf-3');
    const step = tracker.createStep(run.id, 'review');
    tracker.startStep(step.id);
    tracker.completeStep(step.id, 'approved');

    // Create two gates for the same step (revision scenario)
    // Insert older gate first, then newer — ORDER BY created_at DESC returns newest
    const oldCreatedAt = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
    const newCreatedAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, feedback, timeout_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('gate-rev-old', run.id, 'review', 'Review', 'revision_requested', 'Make it better', new Date(Date.now() + 3600000).toISOString(), oldCreatedAt);
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, feedback, timeout_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('gate-rev-new', run.id, 'review', 'Review', 'approved', 'Make it better', new Date(Date.now() + 3600000).toISOString(), newCreatedAt);

    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request(`/runs/${run.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.steps).toHaveLength(1);
    // Should return the latest gate (newest created_at)
    expect(body.steps[0].gateStatus).toBe('approved');
    expect(body.steps[0].gateFeedback).toBe('Make it better');
  });

  it('GET /runs/:id returns 404 for nonexistent run', async () => {
    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request('/runs/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /runs?includeSteps=true returns runs with enriched steps', async () => {
    const db = getDb();
    const run = tracker.createRun('test-wf-steps');
    const step = tracker.createStep(run.id, 'review');
    tracker.startStep(step.id);
    tracker.completeStep(step.id, 'approved');

    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('gate-steps-1', run.id, 'review', 'Review', 'pending', new Date(Date.now() + 3600000).toISOString());

    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request('/runs?includeSteps=true');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    const enrichedRun = body.find((r: any) => r.id === run.id);
    expect(enrichedRun).toBeDefined();
    expect(enrichedRun.steps).toBeDefined();
    expect(enrichedRun.steps[0].gateStatus).toBe('pending');
  });

  it('GET /runs without includeSteps returns runs without steps', async () => {
    tracker.createRun('test-wf-nosteps');
    const app = createWorkflowsRoute(registry, mockEngine(), tracker);
    const res = await app.request('/runs');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    // Without includeSteps, steps field should not be present
    expect(body[0].steps).toBeUndefined();
  });
});
