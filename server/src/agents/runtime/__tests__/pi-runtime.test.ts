import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pi SDK at module level so PiRuntime picks up the mocks.
vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(),
  SessionManager: { inMemory: vi.fn(() => ({})) },
}));

import { PiRuntime } from '../pi-runtime.js';
import type { SessionHandle } from '../types.js';

describe('PiRuntime.getMessages — pi-SDK accessor guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when session.agent.state.messages is absent', () => {
    const runtime = new PiRuntime();
    const handle: SessionHandle = {
      id: 'agent-x',
      isStreaming: false,
      raw: {
        session: { agent: { state: {} } },
        loader: {},
      },
    };

    expect(runtime.getMessages(handle)).toBeUndefined();
  });

  it('returns undefined when session.agent is absent entirely', () => {
    const runtime = new PiRuntime();
    const handle: SessionHandle = {
      id: 'agent-x',
      isStreaming: false,
      raw: {
        session: {},
        loader: {},
      },
    };

    expect(runtime.getMessages(handle)).toBeUndefined();
  });

  it('returns the messages array when present', () => {
    const runtime = new PiRuntime();
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const handle: SessionHandle = {
      id: 'agent-x',
      isStreaming: false,
      raw: {
        session: { agent: { state: { messages } } },
        loader: {},
      },
    };

    expect(runtime.getMessages(handle)).toEqual(messages);
  });

  it('returns undefined when raw is missing (defensive)', () => {
    const runtime = new PiRuntime();
    const handle: SessionHandle = {
      id: 'agent-x',
      isStreaming: false,
      raw: undefined,
    };

    expect(runtime.getMessages(handle)).toBeUndefined();
  });

  it('returns undefined when messages is null', () => {
    const runtime = new PiRuntime();
    const handle: SessionHandle = {
      id: 'agent-x',
      isStreaming: false,
      raw: {
        session: { agent: { state: { messages: null } } },
        loader: {},
      },
    };

    expect(runtime.getMessages(handle)).toBeUndefined();
  });
});

describe('PiRuntime.sendToolResult', () => {
  it('forwards to session.sendToolResult when present', () => {
    const runtime = new PiRuntime();
    const sendToolResult = vi.fn();
    const handle: SessionHandle = {
      id: 'a',
      isStreaming: false,
      raw: { session: { sendToolResult }, loader: {} },
    };

    runtime.sendToolResult(handle, 'call-1', 'ok');
    expect(sendToolResult).toHaveBeenCalledWith('call-1', 'ok');
  });

  it('is a no-op when session.sendToolResult is missing', () => {
    const runtime = new PiRuntime();
    const handle: SessionHandle = {
      id: 'a',
      isStreaming: false,
      raw: { session: {}, loader: {} },
    };

    expect(() => runtime.sendToolResult(handle, 'call-1', 'ok')).not.toThrow();
  });

  it('swallows errors thrown by the underlying call', () => {
    const runtime = new PiRuntime();
    const handle: SessionHandle = {
      id: 'a',
      isStreaming: false,
      raw: {
        session: {
          sendToolResult: () => {
            throw new Error('boom');
          },
        },
        loader: {},
      },
    };

    expect(() => runtime.sendToolResult(handle, 'call-1', 'ok')).not.toThrow();
  });
});
