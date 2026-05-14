import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, getDb } from '../../db/sqlite.js';
import { GoalScheduler } from '../scheduler.js';
import type { ResolvedAgent } from '../../config/schema.js';

const mockPM: ResolvedAgent = {
  id: 'pm@company',
  projectId: 'company',
  type: 'pm',
  model: 'claude-sonnet',
  personality: 'You are a PM.',
  memory: { project: 'read', company: 'read/write' },
  skills: [],
  projectDir: '/tmp/test',
  tokenBudget: 30000,
  keepWarm: false,
};

describe('GoalScheduler pmCheck auto-extraction', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-scheduler-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  beforeEach(() => {
    // Clean sessions between tests
    getDb().exec('DELETE FROM sessions');
    getDb().exec('DELETE FROM session_messages');
  });

  function createMockDeps(autoExtractor?: any) {
    const mockSessionMgr = {
      getSessionMessages: vi.fn().mockReturnValue(null),
      dispatch: vi.fn().mockResolvedValue('OK'),
      setAutoExtractor: vi.fn(),
    };

    // Inject auto-extractor mock
    if (autoExtractor) {
      (mockSessionMgr as any).autoExtractor = autoExtractor;
    }

    return {
      wfRegistry: { get: vi.fn().mockReturnValue(null) } as any,
      wfEngine: { execute: vi.fn(), waitForGate: vi.fn() } as any,
      eventBuffer: { push: vi.fn(), getRecent: vi.fn().mockReturnValue([]), getSince: vi.fn().mockReturnValue([]) } as any,
      sessionMgr: mockSessionMgr as any,
      agents: [mockPM],
    };
  }

  it('scans ungeprüfte sessions and triggers tryExtract', async () => {
    const db = getDb();
    // Insert sessions with auto_extract_checked = 0
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sessions (id, agent_id, created_at, auto_extract_checked) VALUES (?, ?, ?, 0)',
    ).run('session-1', 'dev@test', now);
    db.prepare(
      'INSERT INTO sessions (id, agent_id, created_at, auto_extract_checked) VALUES (?, ?, ?, 0)',
    ).run('session-2', 'seo@test', now);

    // Insert session messages for eligibility
    const messages = JSON.stringify(Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    })));
    db.prepare(
      'INSERT INTO session_messages (id, session_id, messages_json, message_count) VALUES (?, ?, ?, ?)',
    ).run('msg-1', 'session-1', messages, 15);
    db.prepare(
      'INSERT INTO session_messages (id, session_id, messages_json, message_count) VALUES (?, ?, ?, ?)',
    ).run('msg-2', 'session-2', messages, 15);

    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    const deps = createMockDeps(mockAutoExtractor);
    // Override sessionMgr to return the real getSessionMessages
    deps.sessionMgr.getSessionMessages = vi.fn((sessionId: string) => {
      const row = db.prepare(
        'SELECT messages_json FROM session_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(sessionId) as any;
      return row ? JSON.parse(row.messages_json) : null;
    });

    const scheduler = new GoalScheduler(
      deps.wfRegistry,
      deps.wfEngine,
      deps.eventBuffer,
      deps.sessionMgr,
      deps.agents,
    );

    // Manually call the auto-extract scan part
    await (scheduler as any).pmAutoExtractCheck(mockAutoExtractor);

    // Both sessions should be triggered
    expect(mockAutoExtractor.tryExtract).toHaveBeenCalledTimes(2);

    // Sessions should be marked as checked
    const session1 = db.prepare('SELECT auto_extract_checked FROM sessions WHERE id = ?').get('session-1') as any;
    const session2 = db.prepare('SELECT auto_extract_checked FROM sessions WHERE id = ?').get('session-2') as any;
    expect(session1.auto_extract_checked).toBe(1);
    expect(session2.auto_extract_checked).toBe(1);
  });

  it('skips already-checked sessions', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sessions (id, agent_id, created_at, auto_extract_checked) VALUES (?, ?, ?, 1)',
    ).run('session-3', 'dev@test', now);

    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    const deps = createMockDeps(mockAutoExtractor);
    const scheduler = new GoalScheduler(
      deps.wfRegistry,
      deps.wfEngine,
      deps.eventBuffer,
      deps.sessionMgr,
      deps.agents,
    );

    await (scheduler as any).pmAutoExtractCheck(mockAutoExtractor);

    // Already-checked sessions should not trigger
    expect(mockAutoExtractor.tryExtract).not.toHaveBeenCalled();
  });

  it('handles empty sessions gracefully', async () => {
    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    const deps = createMockDeps(mockAutoExtractor);
    const scheduler = new GoalScheduler(
      deps.wfRegistry,
      deps.wfEngine,
      deps.eventBuffer,
      deps.sessionMgr,
      deps.agents,
    );

    // No sessions in DB
    await expect(
      (scheduler as any).pmAutoExtractCheck(mockAutoExtractor),
    ).resolves.toBeUndefined();
    expect(mockAutoExtractor.tryExtract).not.toHaveBeenCalled();
  });
});

describe('GoalScheduler pmCheck deadline escalation', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-scheduler-deadline-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM goal_runs');
    getDb().exec('DELETE FROM tasks');
  });

  function buildScheduler(sessionMgrOverrides?: Partial<{ dispatch: any }>) {
    const dispatch = vi.fn().mockResolvedValue('OK');
    const mockSessionMgr = {
      dispatch,
      getSessionMessages: vi.fn().mockReturnValue(null),
      setAutoExtractor: vi.fn(),
      ...(sessionMgrOverrides ?? {}),
    };
    const deps = {
      wfRegistry: { get: vi.fn().mockReturnValue(null) } as any,
      wfEngine: { execute: vi.fn(), waitForGate: vi.fn() } as any,
      eventBuffer: { push: vi.fn(), getRecent: vi.fn().mockReturnValue([]), getSince: vi.fn().mockReturnValue([]) } as any,
      sessionMgr: mockSessionMgr as any,
      agents: [mockPM],
    };
    const scheduler = new GoalScheduler(deps.wfRegistry, deps.wfEngine, deps.eventBuffer, deps.sessionMgr, deps.agents);
    return { scheduler, dispatch, deps };
  }

  it('escalates to PM when goal run has passed its deadline', async () => {
    const db = getDb();
    const goalRunId = 'gr-overdue';
    const wfRunId = 'wf-overdue';
    db.prepare(
      "INSERT INTO goal_runs (id, goal_id, workflow_run_id, status) VALUES (?, ?, ?, 'running')",
    ).run(goalRunId, 'daily-report', wfRunId);

    const { scheduler, dispatch } = buildScheduler();

    // Set up internal state: goal is overdue (deadline 1 ms ago)
    (scheduler as any).goals = [
      { id: 'daily-report', cadence: '0 8 * * *', workflow: 'daily', description: 'Daily report', warn_before_ms: 7200000 },
    ];
    (scheduler as any).activeGoalRuns.set(wfRunId, {
      goalRunId,
      deadline: new Date(Date.now() - 1), // already past
      goalId: 'daily-report',
    });

    await (scheduler as any).pmCheck();

    // PM should be dispatched with escalation message (3rd arg = task id)
    expect(dispatch).toHaveBeenCalledWith(
      mockPM,
      expect.stringContaining('daily-report'),
      expect.any(String),
    );
    expect(dispatch.mock.calls[0][1]).toMatch(/passed its deadline/);

    // Run should be removed from activeGoalRuns
    expect((scheduler as any).activeGoalRuns.has(wfRunId)).toBe(false);

    // DB row should be marked escalated
    const row = db.prepare('SELECT status FROM goal_runs WHERE id = ?').get(goalRunId) as any;
    expect(row.status).toBe('escalated');

    // Wait for async dispatch promise to settle, then verify task was persisted
    await new Promise(resolve => setTimeout(resolve, 10));
    const tasks = db.prepare("SELECT * FROM tasks WHERE type = 'escalation'").all() as any[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('complete');
    expect(tasks[0].agent_id).toBe(mockPM.id);
    expect(tasks[0].description).toMatch(/daily-report/);
  });

  it('marks escalation task failed and emits event when PM dispatch fails', async () => {
    const db = getDb();
    const goalRunId = 'gr-fail';
    const wfRunId = 'wf-fail';
    db.prepare(
      "INSERT INTO goal_runs (id, goal_id, workflow_run_id, status) VALUES (?, ?, ?, 'running')",
    ).run(goalRunId, 'daily-report', wfRunId);

    const dispatchError = new Error('PM agent unreachable');
    const { scheduler, deps } = buildScheduler({
      dispatch: vi.fn().mockRejectedValue(dispatchError),
    });

    (scheduler as any).goals = [
      { id: 'daily-report', cadence: '0 8 * * *', workflow: 'daily', description: 'Daily report', warn_before_ms: 7200000 },
    ];
    (scheduler as any).activeGoalRuns.set(wfRunId, {
      goalRunId,
      deadline: new Date(Date.now() - 1),
      goalId: 'daily-report',
    });

    await (scheduler as any).pmCheck();

    // Wait for async dispatch rejection to propagate
    await new Promise(resolve => setTimeout(resolve, 10));

    // Task should be marked failed
    const tasks = db.prepare("SELECT * FROM tasks WHERE type = 'escalation'").all() as any[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('failed');
    expect(tasks[0].result).toMatch(/unreachable/);

    // escalation.failed event should be emitted
    expect(deps.eventBuffer.push).toHaveBeenCalledWith(
      mockPM.projectId,
      mockPM.id,
      'escalation.failed',
      expect.objectContaining({ goalId: 'daily-report', error: 'PM agent unreachable' }),
      expect.any(String),
    );
  });

  it('does not escalate when goal run is not yet due', async () => {
    const db = getDb();
    const goalRunId = 'gr-future';
    const wfRunId = 'wf-future';
    db.prepare(
      "INSERT INTO goal_runs (id, goal_id, workflow_run_id, status) VALUES (?, ?, ?, 'running')",
    ).run(goalRunId, 'weekly-report', wfRunId);

    const { scheduler, dispatch } = buildScheduler();

    (scheduler as any).goals = [
      { id: 'weekly-report', cadence: '0 8 * * 1', workflow: 'weekly', description: 'Weekly report', warn_before_ms: 7200000 },
    ];
    // Deadline far in the future — outside the warn window too
    (scheduler as any).activeGoalRuns.set(wfRunId, {
      goalRunId,
      deadline: new Date(Date.now() + 86400000 * 2), // 2 days ahead
      goalId: 'weekly-report',
    });

    await (scheduler as any).pmCheck();

    // No PM dispatch for a not-yet-due goal
    expect(dispatch).not.toHaveBeenCalled();

    // Run should still be in activeGoalRuns
    expect((scheduler as any).activeGoalRuns.has(wfRunId)).toBe(true);
  });
});

// ---- I4/SL-4 regression: runGoalById manual trigger ----
describe('GoalScheduler runGoalById', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-runnow-test-'));

  beforeAll(() => { initDb(join(tmpDir, 'runnow.db')); });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });
  beforeEach(() => {
    getDb().exec('DELETE FROM goal_runs');
  });

  function mkScheduler() {
    const deps = {
      wfRegistry: { get: vi.fn().mockReturnValue({ name: 'wf', steps: [] }) } as any,
      wfEngine: {
        execute: vi.fn(),
        executeAsync: vi.fn().mockReturnValue('wf-run-id'),
      } as any,
      eventBuffer: { push: vi.fn() } as any,
      sessionMgr: { dispatch: vi.fn() } as any,
      agents: [mockPM],
    };
    const scheduler = new GoalScheduler(
      deps.wfRegistry, deps.wfEngine, deps.eventBuffer, deps.sessionMgr, deps.agents,
    );
    (scheduler as any).goals = [
      { id: 'g1', cadence: '0 0 * * *', deadline: null, workflow: 'wf', description: 'Test goal' },
    ];
    return { scheduler, deps };
  }

  it('rejects unknown goal id with "not found"', async () => {
    const { scheduler } = mkScheduler();
    await expect(scheduler.runGoalById('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('first trigger succeeds and returns workflowRunId', async () => {
    const { scheduler, deps } = mkScheduler();
    const { goalRunId, workflowRunId } = await scheduler.runGoalById('g1');
    expect(goalRunId).toBeTruthy();
    expect(workflowRunId).toBe('wf-run-id');
    expect(deps.wfEngine.executeAsync).toHaveBeenCalledTimes(1);
  });

  it('second trigger within 30s cooldown is rejected', async () => {
    const { scheduler } = mkScheduler();
    await scheduler.runGoalById('g1');
    // Second call immediately after — cooldown should fire.
    await expect(scheduler.runGoalById('g1')).rejects.toThrow(/cooldown/i);
  });

  it('rejects when a run is already active for the same goal', async () => {
    const { scheduler } = mkScheduler();
    // Manually populate the active-run map (simulating a concurrent run not
    // started via runGoalById, e.g., a cron tick).
    (scheduler as any).activeGoalRuns.set('wf-existing', {
      goalRunId: 'gr-existing', deadline: new Date(Date.now() + 86400000), goalId: 'g1',
    });
    await expect(scheduler.runGoalById('g1')).rejects.toThrow(/already running/i);
  });

  it('marks goal_run as failed when executeAsync throws synchronously (I2)', async () => {
    const { scheduler, deps } = mkScheduler();
    deps.wfEngine.executeAsync = vi.fn(() => { throw new Error('boom'); });
    await expect(scheduler.runGoalById('g1')).rejects.toThrow(/boom/);

    // The goal_runs row must reflect the failure, not stay in 'triggered'.
    const row = getDb().prepare('SELECT status FROM goal_runs WHERE goal_id = ?').get('g1') as { status: string } | undefined;
    expect(row?.status).toBe('failed');
  });

  it('prunes cooldown map for goals removed from config (I1)', async () => {
    const { scheduler, deps } = mkScheduler();
    await scheduler.runGoalById('g1');
    expect((scheduler as any).lastManualTrigger.has('g1')).toBe(true);

    // Reload with a config that no longer contains g1.
    (scheduler as any).jobs = [];
    scheduler.start([
      { id: 'g2', cadence: '0 0 * * *', deadline: null, workflow: 'wf', description: 'New goal' } as any,
    ]);
    expect((scheduler as any).lastManualTrigger.has('g1')).toBe(false);
    // Avoid leaking cron jobs into other tests.
    scheduler.stop();
    void deps;
  });
});
