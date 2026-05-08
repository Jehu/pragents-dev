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

  it('setNeedsReview stores reason in dedicated column, not result', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'stale' });
    tracker.setRunning(t.id);
    tracker.setNeedsReview(t.id, 'PR bitte reviewen');
    const fetched = tracker.get(t.id)!;
    expect(fetched.status).toBe('needs_review');
    expect(fetched.reason).toBe('PR bitte reviewen');
    expect(fetched.result).toBeNull();
  });

  it('setBlocked and setPending lifecycle', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'blocked task' });
    tracker.setRunning(t.id);
    tracker.setBlocked(t.id, 'Warte auf API-Zugang');
    let fetched = tracker.get(t.id)!;
    expect(fetched.status).toBe('blocked');
    expect(fetched.reason).toBe('Warte auf API-Zugang');

    tracker.setPending(t.id);
    fetched = tracker.get(t.id)!;
    expect(fetched.status).toBe('pending');
    expect(fetched.reason).toBeNull();
  });

  it('setBlocked on already blocked task updates reason', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'blocked' });
    tracker.setBlocked(t.id, 'first reason');
    tracker.setBlocked(t.id, 'updated reason');
    expect(tracker.get(t.id)?.reason).toBe('updated reason');
    expect(tracker.get(t.id)?.status).toBe('blocked');
  });

  it('create with custom status', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'needs review', status: 'needs_review' });
    expect(t.status).toBe('needs_review');
    expect(t.reason).toBeNull();
    expect(t.externalRef).toBeNull();
  });

  it('task includes reason and externalRef fields', () => {
    const t = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'fields check' });
    expect(t).toHaveProperty('reason');
    expect(t).toHaveProperty('externalRef');
    expect(t.reason).toBeNull();
    expect(t.externalRef).toBeNull();
  });

  it('list includes reason and externalRef', () => {
    const t = tracker.create({ projectId: 'p3', agentId: 'a1', description: 'list fields' });
    const tasks = tracker.list('p3');
    const found = tasks.find(task => task.id === t.id);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('reason');
    expect(found).toHaveProperty('externalRef');
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
