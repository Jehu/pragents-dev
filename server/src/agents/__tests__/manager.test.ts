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
        // Simulate agent response events
        setTimeout(() => cb({ type: 'assistant_message', message: { content: 'Task done!' } }), 10);
        setTimeout(() => cb({ type: 'agent_end' }), 20);
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

    const result = await mgr.dispatch(mockAgent, 'Test task');
    expect(result).toContain('Task done!');
  });
});
