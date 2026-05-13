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
  skills: ['typescript'],
  projectDir: '/tmp/test-project',
  tokenBudget: 40000,
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
