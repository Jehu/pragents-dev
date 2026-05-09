import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../../db/sqlite.js';
import { TaskTracker } from '../../../tasks/tracker.js';
import { EventBuffer } from '../../../events/buffer.js';
import { createTasksRoute } from '../tasks.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Tasks API', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-tasks-test-'));
  let tracker: TaskTracker;
  let eventBuffer: EventBuffer;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new TaskTracker();
    eventBuffer = new EventBuffer(100);
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  const createApp = () => createTasksRoute(tracker, [], { dispatch: () => Promise.resolve('ok'), getActiveAgents: () => [], getAgentStatus: () => 'offline' } as any, eventBuffer);

  // ---- Response shape ----
  it('GET / returns wrapped { tasks, total, page, limit }', async () => {
    const app = createApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('tasks');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  // ---- Filters ----
  it('GET / filters by status', async () => {
    tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Task 1', status: 'pending' });
    tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Task 2', status: 'needs_review' });
    const app = createApp();
    const res = await app.request('/?status=needs_review');
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].status).toBe('needs_review');
  });

  it('GET / filters by project', async () => {
    tracker.create({ projectId: 'proj-a', agentId: 'a1', description: 'A' });
    tracker.create({ projectId: 'proj-b', agentId: 'a1', description: 'B' });
    const app = createApp();
    const res = await app.request('/?project=proj-a');
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
  });

  it('GET / paginates', async () => {
    for (let i = 0; i < 15; i++) {
      tracker.create({ projectId: 'p1', agentId: 'a1', description: `Task ${i}` });
    }
    const app = createApp();
    const res = await app.request('/?page=2&limit=5');
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.tasks.length).toBeLessThanOrEqual(5);
    expect(body.total).toBeGreaterThanOrEqual(15);
  });

  // ---- Retry ----
  it('POST /:id/retry restarts a needs_review task', async () => {
    const task = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Retry me' });
    tracker.setNeedsReview(task.id, 'test');
    expect(tracker.get(task.id)!.status).toBe('needs_review');

    const app = createTasksRoute(tracker, [{ id: 'a1', projectId: 'p1', type: 'dev', model: 'test' } as any], { dispatch: () => Promise.resolve('retried ok'), getActiveAgents: () => [], getAgentStatus: () => 'idle' } as any, eventBuffer);
    const res = await app.request(`/${task.id}/retry`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
  });

  it('POST /:id/retry returns 409 for already running task', async () => {
    const task = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Running task' });
    tracker.setRunning(task.id);
    const app = createApp();
    const res = await app.request(`/${task.id}/retry`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  // ---- Complete ----
  it('POST /:id/complete marks task as complete', async () => {
    const task = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Complete me' });
    const app = createApp();
    const res = await app.request(`/${task.id}/complete`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(tracker.get(task.id)!.status).toBe('complete');
  });

  // ---- Delete ----
  it('DELETE /:id marks task as failed', async () => {
    const task = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Delete me' });
    const app = createApp();
    const res = await app.request(`/${task.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.reason).toContain('deleted');
  });

  it('DELETE /:id returns 404 for non-existent task', async () => {
    const app = createApp();
    const res = await app.request('/nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  // ---- Event emission ----
  it('complete emits event to buffer', async () => {
    const task = tracker.create({ projectId: 'p1', agentId: 'a1', description: 'Event test' });
    const app = createApp();
    await app.request(`/${task.id}/complete`, { method: 'POST' });
    const events = eventBuffer.getSince(0);
    const completeEvent = events.find(e => e.type === 'task.manual_complete');
    expect(completeEvent).toBeDefined();
  });
});
