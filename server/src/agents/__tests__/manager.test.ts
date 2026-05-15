import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb } from '../../db/sqlite.js';

// Hoist mocks so they are available before module imports
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

// Mock pi SDK
vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(),
  SessionManager: { inMemory: vi.fn(() => ({})) },
}));

// Mock pino logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  childLogger: vi.fn(),
}));

import { AgentSessionManager } from '../../agents/manager.js';
import { MemoryEngine } from '../../memory/engine.js';
import type { ResolvedAgent } from '../../config/schema.js';

const mockAgent: ResolvedAgent = {
  id: 'dev@test',
  projectId: 'test',
  type: 'dev',
  model: 'claude-sonnet',
  personality: 'You are a test dev agent.',
  memory: { project: 'read/write', company: 'read' },
  capabilities: ['typescript'],
  projectDir: '/tmp/test-project',
  tokenBudget: 40000,
  keepWarm: false,
};

describe('AgentSessionManager', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-agent-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });
  it('dispatch creates session with correct config', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => cb({ type: 'agent_end' }), 10);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    // Dispatch should work without throwing
    await expect(mgr.dispatch(mockAgent, 'Test task')).resolves.toBeDefined();
    expect(createAgentSession).toHaveBeenCalled();
    expect(mockSession.prompt).toHaveBeenCalled();
  });

  it('dispatch returns agent response text', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => cb({ type: 'agent_end' }), 10);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: {
        state: {
          messages: [
            { role: 'user', content: 'test' },
            { role: 'assistant', content: 'Task done!' },
          ],
        },
      },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    const result = await mgr.dispatch(mockAgent, 'Test task');
    expect(result).toContain('Task done!');
  });
});

describe('Token budget enforcement in dispatch', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-budget-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('blocks dispatch and throws when cumulative token usage meets budget', async () => {
    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    const mockCostTracker = {
      getAgentCost: vi.fn().mockReturnValue({ tokensIn: 30000, tokensOut: 10001, cost: 0, calls: 5 }),
      record: vi.fn(),
    };
    mgr.setCostTracker(mockCostTracker as any);

    const agentOverBudget: ResolvedAgent = { ...mockAgent, tokenBudget: 40000 };

    await expect(mgr.dispatch(agentOverBudget, 'Some task')).rejects.toThrow('Token budget exceeded');
    expect(mockCostTracker.getAgentCost).toHaveBeenCalledWith(agentOverBudget.id);
  });

  it('emits budget.exceeded event when budget is exceeded', async () => {
    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    const mockCostTracker = {
      getAgentCost: vi.fn().mockReturnValue({ tokensIn: 25000, tokensOut: 15001, cost: 0, calls: 3 }),
      record: vi.fn(),
    };
    mgr.setCostTracker(mockCostTracker as any);

    const emittedEvents: any[] = [];
    mgr.setEventCallback((event) => emittedEvents.push(event));

    const agentOverBudget: ResolvedAgent = { ...mockAgent, tokenBudget: 40000 };

    await expect(mgr.dispatch(agentOverBudget, 'Some task')).rejects.toThrow('Token budget exceeded');

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('budget.exceeded');
    expect(emittedEvents[0].agentId).toBe(agentOverBudget.id);
    expect(emittedEvents[0].used).toBe(40001);
    expect(emittedEvents[0].budget).toBe(40000);
  });

  it('logs a pino warn when budget is exceeded', async () => {
    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    const mockCostTracker = {
      getAgentCost: vi.fn().mockReturnValue({ tokensIn: 40000, tokensOut: 1, cost: 0, calls: 10 }),
      record: vi.fn(),
    };
    mgr.setCostTracker(mockCostTracker as any);

    const agentOverBudget: ResolvedAgent = { ...mockAgent, tokenBudget: 40000 };

    await expect(mgr.dispatch(agentOverBudget, 'Some task')).rejects.toThrow('Token budget exceeded');

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: agentOverBudget.id, used: 40001, budget: 40000 }),
      'Token budget exceeded — dispatch blocked',
    );
  });

  it('proceeds with dispatch when token usage is below budget', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => cb({ type: 'agent_end' }), 10);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    const mockCostTracker = {
      getAgentCost: vi.fn().mockReturnValue({ tokensIn: 5000, tokensOut: 3000, cost: 0, calls: 2 }),
      record: vi.fn(),
    };
    mgr.setCostTracker(mockCostTracker as any);

    const agentUnderBudget: ResolvedAgent = { ...mockAgent, tokenBudget: 40000 };

    await expect(mgr.dispatch(agentUnderBudget, 'Some task')).resolves.toBeDefined();
    expect(mockSession.prompt).toHaveBeenCalled();
  });

  it('skips budget check when no costTracker is set', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => cb({ type: 'agent_end' }), 10);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);
    // No costTracker set — budget check must be skipped

    await expect(mgr.dispatch(mockAgent, 'Some task')).resolves.toBeDefined();
    expect(mockSession.prompt).toHaveBeenCalled();
  });
});

describe('AgentSessionManager.extractRememberedFacts', () => {
  it('extracts single REMEMBER fact from response', () => {
    const response = [
      'I have implemented the feature.',
      '',
      'REMEMBER: convention proj-acme Use tabs for indentation in TypeScript',
    ].join('\n');

    const facts = AgentSessionManager.extractRememberedFacts(response, 'dev@acme');
    expect(facts).toHaveLength(1);
    expect(facts[0].scope).toBe('proj-acme');
    expect(facts[0].category).toBe('convention');
    expect(facts[0].content).toBe('Use tabs for indentation in TypeScript');
  });

  it('extracts multiple REMEMBER facts', () => {
    const response = [
      'Task completed successfully.',
      '',
      'REMEMBER: decision company We use Hono for all HTTP routing',
      'REMEMBER: dependency proj-web Express is not used in this project',
    ].join('\n');

    const facts = AgentSessionManager.extractRememberedFacts(response, 'dev@web');
    expect(facts).toHaveLength(2);
    expect(facts[0].category).toBe('decision');
    expect(facts[1].category).toBe('dependency');
  });

  it('ignores REMEMBER lines with invalid category', () => {
    const response = 'REMEMBER: invalid_scope proj-test some content';
    const facts = AgentSessionManager.extractRememberedFacts(response, 'dev@test');
    expect(facts).toHaveLength(0);
  });

  it('ignores REMEMBER lines with too few parts', () => {
    const response = 'REMEMBER: decision';
    const facts = AgentSessionManager.extractRememberedFacts(response, 'dev@test');
    expect(facts).toHaveLength(0);
  });

  it('returns empty array for response with no REMEMBER lines', () => {
    const response = 'The task is done. No facts to remember.';
    const facts = AgentSessionManager.extractRememberedFacts(response, 'dev@test');
    expect(facts).toHaveLength(0);
  });

  it('handles all valid categories', () => {
    const categories = ['convention', 'decision', 'pattern', 'constraint', 'architecture', 'error_pattern', 'dependency'];
    for (const cat of categories) {
      const response = `REMEMBER: ${cat} proj-x some fact about ${cat}`;
      const facts = AgentSessionManager.extractRememberedFacts(response, 'dev@x');
      expect(facts).toHaveLength(1);
      expect(facts[0].category).toBe(cat);
    }
  });
});

describe('Auto-fact collection in dispatch', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-fact-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('persists remembered facts after dispatch', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn((cb: any) => {
        setTimeout(() => cb({ type: 'agent_end' }), 10);
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: {
        state: {
          messages: [
            { role: 'user', content: 'test' },
            {
              role: 'assistant',
              content: [
                'I have set up the project.',
                '',
                'REMEMBER: convention test-proj Use ESM modules with .js extensions',
                'REMEMBER: decision test-proj We use Vitest for testing',
              ].join('\n'),
            },
          ],
        },
      },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(100);
    const mgr = new AgentSessionManager(memory);

    const result = await mgr.dispatch(mockAgent, 'Set up project');
    expect(result).toContain('REMEMBER:');

    // Facts should be persisted
    const facts = await memory.recall('ESM', 'test-proj');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.some(f => f.content.includes('ESM modules'))).toBe(true);
  });
});

describe('AgentSessionManager.markStale', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-stale-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('markStale sets stale flag and triggers respawn on next getOrCreate', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: { state: { messages: [] } },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    await mgr.getOrCreate(mockAgent);
    mgr.markStale(mockAgent.id);

    const newSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: { state: { messages: [] } },
    };
    (createAgentSession as any).mockResolvedValue({ session: newSession });

    const handle = await mgr.getOrCreate(mockAgent);
    expect(mockSession.dispose).toHaveBeenCalledTimes(1);
    expect((handle.runtimeHandle.raw as any).session).toBe(newSession);
    expect(handle.stale).toBeFalsy();
  });

  it('markStale does not kill a streaming session immediately', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: true,
      agent: { state: { messages: [] } },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);

    await mgr.getOrCreate(mockAgent);
    mgr.markStale(mockAgent.id);

    const handle = await mgr.getOrCreate(mockAgent);
    expect(mockSession.dispose).not.toHaveBeenCalled();
    expect((handle.runtimeHandle.raw as any).session).toBe(mockSession);
    expect(handle.stale).toBe(true);
  });

  it('markStale on unknown agentId is a no-op', () => {
    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory);
    expect(() => mgr.markStale('nonexistent@agent')).not.toThrow();
  });
});

describe('AgentSessionManager auto-extraction hooks', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-autoext-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('calls autoExtractor.tryExtract in disposeIdle with session messages', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');

    const mockMessages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: { state: { messages: mockMessages } },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 0); // 0 timeout = always idle

    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    mgr.setAutoExtractor(mockAutoExtractor as any);

    // Get or create a session first
    await mgr.getOrCreate(mockAgent);

    // Small delay so idle timeout triggers
    await new Promise((r) => setTimeout(r, 2));

    // disposeIdle should trigger auto-extraction
    const disposed = await mgr.disposeIdle();
    expect(mockAutoExtractor.tryExtract).toHaveBeenCalled();
    expect(disposed.length).toBeGreaterThanOrEqual(1);
  });

  it('autoExtractor errors do not prevent session disposal', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');

    const mockMessages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: { state: { messages: mockMessages } },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 0);

    const mockAutoExtractor = {
      tryExtract: vi.fn().mockRejectedValue(new Error('Boom!')),
    };
    mgr.setAutoExtractor(mockAutoExtractor as any);

    await mgr.getOrCreate(mockAgent);

    // Small delay so idle timeout triggers
    await new Promise((r) => setTimeout(r, 2));

    // Should not throw — autoExtractor failure should not block dispose
    await expect(mgr.disposeIdle()).resolves.toBeDefined();
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('disposeIdle works correctly without autoExtractor set', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');

    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: { state: { messages: [] } },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 0);

    await mgr.getOrCreate(mockAgent);

    // Small delay so idle timeout triggers
    await new Promise((r) => setTimeout(r, 2));

    // Should work fine without autoExtractor
    await expect(mgr.disposeIdle()).resolves.toBeDefined();
  });
});

describe('AgentSessionManager.persistSessionMessages — pi-SDK accessor guard', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-persist-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('logs a pino warn and does NOT throw when session.agent.state.messages is undefined', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');

    // Simulate a pi SDK session where the accessor path does not exist
    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      // agent.state.messages is intentionally absent
      agent: { state: {} },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 0);

    await mgr.getOrCreate(mockAgent);
    await new Promise((r) => setTimeout(r, 2));

    // disposeIdle internally calls persistSessionMessages — must not throw
    await expect(mgr.disposeIdle()).resolves.toBeDefined();

    // Warn must have been emitted with the structured fields required by issue #31
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ accessor: 'session.agent.state.messages', agentId: mockAgent.id }),
      'pi-SDK session messages accessor returned undefined — skipping persist',
    );
  });

  it('writes messages to DB when session.agent.state.messages is a valid array', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');

    const validMessages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];

    const mockSession = {
      subscribe: vi.fn(() => () => {}),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isStreaming: false,
      agent: { state: { messages: validMessages } },
    };
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    // Insert the required sessions row so the FK constraint is satisfied
    const { getDb } = await import('../../db/sqlite.js');
    getDb().prepare('INSERT OR IGNORE INTO sessions (id, agent_id) VALUES (?, ?)').run(mockAgent.id, mockAgent.id);

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 0);

    await mgr.getOrCreate(mockAgent);
    await new Promise((r) => setTimeout(r, 2));

    await mgr.disposeIdle();

    // No warn should have been logged — accessor worked fine
    expect(mockWarn).not.toHaveBeenCalled();

    // The session ID used internally is the agent id (key in sessions map)
    const persisted = mgr.getSessionMessages(mockAgent.id);
    expect(persisted).not.toBeNull();
    expect(persisted).toHaveLength(2);
    expect(persisted![0].role).toBe('user');
  });
});

describe('AgentSessionManager keepWarm + session pool', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-warm-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  beforeEach(() => {
    mockWarn.mockClear();
  });

  const makeMockSession = () => ({
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    isStreaming: false,
    agent: { state: { messages: [] } },
  });

  it('keepWarm agent does not get idle-shut-down by disposeIdle', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = makeMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    // idleTimeoutMs = 0 → without keepWarm protection, any non-streaming session
    // would be reaped on the very next disposeIdle() tick.
    const mgr = new AgentSessionManager(memory, 0, 10);

    const warmAgent: ResolvedAgent = { ...mockAgent, id: 'pm@warm', keepWarm: true };
    await mgr.getOrCreate(warmAgent);
    await new Promise((r) => setTimeout(r, 2));

    const disposed = await mgr.disposeIdle();
    expect(disposed).toHaveLength(0);
    expect(mockSession.dispose).not.toHaveBeenCalled();
    expect(mgr.getActiveAgents()).toContain('pm@warm');
  });

  it('cold agent is still idle-shut-down when keepWarm = false', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = makeMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 0, 10);

    const coldAgent: ResolvedAgent = { ...mockAgent, id: 'dev@cold', keepWarm: false };
    await mgr.getOrCreate(coldAgent);
    await new Promise((r) => setTimeout(r, 2));

    const disposed = await mgr.disposeIdle();
    expect(disposed).toContain('dev@cold');
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('pool cap is respected — extra keepWarm agents stay cold and a warn is logged', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    (createAgentSession as any).mockImplementation(() => Promise.resolve({ session: makeMockSession() }));
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const cap = 2;
    const mgr = new AgentSessionManager(memory, 60_000, cap);

    const a1: ResolvedAgent = { ...mockAgent, id: 'warm@1', keepWarm: true };
    const a2: ResolvedAgent = { ...mockAgent, id: 'warm@2', keepWarm: true };
    const a3: ResolvedAgent = { ...mockAgent, id: 'warm@3', keepWarm: true };

    await mgr.getOrCreate(a1);
    await mgr.getOrCreate(a2);
    await mgr.getOrCreate(a3);

    // Third agent must NOT be marked warm — verify by running idle sweep with
    // a 0-timeout manager-state mutation: simulate idle-eligibility.
    // We assert it via disposeIdle: a3 should be disposable, a1/a2 should not.
    const mgr2 = new AgentSessionManager(memory, 0, cap);
    // Re-use the existing session map shape via fresh creates — fake it:
    await mgr2.getOrCreate(a1);
    await mgr2.getOrCreate(a2);
    await mgr2.getOrCreate(a3);
    await new Promise((r) => setTimeout(r, 2));
    const disposed = await mgr2.disposeIdle();
    expect(disposed).toContain('warm@3');
    expect(disposed).not.toContain('warm@1');
    expect(disposed).not.toContain('warm@2');

    // Warn must mention the cap
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ cap, agentId: 'warm@3' }),
      'Warm-session cap reached; subsequent keepWarm agents will stay cold',
    );
  });

  it('prewarmKeepWarmAgents spawns sessions for all keepWarm agents', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    (createAgentSession as any).mockImplementation(() => Promise.resolve({ session: makeMockSession() }));
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });
    (createAgentSession as any).mockClear();

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 60_000, 10);

    const warm1: ResolvedAgent = { ...mockAgent, id: 'pm@a', keepWarm: true };
    const warm2: ResolvedAgent = { ...mockAgent, id: 'pm@b', keepWarm: true };
    const cold: ResolvedAgent = { ...mockAgent, id: 'dev@c', keepWarm: false };

    await mgr.prewarmKeepWarmAgents([warm1, warm2, cold]);

    expect((createAgentSession as any).mock.calls.length).toBe(2);
    expect(mgr.getActiveAgents()).toEqual(expect.arrayContaining(['pm@a', 'pm@b']));
    expect(mgr.getActiveAgents()).not.toContain('dev@c');
  });

  it('prewarmKeepWarmAgents survives a single agent spawn failure', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    let n = 0;
    (createAgentSession as any).mockImplementation(() => {
      n++;
      if (n === 1) return Promise.reject(new Error('spawn boom'));
      return Promise.resolve({ session: makeMockSession() });
    });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 60_000, 10);

    const warm1: ResolvedAgent = { ...mockAgent, id: 'pm@boom', keepWarm: true };
    const warm2: ResolvedAgent = { ...mockAgent, id: 'pm@ok', keepWarm: true };

    await expect(mgr.prewarmKeepWarmAgents([warm1, warm2])).resolves.toBeUndefined();
    expect(mgr.getActiveAgents()).toContain('pm@ok');
    expect(mgr.getActiveAgents()).not.toContain('pm@boom');
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'pm@boom' }),
      'Failed to pre-spawn keepWarm agent — will spawn on first dispatch',
    );
  });

  it('prewarmKeepWarmAgents is a no-op when no agents are keepWarm', async () => {
    const { createAgentSession } = await import('@mariozechner/pi-coding-agent');
    (createAgentSession as any).mockClear();

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 60_000, 10);

    await mgr.prewarmKeepWarmAgents([{ ...mockAgent, keepWarm: false }]);
    expect((createAgentSession as any)).not.toHaveBeenCalled();
    expect(mgr.getActiveAgents()).toHaveLength(0);
  });

  it('warm session is still respawned via markStale (config reload)', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const session1 = makeMockSession();
    const session2 = makeMockSession();
    (createAgentSession as any)
      .mockResolvedValueOnce({ session: session1 })
      .mockResolvedValueOnce({ session: session2 });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const memory = new MemoryEngine(10);
    const mgr = new AgentSessionManager(memory, 60_000, 10);

    const warmAgent: ResolvedAgent = { ...mockAgent, id: 'pm@stale-warm', keepWarm: true };
    const first = await mgr.getOrCreate(warmAgent);
    expect((first.runtimeHandle.raw as any).session).toBe(session1);
    expect(first.warm).toBe(true);

    // Simulate config reload: agent's session marked stale.
    mgr.markStale(warmAgent.id);

    // Next dispatch/getOrCreate must dispose the stale warm session and spawn a fresh one.
    const second = await mgr.getOrCreate(warmAgent);
    expect(session1.dispose).toHaveBeenCalledTimes(1);
    expect((second.runtimeHandle.raw as any).session).toBe(session2);
    expect(second.warm).toBe(true);
  });
});
