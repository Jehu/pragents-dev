import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ToolExecutor } from '../tool-executor.js';
import { initDb, closeDb } from '../../db/sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-te-test-'));
beforeAll(() => initDb(join(tmpDir, 'test.db')));
afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

function makeDeps(overrides: Record<string, any> = {}) {
  return {
    tracker: {
      list: vi.fn().mockReturnValue([]),
      create: vi.fn().mockReturnValue({ id: 'task-1', status: 'pending' }),
      setComplete: vi.fn(),
      setFailed: vi.fn(),
    },
    wfEngine: {
      execute: vi.fn().mockResolvedValue('run-1'),
    },
    wfRegistry: {
      get: vi.fn().mockReturnValue({ name: 'test-wf' }),
      list: vi.fn().mockReturnValue([{ name: 'test-wf', description: 'A test workflow' }]),
    },
    wfTracker: {
      listRuns: vi.fn().mockReturnValue([{ id: 'r1', workflowName: 'test-wf', status: 'complete' }]),
    },
    memory: {
      recall: vi.fn().mockResolvedValue([{ id: 'f1', content: 'test', metadata: {} }]),
      remember: vi.fn().mockResolvedValue('fact-1'),
      forget: vi.fn().mockResolvedValue(undefined),
    },
    skills: {
      list: vi.fn().mockReturnValue([{ name: 'code-review', description: 'Review code' }]),
    },
    costTracker: {
      getProjectCost: vi.fn().mockReturnValue({ tokensIn: 1000, tokensOut: 500, cost: 0.05 }),
    },
    agents: [
      { id: 'dev@proj-a', type: 'dev', projectId: 'proj-a', skills: ['typescript'] },
      { id: 'seo@proj-a', type: 'seo', projectId: 'proj-a', skills: ['keyword-research'] },
    ],
    goalRegistry: {
      list: vi.fn().mockReturnValue([{ id: 'weekly-article', cadence: '0 8 * * 1', workflow: 'content-pipeline' }]),
    },
    eventBuffer: {
      getRecent: vi.fn().mockReturnValue([{ id: 1, type: 'task.started' }]),
    },
    decomposer: {
      decompose: vi.fn().mockResolvedValue({ steps: [{ id: 'step1', description: 'Research', agent: 'dev' }] }),
    },
    dispatchTask: vi.fn().mockResolvedValue('dispatched'),
    ...overrides,
  } as any;
}

describe('ToolExecutor', () => {
  it('executes query_tasks with projectId', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('query_tasks', { projectId: 'proj-a' });
    expect(deps.tracker.list).toHaveBeenCalledWith('proj-a');
    expect(JSON.parse(result)).toEqual([]);
  });

  it('executes query_tasks with status filter', async () => {
    const deps = makeDeps({
      tracker: { list: vi.fn().mockReturnValue([{ id: 't1', status: 'running' }, { id: 't2', status: 'complete' }]) },
    });
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('query_tasks', { projectId: 'proj-a', status: 'running' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('t1');
  });

  it('executes create_task and triggers dispatch', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('create_task', {
      projectId: 'proj-a', agentId: 'dev@proj-a', description: 'Fix bug',
    });
    expect(deps.tracker.create).toHaveBeenCalledWith({ projectId: 'proj-a', agentId: 'dev@proj-a', description: 'Fix bug' });
    expect(deps.dispatchTask).toHaveBeenCalledWith('proj-a', 'dev@proj-a', 'Fix bug');
    const parsed = JSON.parse(result);
    expect(parsed.taskId).toBe('task-1');
  });

  it('executes run_workflow', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('run_workflow', { workflowName: 'test-wf', projectId: 'proj-a' });
    expect(deps.wfRegistry.get).toHaveBeenCalledWith('test-wf');
    expect(deps.wfEngine.execute).toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed.runId).toBe('run-1');
  });

  it('returns error for unknown workflow', async () => {
    const deps = makeDeps({ wfRegistry: { get: vi.fn().mockReturnValue(null), list: vi.fn() } });
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('run_workflow', { workflowName: 'nope', projectId: 'proj-a' });
    expect(result).toContain('Error: Workflow "nope" not found');
  });

  it('executes list_workflows', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('list_workflows', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('test-wf');
  });

  it('executes approve_gate for pending gate', async () => {
    // Insert a test gate row
    const { getDb } = await import('../../db/sqlite.js');
    const db = getDb();
    db.prepare("INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)").run(
      'gate-1', 'run-1', 'step1', 'Approve test', new Date(Date.now() + 3600000).toISOString(),
    );
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('approve_gate', { gateId: 'gate-1' });
    expect(result).toContain('approved');
    // Clean up
    db.prepare("DELETE FROM human_gates WHERE id = 'gate-1'").run();
  });

  it('executes reject_gate', async () => {
    const { getDb } = await import('../../db/sqlite.js');
    const db = getDb();
    db.prepare("INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)").run(
      'gate-2', 'run-1', 'step1', 'Reject test', new Date(Date.now() + 3600000).toISOString(),
    );
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('reject_gate', { gateId: 'gate-2', reason: 'Not needed' });
    expect(result).toContain('rejected');
    expect(result).toContain('Not needed');
    db.prepare("DELETE FROM human_gates WHERE id = 'gate-2'").run();
  });

  it('executes search_memory', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('search_memory', { query: 'test', scope: 'project' });
    expect(deps.memory.recall).toHaveBeenCalledWith('test', 'project', 10);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
  });

  it('executes remember_fact', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('remember_fact', {
      content: 'Use Hono', category: 'convention', scope: 'company',
    });
    expect(deps.memory.remember).toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('remembered');
  });

  it('executes list_skills', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('list_skills', {});
    expect(deps.skills.list).toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed[0].name).toBe('code-review');
  });

  it('executes get_cost_summary', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('get_cost_summary', { projectId: 'proj-a' });
    expect(deps.costTracker.getProjectCost).toHaveBeenCalledWith('proj-a');
    const parsed = JSON.parse(result);
    expect(parsed.cost).toBe(0.05);
  });

  it('returns error for unknown tool name', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('nonexistent_tool', {});
    expect(result).toContain('Error: Unknown tool');
    expect(result).toContain('Available tools');
  });

  it('catches and returns error on service failure', async () => {
    const deps = makeDeps({
      tracker: { list: vi.fn().mockImplementation(() => { throw new Error('DB down'); }) },
    });
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('query_tasks', { projectId: 'proj-a' });
    expect(result).toBe('Error: DB down');
  });

  it('executes all 18 tools without errors', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const tools = [
      { name: 'query_tasks', args: { projectId: 'p' } },
      { name: 'create_task', args: { projectId: 'p', agentId: 'a', description: 'd' } },
      { name: 'run_workflow', args: { workflowName: 'w', projectId: 'p' } },
      { name: 'list_workflows', args: {} },
      { name: 'approve_gate', args: { gateId: 'g' } },
      { name: 'reject_gate', args: { gateId: 'g' } },
      { name: 'search_memory', args: { query: 'q' } },
      { name: 'remember_fact', args: { content: 'c', category: 'convention', scope: 'project' } },
      { name: 'list_skills', args: {} },
      { name: 'get_cost_summary', args: { projectId: 'p' } },
      { name: 'list_agents', args: {} },
      { name: 'list_goals', args: {} },
      { name: 'get_goal_runs', args: {} },
      { name: 'list_pending_gates', args: {} },
      { name: 'get_workflow_runs', args: {} },
      { name: 'list_events', args: {} },
      { name: 'delete_fact', args: { factId: 'f1' } },
    ];
    for (const t of tools) {
      const result = await executor.execute(t.name, t.args);
      expect(result).toBeTruthy();
      expect(result).not.toContain('Error: Unknown tool');
    }
  });

  it('executes list_agents', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('list_agents', {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('dev@proj-a');
  });

  it('executes list_goals', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('list_goals', {});
    expect(deps.goalRegistry.list).toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed[0].id).toBe('weekly-article');
  });

  it('executes get_workflow_runs', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('get_workflow_runs', { limit: 5 });
    expect(deps.wfTracker.listRuns).toHaveBeenCalledWith(5);
    const parsed = JSON.parse(result);
    expect(parsed[0].workflowName).toBe('test-wf');
  });

  it('executes list_events', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('list_events', { limit: 10 });
    expect(deps.eventBuffer.getRecent).toHaveBeenCalledWith(10);
    const parsed = JSON.parse(result);
    expect(parsed[0].type).toBe('task.started');
  });

  it('executes delete_fact', async () => {
    const deps = makeDeps();
    const executor = new ToolExecutor(deps);
    const result = await executor.execute('delete_fact', { factId: 'f1' });
    expect(deps.memory.forget).toHaveBeenCalledWith('f1');
    expect(result).toContain('deleted');
  });
});
