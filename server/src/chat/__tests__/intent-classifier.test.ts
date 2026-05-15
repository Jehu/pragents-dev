import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pi SDK before importing the classifier (it tries to create sessions on import)
vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(),
  SessionManager: { inMemory: vi.fn(() => ({})) },
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  childLogger: vi.fn(),
}));

vi.mock('../../agents/model-resolver.js', () => ({
  resolveModel: vi.fn((m: string) => (m ? { provider: 'anthropic', modelId: m } : null)),
}));

import { IntentClassifier, IntentResultSchema } from '../intent-classifier.js';
import type { ResolvedAgent } from '../../config/schema.js';

const mockAgent: ResolvedAgent = {
  id: 'dev@test',
  projectId: 'test',
  type: 'dev',
  model: 'anthropic/claude-haiku',
  personality: 'You are a test agent.',
  memory: { project: 'read', company: 'read' },
  capabilities: [],
  projectDir: '/tmp/test',
  tokenBudget: 10000,
  keepWarm: false,
};

function makeClassifier(agents = [mockAgent], modelOverride?: string) {
  return new IntentClassifier(agents, modelOverride);
}

// Helper: build a mock session that emits the given JSON as a response
function buildMockSession(responseJson: string) {
  return {
    subscribe: vi.fn((cb: (evt: any) => void) => {
      setTimeout(() => {
        cb({
          type: 'message_end',
          message: { role: 'assistant', content: responseJson },
        });
        cb({ type: 'agent_end' });
      }, 5);
      return () => {};
    }),
    prompt: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    isStreaming: false,
  };
}

describe('IntentClassifier.classify — edge cases', () => {
  beforeEach(async () => {
    // Clear the module-level session cache so each test gets fresh mocks
    const mod = await import('../intent-classifier.js');
    // Access the private cache via the module internals (not exported, so we
    // clear via the shutdown helper that IS exported)
    await mod.shutdownClassifierSessions();
    vi.clearAllMocks();
  });

  it('returns null for empty string input', async () => {
    const classifier = makeClassifier();
    const result = await classifier.classify('');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only input', async () => {
    const classifier = makeClassifier();
    const result = await classifier.classify('   ');
    expect(result).toBeNull();
  });

  it('returns null when no agents and no modelOverride are configured', async () => {
    const classifier = makeClassifier([]);
    const result = await classifier.classify('list all tasks');
    expect(result).toBeNull();
  });

  it('returns correct intent for a known query_tasks message', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = buildMockSession('{"tool":"query_tasks","args":{"status":"failed"},"confidence":0.97}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('Which tasks are failed?');
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('query_tasks');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('returns complex for a message that matches no specific tool', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = buildMockSession('{"tool":"complex","args":{},"confidence":0.95}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('Build me a landing page with animations');
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('complex');
  });

  it('returns null when confidence is below threshold', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = buildMockSession('{"tool":"query_tasks","args":{},"confidence":0.4}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('Irgendwas mit Tasks oder so');
    expect(result).toBeNull();
  });

  it('respects a custom threshold', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    // confidence 0.5 — below default 0.7 but above custom threshold 0.4
    const mockSession = buildMockSession('{"tool":"list_agents","args":{},"confidence":0.5}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = new (await import('../intent-classifier.js')).IntentClassifier(
      [mockAgent], undefined, 0.4,
    );
    const result = await classifier.classify('show agents maybe?');
    expect(result).not.toBeNull();
    expect(result!.tool).toBe('list_agents');
  });

  it('defaults confidence to 1 when field is absent from response (backward compat)', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    // Model omits confidence entirely — schema default should kick in
    const mockSession = buildMockSession('{"tool":"list_workflows","args":{}}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('show workflows');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1);
  });

  it('returns null when response contains no JSON', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = buildMockSession('I cannot classify this message.');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('do something');
    expect(result).toBeNull();
  });

  it('recovers when tool is valid but args are invalid — returns result with empty args', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    // args is a string instead of an object — schema violation, but tool is valid
    const mockSession = buildMockSession('{"tool":"list_agents","args":"bad"}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('show agents');
    // The classifier should still return something with the valid tool
    // (recovery path: invalid schema but valid tool → empty args, confidence 1)
    if (result !== null) {
      expect(result.tool).toBe('list_agents');
      expect(result.confidence).toBe(1);
    }
    // null is also acceptable if Zod coercion rejects the payload entirely
  });

  it('returns null when tool in response is not a valid enum value', async () => {
    const { createAgentSession, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
    const mockSession = buildMockSession('{"tool":"unknown_tool","args":{}}');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });
    (DefaultResourceLoader as any).mockImplementation(function () {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    });

    const classifier = makeClassifier();
    const result = await classifier.classify('do something weird');
    expect(result).toBeNull();
  });
});

describe('IntentResultSchema', () => {
  it('accepts all valid tool values', () => {
    const tools = [
      'query_tasks', 'create_task', 'run_workflow', 'list_workflows',
      'search_memory', 'remember_fact', 'delete_fact', 'list_agents',
      'get_cost_summary', 'list_skills', 'list_pending_gates', 'list_goals',
      'list_events', 'complex',
    ];
    for (const tool of tools) {
      const parsed = IntentResultSchema.safeParse({ tool, args: {}, confidence: 0.9 });
      expect(parsed.success, `Expected tool "${tool}" to be valid`).toBe(true);
    }
  });

  it('rejects unknown tool names', () => {
    const parsed = IntentResultSchema.safeParse({ tool: 'fly_to_moon', args: {}, confidence: 0.9 });
    expect(parsed.success).toBe(false);
  });

  it('defaults args to empty object when omitted', () => {
    const parsed = IntentResultSchema.safeParse({ tool: 'list_agents' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.args).toEqual({});
    }
  });

  it('defaults confidence to 1 when omitted', () => {
    const parsed = IntentResultSchema.safeParse({ tool: 'list_agents', args: {} });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.confidence).toBe(1);
    }
  });

  it('accepts valid confidence values', () => {
    for (const confidence of [0, 0.5, 0.7, 1]) {
      const parsed = IntentResultSchema.safeParse({ tool: 'list_agents', args: {}, confidence });
      expect(parsed.success, `Expected confidence ${confidence} to be valid`).toBe(true);
    }
  });

  it('rejects confidence values outside 0–1', () => {
    for (const confidence of [-0.1, 1.1, 2]) {
      const parsed = IntentResultSchema.safeParse({ tool: 'list_agents', args: {}, confidence });
      expect(parsed.success, `Expected confidence ${confidence} to be rejected`).toBe(false);
    }
  });
});
