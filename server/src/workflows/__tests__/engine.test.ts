import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
import { WorkflowTracker } from '../../workflows/tracker.js';
import { SkillRouter } from '../../routing/router.js';
import { WorkflowEngine } from '../../workflows/engine.js';
import { EventBuffer } from '../../events/buffer.js';
import type { ResolvedAgent, AgentType } from '../../config/schema.js';
import type { WorkflowDef } from '../../workflows/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function agent(id: string, type: AgentType, skills: string[], projectId = 'test-project'): ResolvedAgent {
  return { id, projectId, type, model: 'test/model', personality: '', memory: {}, skills, projectDir: '/tmp/test-project', tokenBudget: 40000 };
}

const agents = [
  agent('dev@test-project', 'dev', ['typescript', 'react', 'testing'], 'test-project'),
  agent('seo@test-project', 'seo', ['keyword-research', 'technical-seo'], 'test-project'),
];

const simpleWf: WorkflowDef = {
  name: 'simple-test',
  steps: [
    { id: 'step1', agent: 'dev@test-project', prompt: 'Do step 1' },
  ],
};

const twoStepWf: WorkflowDef = {
  name: 'two-step',
  steps: [
    { id: 'step1', agent: 'dev@test-project', prompt: 'Do step 1' },
    { id: 'step2', agent: 'seo@test-project', prompt: 'Do step 2' },
  ],
};

const parallelWf: WorkflowDef = {
  name: 'parallel-test',
  steps: [
    {
      id: 'group1', parallel: [
        { id: 'p1', agent: 'dev@test-project', prompt: 'Parallel 1' },
        { id: 'p2', agent: 'seo@test-project', prompt: 'Parallel 2' },
      ],
    },
  ],
};

const conditionalWf: WorkflowDef = {
  name: 'conditional-test',
  steps: [
    { id: 'step1', agent: 'dev@test-project', prompt: 'Do step 1', output: 'result1' },
    { id: 'step2', agent: 'seo@test-project', prompt: 'Do step 2', condition: "result1.output includes 'done'" },
  ],
};

describe('WorkflowEngine', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-wfe-test-'));
  let tracker: WorkflowTracker;
  let router: SkillRouter;
  let eventBuffer: EventBuffer;
  let sessionMgr: any;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new WorkflowTracker();
    router = new SkillRouter(agents);
    eventBuffer = new EventBuffer(100);
    sessionMgr = {
      dispatch: vi.fn().mockResolvedValue('## Agent response\n\nTask completed successfully.'),
    };
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  it('executes simple single-step workflow', async () => {
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    const result = await engine.execute(simpleWf);
    expect(result).toBeTruthy();
    expect(sessionMgr.dispatch).toHaveBeenCalled();
  });

  it('executes two sequential steps', async () => {
    // Reset mock count
    sessionMgr.dispatch.mockClear();
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    await engine.execute(twoStepWf);
    expect(sessionMgr.dispatch).toHaveBeenCalledTimes(2);
  });

  it('executes parallel steps with allSettled', async () => {
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    const result = await engine.execute(parallelWf);
    expect(result).toBeTruthy();
  });

  it('executes conditional step when condition passes', async () => {
    const mockWithResult = {
      dispatch: vi.fn().mockResolvedValue('Task done successfully'),
    };
    const engine = new WorkflowEngine(tracker, router, mockWithResult, agents, eventBuffer, 'test-project');
    await engine.execute(conditionalWf);
    // Condition matches → both steps execute
    expect(mockWithResult.dispatch).toHaveBeenCalledTimes(2);
  });

  it('skips conditional step when condition fails', async () => {
    const mockWithResult = {
      dispatch: vi.fn().mockResolvedValue('Step 1 result: failure'),
    };
    const engine = new WorkflowEngine(tracker, router, mockWithResult, agents, eventBuffer, 'test-project');
    await engine.execute(conditionalWf);
    // Condition $result1 contains 'done' fails → step2 skipped
    expect(mockWithResult.dispatch).toHaveBeenCalledTimes(1);
  });

  it('failRun on step failure', async () => {
    const failing = {
      dispatch: vi.fn().mockRejectedValue(new Error('Boom')),
    };
    const engine = new WorkflowEngine(tracker, router, failing, agents, eventBuffer, 'test-project');
    await expect(engine.execute(simpleWf)).rejects.toThrow('Boom');
  });

  it('emits events to buffer', async () => {
    const buf = new EventBuffer(100);
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, buf, 'test-project');
    await engine.execute(simpleWf);
    const events = buf.getSince(0);
    expect(events.length).toBeGreaterThan(0);
    const started = events.find((e: any) => e.type === 'workflow.step_started');
    expect(started).toBeDefined();
  });

  it('recoverStaleRuns works', () => {
    const run = tracker.createRun('stale-wf');
    const recovered = tracker.recoverStaleRuns();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('interrupted');
  });
});
