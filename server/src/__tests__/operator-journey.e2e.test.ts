import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb, closeDb, getDb } from '../db/sqlite.js';
import { MemoryEngine } from '../memory/engine.js';
import { EventBuffer } from '../events/buffer.js';
import { AgentSessionManager } from '../agents/manager.js';
import { CostTracker } from '../tracking/cost-tracker.js';
import { SkillRouter } from '../routing/router.js';
import { WorkflowTracker } from '../workflows/tracker.js';
import { WorkflowEngine } from '../workflows/engine.js';
import { WorkflowRegistry } from '../workflows/loader.js';
import { GoalScheduler } from '../goals/scheduler.js';
import type { ResolvedAgent } from '../config/schema.js';
import type { GoalDef } from '../goals/schema.js';
import type {
  AgentRuntime,
  CreateSessionOpts,
  EventCallback,
  RuntimeMessage,
  SessionHandle,
} from '../agents/runtime/types.js';

/**
 * End-to-end operator journey, in-process and deterministic.
 *
 * Drives the exact chain that broke at the seams during the 2026-07-05 manual
 * run: trigger a goal → it launches a workflow → the workflow dispatches an
 * agent → the agent produces a transcript → the run settles and the transcript
 * persists. Unit tests never caught those bugs because every component was
 * correct in isolation; this test exercises the wiring between them.
 *
 * The only thing faked is the LLM runtime (a scripted AgentRuntime) — every
 * other component is the real one, against a real (temp) SQLite database.
 */

// A scripted agent runtime: no network, deterministic, emits the same event
// lifecycle the pi runtime does (message_end with usage, then agent_end).
class FakeRuntime implements AgentRuntime {
  public prompts = 0;

  async createSession(opts: CreateSessionOpts): Promise<SessionHandle> {
    const subs = new Set<EventCallback>();
    return {
      id: opts.id,
      raw: { subs },
      get isStreaming() {
        return false;
      },
    };
  }

  getMessages(): RuntimeMessage[] {
    return [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'text', text: 'fake agent output' }] },
    ];
  }

  async prompt(handle: SessionHandle, _message: string): Promise<void> {
    this.prompts++;
    const { subs } = handle.raw as { subs: Set<EventCallback> };
    // Fire on the next tick, mirroring the real streaming settle order.
    setTimeout(() => {
      for (const cb of subs) {
        cb({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'fake agent output' }],
            usage: { input: 12, output: 8 },
          },
        } as never);
      }
      for (const cb of subs) cb({ type: 'agent_end' } as never);
    }, 1);
  }

  subscribe(handle: SessionHandle, cb: EventCallback): () => void {
    const { subs } = handle.raw as { subs: Set<EventCallback> };
    subs.add(cb);
    return () => subs.delete(cb);
  }

  sendToolResult(): void {
    /* no tools in the journey */
  }

  dispose(): void {
    /* nothing to release */
  }
}

const AGENT_ID = 'content@journeytest';

function makeAgent(projectDir: string): ResolvedAgent {
  return {
    id: AGENT_ID,
    projectId: 'journeytest',
    type: 'content',
    model: 'deepseek/deepseek-v4-flash',
    personality: 'test',
    memory: { project: 'read/write' },
    capabilities: [],
    tools: {},
    projectDir,
    tokenBudget: 1_000_000,
    keepWarm: false,
  };
}

function makeGoal(): GoalDef {
  return {
    id: 'journey-goal',
    description: 'Journey test goal',
    // Far-future cadence: valid for scheduler.start(), never fires mid-test.
    cadence: '0 0 1 1 *',
    workflow: 'journey-wf',
    acceptance: [],
    warn_before_ms: 7_200_000,
  };
}

const WORKFLOW_YAML = `name: journey-wf
description: single agent step
steps:
  - id: write
    agent: ${AGENT_ID}
    prompt: "Write the thing"
    output: result
`;

async function waitFor(fn: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
}

function goalRunStatus(goalRunId: string): string | undefined {
  const row = getDb()
    .prepare('SELECT status FROM goal_runs WHERE id = ?')
    .get(goalRunId) as { status: string } | undefined;
  return row?.status;
}

interface Harness {
  runtime: FakeRuntime;
  sessionMgr: AgentSessionManager;
  wfEngine: WorkflowEngine;
  wfRegistry: WorkflowRegistry;
  scheduler: GoalScheduler;
  tmpDir: string;
}

// Wire the real orchestration graph the way startServer() does, minus HTTP.
// `wireGoalListener` toggles the engine→scheduler event fan-out so a test can
// prove that seam is load-bearing.
function buildHarness(dbDir: string, wireGoalListener: boolean): Harness {
  const tmpDir = mkdtempSync(join(tmpdir(), 'journey-'));
  const wfDir = join(tmpDir, 'workflows');
  const projectDir = join(tmpDir, 'project');
  mkdirSync(wfDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(wfDir, 'journey-wf.yaml'), WORKFLOW_YAML);

  const agents = [makeAgent(projectDir)];
  const memory = new MemoryEngine(50);
  const eventBuffer = new EventBuffer(200);
  const runtime = new FakeRuntime();
  const sessionMgr = new AgentSessionManager(memory, 0, 10, runtime);
  sessionMgr.setCostTracker(new CostTracker());

  const router = new SkillRouter(agents);
  const wfTracker = new WorkflowTracker();
  const wfEngine = new WorkflowEngine(wfTracker, router, sessionMgr, agents, eventBuffer);
  const wfRegistry = new WorkflowRegistry();
  wfRegistry.load(wfDir, 'journeytest');

  const scheduler = new GoalScheduler(wfRegistry, wfEngine, eventBuffer, sessionMgr, agents);

  // The load-bearing seam: workflow terminal events reach the scheduler only
  // through this fan-out (EventBuffer has no subscribe mechanism).
  if (wireGoalListener) {
    wfEngine.setEventListener((evt) => scheduler.onEvent(evt));
  }

  scheduler.start([makeGoal()]);
  return { runtime, sessionMgr, wfEngine, wfRegistry, scheduler, tmpDir };
}

describe('operator journey (goal → workflow → agent → persist)', () => {
  let dbDir: string;
  let harness: Harness | null = null;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'journey-db-'));
    initDb(join(dbDir, 'test.db'));
  });

  afterEach(async () => {
    if (harness) {
      harness.scheduler.stop();
      await harness.sessionMgr.disposeAll();
      rmSync(harness.tmpDir, { recursive: true, force: true });
      harness = null;
    }
    closeDb();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('completes a triggered goal run and persists the agent transcript', async () => {
    harness = buildHarness(dbDir, /* wireGoalListener */ true);
    const { scheduler, runtime, sessionMgr } = harness;

    const { goalRunId, workflowRunId } = await scheduler.runGoalById('journey-goal');

    // The goal run settles to complete — the engine→scheduler seam works.
    const settled = await waitFor(() => goalRunStatus(goalRunId) === 'complete');
    expect(settled).toBe(true);

    // The workflow it launched also completed, and the agent actually ran.
    const wfRun = getDb()
      .prepare('SELECT status FROM workflow_runs WHERE id = ?')
      .get(workflowRunId) as { status: string } | undefined;
    expect(wfRun?.status).toBe('complete');
    expect(runtime.prompts).toBeGreaterThan(0);

    // Timestamps are ISO-8601 UTC (…Z), not naive local strings.
    const times = getDb()
      .prepare('SELECT triggered_at, completed_at FROM goal_runs WHERE id = ?')
      .get(goalRunId) as { triggered_at: string; completed_at: string };
    expect(times.triggered_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(times.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    // Disposing the session persists the transcript WITHOUT a FK failure:
    // the manager creates the parent sessions row itself.
    await sessionMgr.disposeAll();
    const sessionRow = getDb()
      .prepare('SELECT agent_id FROM sessions WHERE id = ?')
      .get(AGENT_ID) as { agent_id: string } | undefined;
    expect(sessionRow?.agent_id).toBe(AGENT_ID);
    const msgRow = getDb()
      .prepare('SELECT message_count FROM session_messages WHERE session_id = ?')
      .get(AGENT_ID) as { message_count: number } | undefined;
    expect(msgRow?.message_count).toBeGreaterThan(0);
  });

  it('regression guard: without the engine→scheduler wiring the goal run never settles', async () => {
    harness = buildHarness(dbDir, /* wireGoalListener */ false);
    const { scheduler } = harness;

    const { goalRunId, workflowRunId } = await scheduler.runGoalById('journey-goal');

    // The workflow itself still completes...
    const wfDone = await waitFor(() => {
      const row = getDb()
        .prepare('SELECT status FROM workflow_runs WHERE id = ?')
        .get(workflowRunId) as { status: string } | undefined;
      return row?.status === 'complete';
    });
    expect(wfDone).toBe(true);

    // ...but the goal run is stranded at 'running' because the terminal
    // workflow event never reaches GoalScheduler.onEvent(). This is exactly
    // the bug from the E2E report; the assertion fails loudly if the seam is
    // ever removed again.
    await new Promise((r) => setTimeout(r, 150));
    expect(goalRunStatus(goalRunId)).toBe('running');
  });
});
