import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../../db/sqlite.js';
import { TaskTracker } from '../../../tasks/tracker.js';
import { EventBuffer } from '../../../events/buffer.js';
import { WorkflowTracker } from '../../../workflows/tracker.js';
import { WorkflowRegistry } from '../../../workflows/loader.js';
import { createFeedRoute } from '../feed.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Feed API', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-feed-test-'));
  let tracker: TaskTracker;
  let eventBuffer: EventBuffer;
  let wfTracker: WorkflowTracker;
  let registry: WorkflowRegistry;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new TaskTracker();
    eventBuffer = new EventBuffer(100);
    wfTracker = new WorkflowTracker();
    registry = new WorkflowRegistry();
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  it('returns empty arrays when no data exists', async () => {
    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gates).toEqual([]);
    expect(body.needsReview).toEqual([]);
    expect(body.blocked).toEqual([]);
    expect(body.completedTasks).toEqual([]);
    expect(body.completedGates).toEqual([]);
  });

  it('returns needs_review tasks grouped correctly', async () => {
    tracker.create({ projectId: 'proj-1', agentId: 'dev', description: 'Review this PR', status: 'needs_review' });
    tracker.create({ projectId: 'proj-1', agentId: 'seo', description: 'Pending task' });

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/');
    const body = await res.json();
    expect(body.needsReview).toHaveLength(1);
    expect(body.needsReview[0].description).toBe('Review this PR');
    expect(body.needsReview[0].status).toBe('needs_review');
  });

  it('returns blocked tasks', async () => {
    const t = tracker.create({ projectId: 'proj-1', agentId: 'dev', description: 'Blocked on API' });
    tracker.setBlocked(t.id, 'Waiting for API access');

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/');
    const body = await res.json();
    expect(body.blocked).toHaveLength(1);
    expect(body.blocked[0].reason).toBe('Waiting for API access');
  });

  it('returns completed tasks', async () => {
    const t = tracker.create({ projectId: 'proj-1', agentId: 'dev', description: 'Done task' });
    tracker.setComplete(t.id, 'All done');

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/');
    const body = await res.json();
    expect(body.completedTasks.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by project parameter', async () => {
    tracker.create({ projectId: 'proj-a', agentId: 'dev', description: 'Project A task', status: 'needs_review' });
    tracker.create({ projectId: 'proj-b', agentId: 'dev', description: 'Project B task', status: 'needs_review' });

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?project=proj-a');
    const body = await res.json();
    expect(body.needsReview.every((t: any) => t.projectId === 'proj-a')).toBe(true);
  });

  it('filters by agent parameter', async () => {
    tracker.create({ projectId: 'proj-1', agentId: 'dev', description: 'Dev review', status: 'needs_review' });
    tracker.create({ projectId: 'proj-1', agentId: 'seo', description: 'SEO review', status: 'needs_review' });

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?agent=dev');
    const body = await res.json();
    expect(body.needsReview.every((t: any) => t.agentId === 'dev')).toBe(true);
  });

  it('filters by intent=gates returns only gates array', async () => {
    // Seed a pending gate
    getDb().prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)",
    ).run('gate-feed-1', 'run-1', 'step1', 'Approve feed', new Date(Date.now() + 3600000).toISOString());

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?intent=gates');
    const body = await res.json();
    expect(body.gates).toBeDefined();
    expect(body.gates.length).toBeGreaterThanOrEqual(1);
    expect(body.needsReview).toBeUndefined();
    expect(body.blocked).toBeUndefined();
  });

  it('enriches gates with workflow name and surrounding steps (batched fetch)', async () => {
    // Real run with a completed step before the gate and one step after it
    const run = wfTracker.createRun('enrich-wf');
    const done = wfTracker.createStep(run.id, 'draft', 'dev@proj-1');
    wfTracker.startStep(done.id);
    wfTracker.completeStep(done.id, 'draft output');
    getDb().prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)",
    ).run('gate-enrich-1', run.id, 'review', 'Review draft', new Date(Date.now() + 3600000).toISOString());

    // Register the workflow definition so the route can order steps around the gate
    (registry as any).workflows.set('enrich-wf', {
      def: {
        name: 'enrich-wf',
        steps: [
          { id: 'draft', type: 'agent', agent: 'dev@proj-1', prompt: 'Write draft', output: 'draft' },
          { id: 'review', type: 'human_gate', label: 'Review draft' },
          { id: 'publish', type: 'agent', agent: 'dev@proj-1', prompt: 'Publish' },
        ],
      },
      projectId: null,
    });

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?intent=gates');
    const body = await res.json();
    const gate = body.gates.find((g: any) => g.id === 'gate-enrich-1');
    expect(gate).toBeDefined();
    expect(gate.workflowName).toBe('enrich-wf');
    expect(gate.previousStepOutputs).toHaveLength(1);
    expect(gate.previousStepOutputs[0]).toMatchObject({
      stepId: 'draft',
      status: 'complete',
      output: 'draft output',
    });
    expect(gate.nextSteps).toEqual([
      { stepId: 'publish', type: 'agent', label: 'publish' },
    ]);
  });

  it('filters by intent=review returns only needsReview', async () => {
    tracker.create({ projectId: 'proj-1', agentId: 'dev', description: 'Review plz', status: 'needs_review' });

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?intent=review');
    const body = await res.json();
    expect(body.needsReview).toBeDefined();
    expect(body.gates).toBeUndefined();
    expect(body.blocked).toBeUndefined();
  });

  it('filters by intent=completed returns completedTasks and completedGates', async () => {
    const t = tracker.create({ projectId: 'proj-1', agentId: 'dev', description: 'Done' });
    tracker.setComplete(t.id, 'finished');

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?intent=completed');
    const body = await res.json();
    expect(body.completedTasks).toBeDefined();
    expect(body.completedGates).toBeDefined();
    expect(body.gates).toBeUndefined();
    expect(body.needsReview).toBeUndefined();
  });

  it('includes completed plans in completed intent', async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO plans
        (id, status, origin, agent_id, project_id, conversation_id, prompt, steps_json, result_json, created_at, ended_at)
       VALUES (?, 'done', 'chat', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'plan-feed-1',
      'dev',
      'proj-1',
      'conv-1',
      'Implement thing',
      JSON.stringify([{ description: 'Do it', agentId: 'dev' }]),
      JSON.stringify({ runId: 'run-feed-1' }),
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const app = createFeedRoute(tracker, eventBuffer, wfTracker, registry);
    const res = await app.request('/?intent=completed');
    const body = await res.json();
    expect(body.completedPlans).toBeDefined();
    expect(body.completedPlans.some((p: any) => p.id === 'plan-feed-1' && p.result.runId === 'run-feed-1')).toBe(true);
  });
});
