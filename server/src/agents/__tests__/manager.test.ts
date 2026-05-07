import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb } from '../../db/sqlite.js';

// Mock pi SDK
vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(),
  SessionManager: { inMemory: vi.fn(() => ({})) },
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
    (DefaultResourceLoader as any).mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    }));

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
    (DefaultResourceLoader as any).mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    }));

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
    (DefaultResourceLoader as any).mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    }));

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
