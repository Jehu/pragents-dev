import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../db/sqlite.js';
import { WorkflowTracker } from '../../workflows/tracker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WorkflowTracker', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-wft-test-'));
  let tracker: WorkflowTracker;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new WorkflowTracker();
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  it('full run lifecycle: running → complete', () => {
    const run = tracker.createRun('content-pipeline', { topic: 'test' });
    expect(run.status).toBe('running');
    expect(run.workflowName).toBe('content-pipeline');

    const step = tracker.createStep(run.id, 'research');
    expect(step.status).toBe('pending');

    tracker.startStep(step.id);
    const run2 = tracker.getRun(run.id);
    expect(run2).not.toBeNull();

    tracker.completeStep(step.id, 'research result');
    tracker.completeRun(run.id);

    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('complete');
    expect(final?.completedAt).toBeTruthy();
  });

  it('step failure → run failure', () => {
    const run = tracker.createRun('failing');
    const step = tracker.createStep(run.id, 'bad-step');
    tracker.startStep(step.id);
    tracker.failStep(step.id, 'boom');
    tracker.failRun(run.id);

    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('failed');

    const steps = tracker.getSteps(run.id);
    expect(steps[0].status).toBe('failed');
    expect(steps[0].output).toBe('boom');
  });

  it('skipStep marks step as skipped', () => {
    const run = tracker.createRun('skip-test');
    const step = tracker.createStep(run.id, 'optional');
    tracker.skipStep(step.id);

    const steps = tracker.getSteps(run.id);
    expect(steps[0].status).toBe('skipped');
  });

  it('listRuns returns most recent first', () => {
    const r1 = tracker.createRun('list-test-w1');
    const r2 = tracker.createRun('list-test-w2');
    const runs = tracker.listRuns(100).filter((r: any) => r.workflowName === 'list-test-w1' || r.workflowName === 'list-test-w2');
    expect(runs).toHaveLength(2);
    const ids = runs.map(r => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
  });

  it('getRunsByIds returns a map of all requested runs', () => {
    const a = tracker.createRun('batch-a', { x: 1 });
    const b = tracker.createRun('batch-b');
    const map = tracker.getRunsByIds([a.id, b.id, 'missing-id']);
    expect(map.size).toBe(2);
    expect(map.get(a.id)?.workflowName).toBe('batch-a');
    expect(map.get(a.id)?.params).toEqual({ x: 1 });
    expect(map.get(b.id)?.workflowName).toBe('batch-b');
  });

  it('getRunsByIds returns an empty map for an empty id list', () => {
    expect(tracker.getRunsByIds([]).size).toBe(0);
  });

  it('getStepsByRunIds groups steps by run with getSteps ordering', () => {
    const a = tracker.createRun('batch-steps-a');
    const b = tracker.createRun('batch-steps-b');
    const s1 = tracker.createStep(a.id, 'one');
    tracker.startStep(s1.id);
    tracker.completeStep(s1.id, 'r1');
    const s2 = tracker.createStep(a.id, 'two');
    tracker.startStep(s2.id);
    const s3 = tracker.createStep(b.id, 'solo');
    tracker.startStep(s3.id);

    const map = tracker.getStepsByRunIds([a.id, b.id]);
    expect(map.get(a.id)?.map((s) => s.stepId)).toEqual(
      tracker.getSteps(a.id).map((s) => s.stepId),
    );
    expect(map.get(b.id)?.map((s) => s.stepId)).toEqual(['solo']);
    expect(tracker.getStepsByRunIds([]).size).toBe(0);
  });

  it('getRun returns null for nonexistent', () => {
    expect(tracker.getRun('nonexistent')).toBeNull();
  });

  it('recoverStaleRuns marks running as interrupted', () => {
    const run = tracker.createRun('stale');
    const recovered = tracker.recoverStaleRuns();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('interrupted');
  });

  it('recoverStaleRuns skips runs waiting on a pending gate', () => {
    const run = tracker.createRun('gate-waiting');
    const db = getDb();
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)",
    ).run('gate-skip-1', run.id, 'review', 'Review please', new Date(Date.now() + 3600000).toISOString());

    tracker.recoverStaleRuns();
    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('running');
  });

  it('recoverStaleRuns skips runs waiting on a revision_requested gate', () => {
    const run = tracker.createRun('gate-rev-waiting');
    const db = getDb();
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('gate-skip-2', run.id, 'review', 'Review please', 'revision_requested', new Date(Date.now() + 3600000).toISOString());

    tracker.recoverStaleRuns();
    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('running');
  });

  it('recoverStaleRuns interrupts runs with only resolved gates', () => {
    const run = tracker.createRun('gate-resolved');
    const db = getDb();
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('gate-skip-3', run.id, 'review', 'Review please', 'approved', new Date(Date.now() + 3600000).toISOString());

    tracker.recoverStaleRuns();
    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('interrupted');
  });
});
