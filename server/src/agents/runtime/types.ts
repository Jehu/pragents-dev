/**
 * AgentRuntime — narrow interface between pragents and the underlying coding
 * agent runtime (currently the pi SDK).
 *
 * Goal: every pi-SDK-specific import and every brittle `as any` accessor lives
 * behind this interface. Higher-level code (AgentSessionManager and friends)
 * depends only on this contract, never on `@mariozechner/pi-coding-agent`
 * directly. Swapping or mocking the runtime is a constructor swap.
 *
 * The shape mirrors what pragents actually uses today — see `PiRuntime` for
 * the single concrete implementation.
 */

/**
 * Opaque handle to a live runtime session. `raw` carries the runtime-specific
 * session object (e.g. the pi `AgentSession`) so that the runtime can read it
 * back in subsequent calls without leaking the type to callers.
 */
export interface SessionHandle {
  /** pragents-side session id (typically the agent id). */
  id: string;
  /** Opaque runtime-specific session object. Do not access from outside the runtime. */
  raw: unknown;
  /** True iff the underlying session is currently mid-prompt. */
  readonly isStreaming: boolean;
}

/**
 * Message shape pragents persists / inspects. Matches the subset of pi SDK
 * messages we actually read. `content` may be a string or an array of blocks
 * (text, thinking, tool_use, etc.) — we keep it loose because the pi SDK
 * itself does.
 */
export interface RuntimeMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: unknown;
}

/**
 * Options for creating a fresh runtime session for a given pragents agent.
 *
 * `sessionDir` is the directory the runtime should treat as its private state
 * dir (pi SDK writes to `<sessionDir>/.pi/agent`). `cwd` is where the agent
 * should run commands (usually the project dir).
 *
 * `systemPromptOverride` receives the runtime's default system prompt and
 * returns the final prompt — pragents uses this to inject personality and
 * tool documentation.
 */
export interface CreateSessionOpts {
  id: string;
  cwd: string;
  sessionDir: string;
  systemPromptOverride: (base: string | undefined) => string;
  /** Custom tools to expose to the agent. Shape is runtime-specific; passed through. */
  customTools?: unknown[];
}

/** Runtime event shape — pragents only cares about `type` and a couple of fields per event. */
export type RuntimeEvent = {
  type: string;
  // Event-specific fields (e.g. custom_tool_call carries name/args/callId).
  [key: string]: unknown;
};

export type EventCallback = (event: RuntimeEvent) => void;

/**
 * The narrow runtime surface. All pi-SDK specifics live behind this.
 */
export interface AgentRuntime {
  /** Create and initialize a fresh session. */
  createSession(opts: CreateSessionOpts): Promise<SessionHandle>;

  /**
   * Read the full message history from the underlying session.
   * Returns `undefined` if the runtime cannot expose messages (e.g. the pi
   * SDK accessor path is missing). Callers must treat `undefined` as "skip
   * persistence" and log a structured warning.
   */
  getMessages(handle: SessionHandle): RuntimeMessage[] | undefined;

  /** Send a user prompt to the session. Resolves when the prompt has been accepted. */
  prompt(handle: SessionHandle, message: string): Promise<void>;

  /** Subscribe to runtime events. Returns an unsubscribe function. */
  subscribe(handle: SessionHandle, cb: EventCallback): () => void;

  /**
   * Deliver a custom-tool result back to the session.
   * No-op (best-effort) if the underlying session does not support tool results.
   */
  sendToolResult(handle: SessionHandle, callId: string, result: string): void;

  /** Dispose the underlying session. Idempotent. */
  dispose(handle: SessionHandle): void;
}
