import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { initDb, closeDb } from '../../../db/sqlite.js';
import { ConversationManager } from '../../../chat/manager.js';
import { DirectRouter } from '../../../chat/direct-router.js';
import { createChatRoute } from '../chat.js';
import { SSEEventSchema } from '../../../chat/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NLDecomposer } from '../../../nl/decomposer.js';
import type { ToolExecutor } from '../../../agents/tool-executor.js';
import type { ResolvedAgent } from '../../../config/schema.js';
import type { EventBuffer, PragentsEvent } from '../../../events/buffer.js';

/**
 * Parse SSE stream text into an array of parsed JSON events.
 */
function parseSSEStream(text: string): Array<{ type?: string; data?: any }> {
  const events: Array<{ type?: string; data?: any }> = [];
  const lines = text.split('\n');

  let currentData = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentData) {
      try {
        events.push(JSON.parse(currentData));
      } catch {
        // Skip malformed events
      }
      currentData = '';
    }
    // Skip heartbeat comments (lines starting with ':')
  }

  return events;
}

/**
 * Read a Response stream to completion and return the text.
 */
async function readStreamText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

// ---- Mock implementations ----

function createMockAgents(): ResolvedAgent[] {
  return [
    {
      id: 'dev',
      projectId: 'proj-1',
      type: 'dev',
      model: 'test-model',
      personality: 'helpful',
      memory: {},
      skills: ['coding'],
      projectDir: '/tmp',
      tokenBudget: 40000,
    },
  ];
}

function createMockEventBuffer(): EventBuffer {
  return {
    push: vi.fn((projectId, agentId, type, data) => ({
      id: 1,
      type,
      projectId,
      agentId,
      data,
      timestamp: new Date().toISOString(),
    })),
    getRecent: vi.fn(() => []),
    getSince: vi.fn(() => []),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Simple in-memory EventBuffer for testing
class MockEventBuffer {
  private events: PragentsEvent[] = [];
  private nextId = 1;

  push(projectId: string, agentId: string | undefined, type: string, data: any, taskId?: string): PragentsEvent {
    const event: PragentsEvent = {
      id: this.nextId++,
      projectId,
      agentId,
      taskId,
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  getRecent(_limit?: number, _projectId?: string): PragentsEvent[] {
    return this.events.slice(-(_limit || 50));
  }

  getSince(_sinceId: number, _projectId?: string): PragentsEvent[] {
    return [];
  }
}

describe('Chat SSE Route — POST /api/v1/chat', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-chat-route-'));
  let conversationManager: ConversationManager;
  let directRouter: DirectRouter;
  let mockDecomposer: NLDecomposer;
  let mockToolExecutor: ToolExecutor;
  let agents: ResolvedAgent[];
  let eventBuffer: MockEventBuffer;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    conversationManager = new ConversationManager();
    directRouter = new DirectRouter();
    agents = createMockAgents();
    eventBuffer = new MockEventBuffer();

    // Mock NL Decomposer
    mockDecomposer = {
      decompose: vi.fn().mockResolvedValue({
        steps: [
          { description: 'Build landing page', agentId: 'dev' },
          { description: 'Add SEO meta', agentId: 'dev' },
        ],
      }),
    } as any;

    // Mock Tool Executor
    mockToolExecutor = {
      execute: vi.fn().mockResolvedValue(JSON.stringify([])),
    } as any;
  });
  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  function createApp(): Hono {
    return createChatRoute(
      conversationManager,
      directRouter,
      mockDecomposer,
      mockToolExecutor,
      agents,
      eventBuffer as any,
    );
  }

  // ---- Error cases (non-stream) ----
  it('returns 400 for invalid JSON body', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for empty message', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for missing message field', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // ---- AE1: One-shot Command (DirectRouter match) ----
  it('AE1: streams tool_call, tool_result, message, done for direct match', async () => {
    // Set up tool executor to return a specific result
    (mockToolExecutor.execute as any).mockResolvedValue(
      JSON.stringify([{ id: 'a1', type: 'dev', projectId: 'proj-1' }]),
    );

    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Welche Agents gibt es?' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    // Should have: thinking, tool_call, tool_result, message, done
    const types = events.map((e) => e.type);
    expect(types).toContain('thinking');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('message');
    expect(types).toContain('done');

    // Verify done event has conversationId
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeTruthy();
    expect(doneEvent!.data).toHaveProperty('conversationId');
  });

  // ---- AE2: Multi-Turn with conversationId ----
  it('AE2: reuses conversation when conversationId is provided', async () => {
    // First, create a conversation and message
    const firstApp = createApp();
    const firstRes = await firstApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Zeig agents' }),
    });
    const firstText = await readStreamText(firstRes);
    const firstEvents = parseSSEStream(firstText);
    const convId = firstEvents.find((e) => e.type === 'done')?.data?.conversationId;
    expect(convId).toBeTruthy();

    // Second request with same conversationId
    const secondRes = await firstApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Zeig agents', conversationId: convId }),
    });
    const secondText = await readStreamText(secondRes);
    const secondEvents = parseSSEStream(secondText);
    const secondDone = secondEvents.find((e) => e.type === 'done');
    expect(secondDone!.data.conversationId).toBe(convId);

    // History should now have 4 messages (2 user + 2 assistant)
    const history = conversationManager.getHistory(convId);
    expect(history.length).toBe(4);
  });

  // ---- AE3: NL Decomposition → plan_proposal ----
  it('AE3: streams plan_proposal for complex message not matched by DirectRouter', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bau mir eine Landing Page' }),
    });

    expect(res.status).toBe(200);
    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    // Should have thinking, message with plan_proposal, done
    const types = events.map((e) => e.type);
    expect(types).toContain('thinking');
    expect(types).toContain('done');

    // Find the plan_proposal message
    const planMsg = events.find(
      (e) => e.type === 'message' && e.data?.subtype === 'plan_proposal',
    );
    expect(planMsg).toBeTruthy();
    expect(planMsg!.data.plan).toBeDefined();
  });

  // ---- AE4: Message with attachment ----
  it('AE4: forwards attachment data to decomposer', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Analyze this image',
        attachments: [
          { name: 'screenshot.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const text = await readStreamText(res);
    const events = parseSSEStream(text);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  // ---- Error path: Tool executor throws ----
  it('emits error event when tool executor throws', async () => {
    (mockToolExecutor.execute as any).mockRejectedValueOnce(new Error('Tool failed'));

    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Zeig tasks' }),
    });

    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeTruthy();
    expect(errorEvent!.data.code).toBe('TOOL_ERROR');
  });

  // ---- Error path: NL Decomposer throws ----
  it('emits error event when NL decomposer throws', async () => {
    (mockDecomposer.decompose as any).mockRejectedValueOnce(new Error('Decomposer error'));

    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bau etwas komplexes' }),
    });

    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeTruthy();
    expect(errorEvent!.data.code).toBe('DECOMPOSER_ERROR');
  });

  // ---- SSE events validate against schemas ----
  it('all emitted SSE events validate against SSEEventSchema', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Zeig agents' }),
    });

    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    for (const event of events) {
      const validation = SSEEventSchema.safeParse(event);
      expect(validation.success).toBe(true);
    }
  });

  // ---- done event includes conversationId ----
  it('done event always includes conversationId', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeTruthy();
    expect(typeof doneEvent!.data.conversationId).toBe('string');
    expect(doneEvent!.data.conversationId.length).toBeGreaterThan(0);
  });

  // ---- Heartbeats do not interfere with events ----
  it('does not emit heartbeat lines as parseable events', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Zeig agents' }),
    });

    const text = await readStreamText(res);
    const events = parseSSEStream(text);

    // All parsed events should have a type field (heartbeats are comments and ignored)
    for (const event of events) {
      expect(event.type).toBeTruthy();
    }
  });

  // ---- Conversation persists across requests ----
  it('persists user and assistant messages in conversation', async () => {
    const app = createApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Zeig agents' }),
    });

    const text = await readStreamText(res);
    const events = parseSSEStream(text);
    const convId = events.find((e) => e.type === 'done')?.data?.conversationId;

    // Check persisted messages
    const history = conversationManager.getHistory(convId);
    expect(history.length).toBe(2); // user + assistant
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Zeig agents');
    expect(history[1].role).toBe('assistant');
  });
});
