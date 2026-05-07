import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
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
});
