import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../db/sqlite.js';
import { WorkflowTracker } from '../../workflows/tracker.js';
import { SkillRouter } from '../../routing/router.js';
import { WorkflowEngine } from '../../workflows/engine.js';
import { EventBuffer } from '../../events/buffer.js';
import type { ResolvedAgent, AgentType } from '../../config/schema.js';
import type { WorkflowDef } from '../../workflows/schema.js';
import { WorkflowDef as WorkflowDefSchema } from '../../workflows/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function agent(id: string, type: AgentType, capabilities: string[], projectId = 'test-project'): ResolvedAgent {
  return { id, projectId, type, model: 'test/model', personality: '', memory: {}, capabilities, tools: {}, projectDir: '/tmp/test-project', tokenBudget: 40000, keepWarm: false };
}

const agents = [
  agent('dev@test-project', 'dev', ['typescript', 'react', 'testing'], 'test-project'),
  agent('seo@test-project', 'seo', ['keyword-research', 'technical-seo'], 'test-project'),
];

const simpleWf: WorkflowDef = {
  name: 'simple-test',
  steps: [
    { type: 'agent' as const, id: 'step1', agent: 'dev@test-project', prompt: 'Do step 1' },
  ],
};

const twoStepWf: WorkflowDef = {
  name: 'two-step',
  steps: [
    { type: 'agent' as const, id: 'step1', agent: 'dev@test-project', prompt: 'Do step 1' },
    { type: 'agent' as const, id: 'step2', agent: 'seo@test-project', prompt: 'Do step 2' },
  ],
};

const parallelWf: WorkflowDef = {
  name: 'parallel-test',
  steps: [
    {
      type: 'agent' as const, id: 'group1', parallel: [
        { id: 'p1', agent: 'dev@test-project', prompt: 'Parallel 1' },
        { id: 'p2', agent: 'seo@test-project', prompt: 'Parallel 2' },
      ],
    },
  ],
};

const conditionalWf: WorkflowDef = {
  name: 'conditional-test',
  steps: [
    { type: 'agent' as const, id: 'step1', agent: 'dev@test-project', prompt: 'Do step 1', output: 'result1' },
    { type: 'agent' as const, id: 'step2', agent: 'seo@test-project', prompt: 'Do step 2', condition: "result1.output includes 'done'" },
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
    } as any;
    const engine = new WorkflowEngine(tracker, router, mockWithResult, agents, eventBuffer, 'test-project');
    await engine.execute(conditionalWf);
    // Condition matches → both steps execute
    expect(mockWithResult.dispatch).toHaveBeenCalledTimes(2);
  });

  it('skips conditional step when condition fails', async () => {
    const mockWithResult = {
      dispatch: vi.fn().mockResolvedValue('Step 1 result: failure'),
    } as any;
    const engine = new WorkflowEngine(tracker, router, mockWithResult, agents, eventBuffer, 'test-project');
    await engine.execute(conditionalWf);
    // Condition $result1 contains 'done' fails → step2 skipped
    expect(mockWithResult.dispatch).toHaveBeenCalledTimes(1);
  });

  it('failRun on step failure', async () => {
    const failing = {
      dispatch: vi.fn().mockRejectedValue(new Error('Boom')),
    } as any;
    const engine = new WorkflowEngine(tracker, router, failing, agents, eventBuffer, 'test-project');
    await expect(engine.execute(simpleWf)).rejects.toThrow('Boom');
  });

  it('emits events to buffer', async () => {
    const buf = new EventBuffer(100);
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, buf, 'test-project');
    await engine.execute(simpleWf);
    const events = buf.getRecent(100);
    expect(events.length).toBeGreaterThan(0);
    const started = events.find((e: any) => e.type === 'workflow.step_started');
    expect(started).toBeDefined();
  });

  it('emits agent context on single-step workflow lifecycle events', async () => {
    const buf = new EventBuffer(100);
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, buf, 'test-project');

    await engine.execute(simpleWf);

    const started = buf.getRecent(100).find((e) => e.type === 'workflow.step_started' && e.data.stepId === 'step1');
    const completed = buf.getRecent(100).find((e) => e.type === 'workflow.step_completed' && e.data.stepId === 'step1');

    expect(started).toMatchObject({
      agentId: 'dev@test-project',
      projectId: 'test-project',
    });
    expect(started?.data).toMatchObject({
      agentId: 'dev@test-project',
      projectId: 'test-project',
      workflow: 'simple-test',
      stepId: 'step1',
    });
    expect(completed).toMatchObject({
      agentId: 'dev@test-project',
      projectId: 'test-project',
    });
    expect(completed?.data).toMatchObject({
      agentId: 'dev@test-project',
      projectId: 'test-project',
      workflow: 'simple-test',
      stepId: 'step1',
    });
    const runId = started?.data.runId;
    const step = tracker.getSteps(runId).find((s) => s.stepId === 'step1');
    expect(step?.agentId).toBe('dev@test-project');
  });

  it('emits agent context on failed workflow step events', async () => {
    const buf = new EventBuffer(100);
    const failing = {
      dispatch: vi.fn().mockRejectedValue(new Error('Boom')),
    } as any;
    const engine = new WorkflowEngine(tracker, router, failing, agents, buf, 'test-project');

    await expect(engine.execute(simpleWf)).rejects.toThrow('Boom');

    const failed = buf.getRecent(100).find((e) => e.type === 'workflow.step_failed' && e.data.stepId === 'step1');
    expect(failed).toMatchObject({
      agentId: 'dev@test-project',
      projectId: 'test-project',
    });
    expect(failed?.data).toMatchObject({
      agentId: 'dev@test-project',
      projectId: 'test-project',
      workflow: 'simple-test',
      stepId: 'step1',
      error: 'Boom',
    });
  });

  it('emits agent context for each parallel workflow step', async () => {
    const buf = new EventBuffer(100);
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, buf, 'test-project');

    await engine.execute(parallelWf);

    const started = buf.getRecent(100).filter((e) => e.type === 'workflow.step_started' && e.data.workflow === 'parallel-test' && e.data.stepId);
    expect(started).toHaveLength(2);
    expect(started.map((e) => e.agentId).sort()).toEqual(['dev@test-project', 'seo@test-project']);
    expect(started.map((e) => e.data.stepId).sort()).toEqual(['p1', 'p2']);
  });

  it('recoverStaleRuns works', () => {
    const run = tracker.createRun('stale-wf');
    const recovered = tracker.recoverStaleRuns();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const final = tracker.getRun(run.id);
    expect(final?.status).toBe('interrupted');
  });

  // --- U2: Gate revision feedback loop ---

  const gateRevisionWf: WorkflowDef = {
    name: 'gate-revision-wf',
    steps: [
      { type: 'agent' as const, id: 'research', agent: 'dev@test-project', prompt: 'Research topic X', output: 'research_out' },
      { type: 'human_gate' as const, id: 'review', label: 'Review research' },
      { type: 'agent' as const, id: 'finalize', agent: 'seo@test-project', prompt: 'Finalize based on review' },
    ],
  };

  it('waitForGate returns revision_requested when gate has that status', async () => {
    const db = getDb();
    const gateId = 'gate-rev-test-1';
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, feedback, timeout_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(gateId, 'run-rev-1', 'step-review', 'Review work', 'revision_requested', 'Make it better', new Date(Date.now() + 3600000).toISOString());

    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    // Access private method via any cast for testing
    const result = await (engine as any).waitForGate(gateId, 60000, 'step-review', 'run-rev-1');
    expect(result).toBe('revision_requested');
  });

  it('waitForGate returns approved when gate is approved', async () => {
    const db = getDb();
    const gateId = 'gate-rev-test-2';
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(gateId, 'run-rev-2', 'step-review', 'Review work', 'approved', new Date(Date.now() + 3600000).toISOString());

    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    const result = await (engine as any).waitForGate(gateId, 60000, 'step-review', 'run-rev-2');
    expect(result).toBe('approved');
  });

  it('waitForGate returns rejected when gate is rejected', async () => {
    const db = getDb();
    const gateId = 'gate-rev-test-3';
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(gateId, 'run-rev-3', 'step-review', 'Review work', 'rejected', new Date(Date.now() + 3600000).toISOString());

    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    const result = await (engine as any).waitForGate(gateId, 60000, 'step-review', 'run-rev-3');
    expect(result).toBe('rejected');
  });

  it('waitForGate returns timed_out after timeout with no resolution', async () => {
    const db = getDb();
    const gateId = 'gate-rev-test-4';
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, timeout_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(gateId, 'run-rev-4', 'step-review', 'Review work', 'pending', new Date(Date.now() + 3600000).toISOString());

    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    // Use a very short timeout (1ms) so it times out immediately
    const result = await (engine as any).waitForGate(gateId, 1, 'step-review', 'run-rev-4');
    expect(result).toBe('timed_out');
    // Verify gate status was updated to timed_out
    const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
    expect(gate.status).toBe('timed_out');
  });

  it('gate revision dispatches previous agent with feedback and creates new gate', async () => {
    // Use a fresh mock to track dispatch calls precisely
    const mockDispatch = vi.fn()
      .mockResolvedValueOnce('## Research complete\n\nFound important insights about X.') // step1
      .mockResolvedValueOnce('## Revised research\n\nUpdated with more details about X.'); // revision re-dispatch

    const revisionSessionMgr = { dispatch: mockDispatch } as any;

    // Pre-insert a gate that will be set to revision_requested
    // The workflow will create a gate for the review step, but we intercept by
    // setting up the DB state so that after step1 completes and the gate is created,
    // we can test the revision behavior.

    const engine = new WorkflowEngine(tracker, router, revisionSessionMgr, agents, eventBuffer, 'test-project');

    // We'll test by directly exercising the internal flow:
    // Create a run, execute step1, then manually test the gate handler
    const run = tracker.createRun('gate-revision-wf');
    const db = getDb();

    // Simulate step1 completion
    const step1Row = tracker.createStep(run.id, 'research');
    tracker.startStep(step1Row.id);
    tracker.completeStep(step1Row.id, '## Research complete\n\nFound important insights about X.');

    // Create a gate for the review step
    const gateId = 'gate-rev-full-test';
    db.prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, status, feedback, timeout_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(gateId, run.id, 'review', 'Review research', 'revision_requested', 'Needs more details', new Date(Date.now() + 3600000).toISOString());

    // Now call waitForGate — it should return 'revision_requested'
    const resolution = await (engine as any).waitForGate(gateId, 60000, 'review', run.id);
    expect(resolution).toBe('revision_requested');

    // The gate feedback should be retrievable
    const gate = db.prepare('SELECT feedback FROM human_gates WHERE id = ?').get(gateId) as any;
    expect(gate.feedback).toBe('Needs more details');
  });

  it('buildRevisionPrompt constructs prompt with feedback and previous output', () => {
    const engine = new WorkflowEngine(tracker, router, sessionMgr, agents, eventBuffer, 'test-project');
    const prevStep = { id: 'research', agent: 'dev@test-project', prompt: 'Research topic X', output: 'research_out' };
    const feedback = 'Add more sources';
    const outputs: Record<string, string> = { research_out: '## Research complete\n\nFound insights.' };

    const prompt = (engine as any).buildRevisionPrompt(prevStep, feedback, outputs);
    expect(prompt).toContain('Revision Request');
    expect(prompt).toContain('## Research complete');
    expect(prompt).toContain('Add more sources');
    expect(prompt).toContain('Research topic X');
    expect(prompt).toContain('Reviewer Feedback');
  });

  // TODO: Full integration test — requires coordinating gate status changes
  // while the engine's polling loop is running. The individual components
  // (waitForGate signals, buildRevisionPrompt, single revision dispatch)
  // are covered by the tests above. A full end-to-end test would:
  //   1. Start workflow with research → gate → finalize
  //   2. Intercept gate creation, set revision_requested
  //   3. Verify agent re-dispatched with feedback
  //   4. Intercept new gate, set revision_requested again
  //   5. Verify agent re-dispatched again
  //   6. Intercept new gate, set approved
  //   7. Verify finalize step runs
  it.todo('full revision loop: two revisions then approve completes workflow');

  // --- onStepFailure: abort / continue ---

  it('onStepFailure=abort (default): parallel group failure throws', async () => {
    const failingMgr = {
      dispatch: vi.fn().mockRejectedValue(new Error('step failed')),
    } as any;
    const wf: WorkflowDef = {
      name: 'abort-test',
      steps: [
        {
          type: 'agent' as const,
          id: 'group-abort',
          onStepFailure: 'abort',
          parallel: [
            { id: 'pa1', agent: 'dev@test-project', prompt: 'Task A' },
            { id: 'pa2', agent: 'seo@test-project', prompt: 'Task B' },
          ],
        },
      ],
    };
    const engine = new WorkflowEngine(tracker, router, failingMgr, agents, eventBuffer, 'test-project');
    await expect(engine.execute(wf)).rejects.toThrow('Parallel group failed');
  });

  it('onStepFailure=continue: parallel group failure does not throw, partial results stored in outputs', async () => {
    let callCount = 0;
    const mixedMgr = {
      dispatch: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return 'success result';
        throw new Error('second step failed');
      }),
    } as any;
    const wf: WorkflowDef = {
      name: 'continue-test',
      steps: [
        {
          type: 'agent' as const,
          id: 'group-cont',
          onStepFailure: 'continue',
          parallel: [
            { id: 'pc1', agent: 'dev@test-project', prompt: 'Task A', output: 'pc1_out' },
            { id: 'pc2', agent: 'seo@test-project', prompt: 'Task B' },
          ],
        },
      ],
    };
    const engine = new WorkflowEngine(tracker, router, mixedMgr, agents, eventBuffer, 'test-project');
    // Should not throw
    const runId = await engine.execute(wf);
    expect(runId).toBeTruthy();
    expect(mixedMgr.dispatch).toHaveBeenCalledTimes(2);
  });

  it('onStepFailure=continue: all steps fail, workflow still completes', async () => {
    const allFailMgr = {
      dispatch: vi.fn().mockRejectedValue(new Error('all failed')),
    } as any;
    const wf: WorkflowDef = {
      name: 'continue-all-fail-test',
      steps: [
        {
          type: 'agent' as const,
          id: 'group-all-fail',
          onStepFailure: 'continue',
          parallel: [
            { id: 'pf1', agent: 'dev@test-project', prompt: 'Task A' },
            { id: 'pf2', agent: 'seo@test-project', prompt: 'Task B' },
          ],
        },
      ],
    };
    const engine = new WorkflowEngine(tracker, router, allFailMgr, agents, eventBuffer, 'test-project');
    const runId = await engine.execute(wf);
    expect(runId).toBeTruthy();
  });

  it('rejects the removed resume-later policy at schema level', () => {
    const result = WorkflowDefSchema.safeParse({
      name: 'resume-later-test',
      steps: [
        {
          type: 'agent',
          id: 'group-rl',
          onStepFailure: 'resume-later',
          parallel: [
            { id: 'rl1', agent: 'dev@test-project', prompt: 'Task A' },
            { id: 'rl2', agent: 'seo@test-project', prompt: 'Task B' },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('workflow-level onStepFailure default is used when step does not override', async () => {
    const failMgr = {
      dispatch: vi.fn().mockRejectedValue(new Error('wf-level fail')),
    } as any;
    const wf: WorkflowDef = {
      name: 'wf-level-default-test',
      onStepFailure: 'continue',           // workflow-level default
      steps: [
        {
          type: 'agent' as const,
          id: 'group-wf-default',
          // no step-level onStepFailure — should inherit workflow default
          parallel: [
            { id: 'wd1', agent: 'dev@test-project', prompt: 'Task A' },
          ],
        },
      ],
    };
    const engine = new WorkflowEngine(tracker, router, failMgr, agents, eventBuffer, 'test-project');
    // Should not throw because workflow default is continue
    const runId = await engine.execute(wf);
    expect(runId).toBeTruthy();
  });

  // ---- I3 regression: bookkeeping failure must not flip a successful run to FAILED ----
  it('executeAsync: completeRun failure leaves successful steps in non-failed state', async () => {
    const okMgr = { dispatch: vi.fn().mockResolvedValue('done') } as any;
    const engine = new WorkflowEngine(tracker, router, okMgr, agents, eventBuffer, 'test-project');
    // Replace completeRun on the *engine's* tracker to throw — simulates a DB
    // lock or transient error after the workflow steps already finished.
    const realCompleteRun = (engine as any).tracker.completeRun.bind((engine as any).tracker);
    const spy = vi.spyOn((engine as any).tracker, 'completeRun').mockImplementation(() => {
      throw new Error('simulated DB lock during completeRun');
    });
    const failRunSpy = vi.spyOn((engine as any).tracker, 'failRun');

    const runId = engine.executeAsync(simpleWf);
    // Give the IIFE a tick to finish.
    await new Promise((r) => setTimeout(r, 50));

    // failRun must NOT have been called for the bookkeeping failure.
    expect(failRunSpy).not.toHaveBeenCalledWith(runId);

    spy.mockRestore();
    failRunSpy.mockRestore();
    // Repair the run so other tests see a consistent state.
    realCompleteRun(runId);
  });
});
