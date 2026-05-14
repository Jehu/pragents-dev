import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { initDb, closeDb, getDb } from '../../../db/sqlite.js';
import { TaskTracker } from '../../../tasks/tracker.js';
import { EventBuffer } from '../../../events/buffer.js';
import { createAgentDetailRoute } from '../agents.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ResolvedAgent } from '../../../config/schema.js';

function makeAgent(id: string, overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id,
    projectId: 'project-test',
    type: 'dev',
    model: 'claude-sonnet',
    skills: ['coding', 'review'],
    personality: 'helpful',
    memory: { project: 'read/write', company: 'read' },
    projectDir: '/tmp',
    tokenBudget: 20000,
    keepWarm: false,
    ...overrides,
  };
}

function makeSessionMgr(agentId: string, sessionExists: boolean, isStreaming = false) {
  return {
    getAgentStatus: (id: string) => {
      if (id !== agentId) return 'offline' as const;
      return sessionExists ? (isStreaming ? 'busy' as const : 'idle' as const) : 'offline' as const;
    },
    getSessionInfo: (id: string) => {
      if (id !== agentId || !sessionExists) return null;
      return {
        id: `session-${agentId}`,
        startedAt: new Date().toISOString(),
        idleTimeoutMs: 600_000,
        msUntilIdle: 300_000,
      };
    },
    stopAgent: vi.fn(async (_id: string) => sessionExists ? `session-${agentId}` : null),
  } as any;
}

describe('GET /agents/:id', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-agents-test-'));
  let tracker: TaskTracker;
  let eventBuffer: EventBuffer;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new TaskTracker();
    eventBuffer = new EventBuffer(100);
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('returns 404 for unknown agent', async () => {
    const agent = makeAgent('dev@p1');
    const sessionMgr = makeSessionMgr('dev@p1', false);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/unknown-agent');
    expect(res.status).toBe(404);
  });

  it('returns agent detail with null session when offline', async () => {
    const agent = makeAgent('dev@p1');
    const sessionMgr = makeSessionMgr('dev@p1', false);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/dev@p1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('dev@p1');
    expect(body.session).toBeNull();
    expect(body.status).toBe('offline');
    expect(body.stats).toHaveProperty('tasksToday');
    expect(body.stats).toHaveProperty('tasksTodayComplete');
    expect(body.stats).toHaveProperty('avgLatencyP50Ms');
    expect(body.stats).toHaveProperty('costToday');
  });

  it('returns session info when session active', async () => {
    const agent = makeAgent('pm@p1');
    const sessionMgr = makeSessionMgr('pm@p1', true);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/pm@p1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).not.toBeNull();
    expect(body.session.id).toBe('session-pm@p1');
    expect(body.session).toHaveProperty('idleTimeoutMs');
    expect(body.session).toHaveProperty('msUntilIdle');
  });

  it('includes tasksToday stats', async () => {
    const agent = makeAgent('dev@stats');
    tracker.create({ projectId: 'project-test', agentId: 'dev@stats', description: 'Task A' });
    const t2 = tracker.create({ projectId: 'project-test', agentId: 'dev@stats', description: 'Task B' });
    tracker.setRunning(t2.id);
    tracker.setComplete(t2.id, 'done');

    const sessionMgr = makeSessionMgr('dev@stats', false);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/dev@stats');
    const body = await res.json();
    expect(body.stats.tasksToday).toBeGreaterThanOrEqual(2);
    expect(body.stats.tasksTodayComplete).toBeGreaterThanOrEqual(1);
  });

  it('includes skillsLoaded from agent config', async () => {
    const agent = makeAgent('dev@skills', { skills: ['skill-a', 'skill-b'] });
    const sessionMgr = makeSessionMgr('dev@skills', false);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/dev@skills');
    const body = await res.json();
    expect(body.skillsLoaded).toHaveLength(2);
    expect(body.skillsLoaded[0]).toHaveProperty('name');
    expect(body.skillsLoaded[0]).toHaveProperty('jit');
  });
});

describe('POST /agents/:id/stop', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-agents-stop-test-'));
  let tracker: TaskTracker;
  let eventBuffer: EventBuffer;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new TaskTracker();
    eventBuffer = new EventBuffer(100);
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('returns stopped:false when no active session', async () => {
    const agent = makeAgent('dev@nostop');
    const sessionMgr = makeSessionMgr('dev@nostop', false);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/dev@nostop/stop', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stopped).toBe(false);
    expect(body.reason).toBe('no_active_session');
  });

  it('returns stopped:true with sessionId when session exists', async () => {
    const agent = makeAgent('dev@stop');
    const sessionMgr = makeSessionMgr('dev@stop', true);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    const res = await app.request('/dev@stop/stop', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stopped).toBe(true);
    expect(body.sessionId).toBe('session-dev@stop');
    expect(sessionMgr.stopAgent).toHaveBeenCalledWith('dev@stop');
  });

  it('marks running tasks as failed on stop', async () => {
    const agent = makeAgent('dev@stoptasks');
    const task = tracker.create({ projectId: 'project-test', agentId: 'dev@stoptasks', description: 'mid-task' });
    tracker.setRunning(task.id);

    const sessionMgr = makeSessionMgr('dev@stoptasks', true);
    const app = createAgentDetailRoute([agent], sessionMgr, eventBuffer, tracker);
    await app.request('/dev@stoptasks/stop', { method: 'POST' });

    const updated = tracker.get(task.id)!;
    expect(updated.status).toBe('failed');
    expect(updated.result).toBe('agent_stopped');
  });

  it('is idempotent — second stop returns no_active_session', async () => {
    const agent = makeAgent('dev@idempotent');
    // First stop: session exists
    const sessionMgr1 = makeSessionMgr('dev@idempotent', true);
    const app1 = createAgentDetailRoute([agent], sessionMgr1, eventBuffer, tracker);
    await app1.request('/dev@idempotent/stop', { method: 'POST' });

    // Second stop: no session
    const sessionMgr2 = makeSessionMgr('dev@idempotent', false);
    const app2 = createAgentDetailRoute([agent], sessionMgr2, eventBuffer, tracker);
    const res = await app2.request('/dev@idempotent/stop', { method: 'POST' });
    const body = await res.json();
    expect(body.stopped).toBe(false);
    expect(body.reason).toBe('no_active_session');
  });
});
