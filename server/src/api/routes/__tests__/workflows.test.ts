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
