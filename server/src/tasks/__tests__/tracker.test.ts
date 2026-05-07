import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
import { TaskTracker } from '../../tasks/tracker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('TaskTracker', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-task-test-'));
  let tracker: TaskTracker;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new TaskTracker();
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  it('full lifecycle: pending → running → complete', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'test' });
    expect(t.status).toBe('pending');

    tracker.setRunning(t.id);
    expect(tracker.get(t.id)?.status).toBe('running');

    tracker.setComplete(t.id, 'done');
    expect(tracker.get(t.id)?.status).toBe('complete');
    expect(tracker.get(t.id)?.result).toBe('done');
  });

  it('failure path', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'fail' });
    tracker.setRunning(t.id);
    tracker.setFailed(t.id, 'error msg');
    expect(tracker.get(t.id)?.status).toBe('failed');
    expect(tracker.get(t.id)?.result).toBe('error msg');
  });

  it('setNeedsReview', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'stale' });
    tracker.setRunning(t.id);
    tracker.setNeedsReview(t.id, 'timed out');
    expect(tracker.get(t.id)?.status).toBe('needs_review');
  });

  it('list with project filter', () => {
    tracker.create({ projectId: 'p1', agentId: 'a1', description: 'p1 task' });
    tracker.create({ projectId: 'p2', agentId: 'a2', description: 'p2 task' });
    expect(tracker.list('p1').length).toBeGreaterThanOrEqual(1);
    expect(tracker.list('p2').length).toBeGreaterThanOrEqual(1);
    expect(tracker.list('p1').every(t => t.projectId === 'p1')).toBe(true);
  });

  it('get returns null for nonexistent task', () => {
    expect(tracker.get('nonexistent')).toBeNull();
  });

  it('recoverStaleTasks marks running tasks as needs_review', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'stale' });
    tracker.setRunning(t.id);
    const recovered = tracker.recoverStaleTasks();
    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(tracker.get(t.id)?.status).toBe('needs_review');
  });
});
