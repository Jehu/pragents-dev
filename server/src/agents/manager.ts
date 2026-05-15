import type { ResolvedAgent } from '../config/schema.js';
import { MemoryEngine } from '../memory/engine.js';
import type { CostTracker } from '../tracking/cost-tracker.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolExecutor } from './tool-executor.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';
import { getDb } from '../db/sqlite.js';
import type { SkillAutoExtractor } from '../skills/auto-extractor.js';
import { logger } from '../logging/index.js';
import type { AgentRuntime, SessionHandle as RuntimeSessionHandle } from './runtime/types.js';
import { PiRuntime } from './runtime/pi-runtime.js';

/**
 * pragents-side handle around a runtime `SessionHandle`. Carries scheduling
 * state (idle/keepWarm/stale) that the manager owns, separate from the
 * runtime's own session object.
 */
export interface SessionHandle {
  agentId: string;
  runtimeHandle: RuntimeSessionHandle;
  createdAt: number;
  lastActivityAt: number;
  stale?: boolean;
  /**
   * When true, this session was spawned for a keepWarm agent and must not be
   * recycled by the idle-shutdown sweep. It will only be disposed by
   * disposeAll() (server shutdown) or by stale-flag restart after a config
   * reload (see #35).
   */
  warm?: boolean;
}

export class AgentSessionManager {
  private sessions: Map<string, SessionHandle> = new Map();
  private idleTimeoutMs: number;
  private memory: MemoryEngine;
  private onEvent: ((event: any) => void) | null = null;
  /**
   * Maximum number of concurrent keepWarm sessions. Beyond this cap,
   * additional keepWarm agents stay cold. Configured via
   * `pool.maxWarmSessions` in pragents.yaml (default 10).
   */
  private maxWarmSessions: number;
  private runtime: AgentRuntime;

  private costTracker: CostTracker | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private autoExtractor: SkillAutoExtractor | null = null;

  constructor(
    memory: MemoryEngine,
    idleTimeoutMs: number = 10 * 60 * 1000,
    maxWarmSessions: number = 10,
    runtime: AgentRuntime = new PiRuntime(),
  ) {
    this.memory = memory;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxWarmSessions = maxWarmSessions;
    this.runtime = runtime;
  }

  setToolExecutor(te: ToolExecutor): void {
    this.toolExecutor = te;
  }

  setCostTracker(ct: CostTracker): void {
    this.costTracker = ct;
  }

  setEventCallback(cb: (event: any) => void): void {
    this.onEvent = cb;
  }

  setAutoExtractor(ae: SkillAutoExtractor): void {
    this.autoExtractor = ae;
  }

  async getOrCreate(agent: ResolvedAgent): Promise<SessionHandle> {
    const existing = this.sessions.get(agent.id);
    if (existing) {
      // If session is stale and not currently streaming, dispose and respawn with fresh config
      if (existing.stale && !existing.runtimeHandle.isStreaming) {
        logger.info({ agentId: agent.id }, 'Restarting stale session with updated config');
        this.persistSessionMessages(agent.id, existing);
        this.runtime.dispose(existing.runtimeHandle);
        this.sessions.delete(agent.id);
        return this.create(agent);
      }
      // Reuse existing session even if streaming — pi SDK sequential prompts work on same session
      existing.lastActivityAt = Date.now();
      return existing;
    }

    return this.create(agent);
  }

  /**
   * Mark a session as stale so it will be restarted on next dispatch/interaction.
   * Does not kill the session immediately — respects in-flight requests.
   */
  markStale(agentId: string): void {
    const handle = this.sessions.get(agentId);
    if (handle) {
      handle.stale = true;
      logger.info({ agentId }, 'Session marked stale after config reload');
    }
  }

  private async create(agent: ResolvedAgent): Promise<SessionHandle> {
    const sessionDir = join(process.env.HOME || '/tmp', '.pragents', 'sessions', agent.id);

    logger.info({ agentId: agent.id, model: agent.model, projectDir: agent.projectDir }, 'Agent session initializing');
    if (!agent.projectDir) {
      logger.error({ agentId: agent.id, config: JSON.stringify(agent) }, 'FATAL: agent.projectDir is undefined');
    }

    const runtimeHandle = await this.runtime.createSession({
      id: agent.id,
      cwd: agent.projectDir,
      sessionDir,
      systemPromptOverride: (base: string | undefined) => {
        const personality = agent.personality || 'You are a helpful coding agent.';
        const rememberTool = [
          '',
          '## Auto-Fact Collection',
          'When you discover important information during your work (conventions, decisions, patterns, constraints, architecture notes), output them as facts using this format:',
          '',
          'REMEMBER: [category] [scope] <fact content>',
          '',
          'Where:',
          '- category is one of: convention, decision, pattern, constraint, architecture, error_pattern, dependency',
          '- scope is the project ID (use the project you are working in) or "company" for org-wide facts',
          '- fact content is a concise, self-contained statement of the fact',
          '',
          'Example: REMEMBER: convention proj-acme Use tabs for indentation in TypeScript files',
          'Example: REMEMBER: decision company We use Hono for all HTTP routing',
          '',
          'You can output multiple REMEMBER lines. Place them at the end of your response.',
          'Only output facts that are genuinely useful for future sessions — do not output trivial or obvious facts.',
        ].join('\n');
        let prompt = (base ?? '') + '\n\n---\n' + personality + '\n' + rememberTool;
        if (this.toolExecutor) {
          prompt += '\n\n## Available Tools\nYou have access to the following tools. Call them when you need to query, create, or act on platform resources.\n\n';
          prompt += TOOL_DEFINITIONS.map((t: any) => `- **${t.name}**: ${t.description}`).join('\n');
        }
        return prompt;
      },
      customTools: this.toolExecutor ? (TOOL_DEFINITIONS as unknown[]) : undefined,
    });
    logger.info({ agentId: agent.id, model: agent.model }, 'Session created');

    // Subscribe to runtime events and fan out to the manager's event callback.
    this.runtime.subscribe(runtimeHandle, (event) => {
      if (this.onEvent) {
        this.onEvent({
          agentId: agent.id,
          projectId: agent.projectId,
          type: event.type,
          event,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Only honor keepWarm if the warm-session cap has not been reached.
    // Sessions already in the pool count toward the cap; the agent we are
    // about to add does not yet — so the comparison is `<`, not `<=`.
    let warm = false;
    if (agent.keepWarm) {
      const warmCount = this.countWarmSessions();
      if (warmCount < this.maxWarmSessions) {
        warm = true;
      } else {
        logger.warn(
          { agentId: agent.id, cap: this.maxWarmSessions, warmCount },
          'Warm-session cap reached; subsequent keepWarm agents will stay cold',
        );
      }
    }

    const handle: SessionHandle = {
      agentId: agent.id,
      runtimeHandle,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      warm,
    };

    this.sessions.set(agent.id, handle);
    return handle;
  }

  private countWarmSessions(): number {
    let count = 0;
    for (const h of this.sessions.values()) {
      if (h.warm) count++;
    }
    return count;
  }

  /**
   * Pre-spawn sessions for all agents flagged `keepWarm: true`, up to the
   * configured pool cap. Best-effort: a single spawn failure logs a warning
   * but does not abort the loop or block server startup. Spawns are
   * sequential to avoid a RAM spike on boot.
   */
  async prewarmKeepWarmAgents(agents: ResolvedAgent[]): Promise<void> {
    const keepWarmAgents = agents.filter((a) => a.keepWarm);
    if (keepWarmAgents.length === 0) return;

    logger.info(
      { count: keepWarmAgents.length, cap: this.maxWarmSessions },
      'Pre-spawning keepWarm agent sessions',
    );

    for (const agent of keepWarmAgents) {
      if (this.countWarmSessions() >= this.maxWarmSessions) {
        logger.warn(
          { agentId: agent.id, cap: this.maxWarmSessions },
          'Warm-session cap reached; subsequent keepWarm agents will stay cold',
        );
        continue;
      }
      try {
        await this.getOrCreate(agent);
        logger.info({ agentId: agent.id }, 'KeepWarm agent pre-spawned');
      } catch (err: any) {
        logger.warn(
          { agentId: agent.id, err: err?.message || String(err) },
          'Failed to pre-spawn keepWarm agent — will spawn on first dispatch',
        );
      }
    }
  }

  async dispatch(agent: ResolvedAgent, task: string, taskId?: string): Promise<string> {
    // Enforce token budget before dispatching
    if (agent.tokenBudget && this.costTracker) {
      const usage = this.costTracker.getAgentCost(agent.id);
      const used = (usage.tokensIn ?? 0) + (usage.tokensOut ?? 0);
      if (used >= agent.tokenBudget) {
        logger.warn(
          { agentId: agent.id, used, budget: agent.tokenBudget },
          'Token budget exceeded — dispatch blocked',
        );
        if (this.onEvent) {
          this.onEvent({
            agentId: agent.id,
            projectId: agent.projectId,
            type: 'budget.exceeded',
            used,
            budget: agent.tokenBudget,
            timestamp: new Date().toISOString(),
          });
        }
        throw new Error('Token budget exceeded');
      }
    }

    const handle = await this.getOrCreate(agent);

    // Assemble memory context — respect token budget
    const facts = await this.memory.recall(task, agent.projectId, 10, agent);
    const budget = agent.tokenBudget || 40000;
    const taskTokens = Math.ceil(task.length / 4);
    const remainingBudget = Math.max(budget - taskTokens - 500, 500); // Reserve 500 for system prompt overhead
    let contextStr = '';
    let usedTokens = 0;
    for (const f of facts) {
      const factTokens = Math.ceil(f.content.length / 4);
      if (usedTokens + factTokens > remainingBudget) break;
      contextStr += `\n- ${f.category}: ${f.content}`;
      usedTokens += factTokens;
    }
    if (contextStr) {
      contextStr = '\n\nRelevant project knowledge:\n' + contextStr;
    }

    // Capture agent response — skip events, read session state after prompt completes
    const responsePromise = new Promise<string>((resolve, reject) => {
      const unsubscribe = this.runtime.subscribe(handle.runtimeHandle, (event) => {
        if (event.type === 'agent_end') {
          unsubscribe();
          // Read last assistant message, filtering out thinking blocks
          const msgs = this.runtime.getMessages(handle.runtimeHandle) ?? [];
          let responseText = '';
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant' && msgs[i].content) {
              const content = msgs[i].content;
              if (Array.isArray(content)) {
                responseText = content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text || '')
                  .join('');
              } else if (typeof content === 'string') {
                responseText = content;
              }
              if (responseText.trim()) break;
            }
          }
          resolve(responseText.trim() || 'Task completed (no text response)');
        }
        // Handle custom tool calls from the agent
        if (event.type === 'custom_tool_call' && this.toolExecutor) {
          const name = event.name as string;
          const args = (event.args as Record<string, unknown>) || {};
          const callId = event.callId as string;
          this.toolExecutor.execute(name, args, agent).then((result) => {
            this.runtime.sendToolResult(handle.runtimeHandle, callId, result);
          }).catch((err) => {
            this.runtime.sendToolResult(
              handle.runtimeHandle,
              callId,
              `Error: ${err?.message || String(err)}`,
            );
          });
        }
      });
      // Timeout safety net
      setTimeout(() => {
        unsubscribe();
        reject(new Error('Task timed out without response'));
      }, 10 * 60 * 1000);
    });

    await this.runtime.prompt(handle.runtimeHandle, task + contextStr);
    handle.lastActivityAt = Date.now();
    const response = await responsePromise;

    // Track cost (character-based token estimate)
    if (this.costTracker) {
      this.costTracker.record({
        projectId: agent.projectId,
        agentId: agent.id,
        model: agent.model,
        tokensIn: Math.ceil((task + contextStr).length / 4),
        tokensOut: Math.ceil(response.length / 4),
        taskId,
      });
    }

    // Auto-fact collection: parse REMEMBER lines from agent response
    const rememberedFacts = AgentSessionManager.extractRememberedFacts(response, agent.id);
    for (const fact of rememberedFacts) {
      try {
        this.memory.remember(fact.scope, fact.category, fact.content, agent.id, agent);
      } catch (err: any) {
        logger.warn({ agentId: agent.id, scope: fact.scope, err: err?.message }, 'Skipped auto-remembered fact due to scope policy');
      }
    }
    if (rememberedFacts.length > 0) {
      logger.info({ agentId: agent.id, count: rememberedFacts.length }, 'Agent auto-remembered facts');
    }

    return response;
  }

  /**
   * Parse REMEMBER: lines from an agent response.
   * Format: REMEMBER: [category] [scope] <content>
   * Returns the cleaned response (with REMEMBER lines removed) via the facts array.
   */
  static extractRememberedFacts(
    response: string,
    agentId: string,
  ): Array<{ scope: string; category: string; content: string }> {
    const facts: Array<{ scope: string; category: string; content: string }> = [];
    const validCategories = new Set([
      'convention', 'decision', 'pattern', 'constraint',
      'architecture', 'error_pattern', 'dependency',
    ]);

    const lines = response.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('REMEMBER:')) continue;

      const rest = trimmed.substring('REMEMBER:'.length).trim();
      // Parse: category scope content
      const parts = rest.split(/\s+/);
      if (parts.length < 3) continue;

      const category = parts[0].toLowerCase();
      if (!validCategories.has(category)) continue;

      const scope = parts[1];
      const content = parts.slice(2).join(' ');

      if (content.length > 0) {
        facts.push({ scope, category, content });
      }
    }

    return facts;
  }

  /**
   * Persist the full message history for a session before it is disposed.
   * Called from disposeIdle() and disposeAll() before runtime.dispose().
   *
   * If the runtime cannot expose messages (returns `undefined`), we log a
   * structured warning and skip — see issue #31.
   */
  private persistSessionMessages(sessionId: string, handle: SessionHandle): void {
    try {
      const messages = this.runtime.getMessages(handle.runtimeHandle);
      if (messages === undefined) {
        logger.warn(
          { accessor: 'session.agent.state.messages', agentId: handle.agentId },
          'pi-SDK session messages accessor returned undefined — skipping persist',
        );
        return;
      }
      if (messages.length === 0) return;

      const db = getDb();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO session_messages (id, session_id, messages_json, message_count)
         VALUES (?, ?, ?, ?)`,
      ).run(id, sessionId, JSON.stringify(messages), messages.length);
    } catch (err) {
      // Best-effort: log and continue — don't block dispose on persistence failure
      logger.error({ sessionId, err }, 'Failed to persist messages for session');
    }
  }

  /**
   * Retrieve persisted session messages by session ID.
   * Returns the parsed message array, or null if not found.
   */
  getSessionMessages(sessionId: string): any[] | null {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT messages_json FROM session_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(sessionId) as { messages_json: string } | undefined;

      if (!row) return null;
      return JSON.parse(row.messages_json);
    } catch (err) {
      logger.error({ sessionId, err }, 'Failed to read messages for session');
      return null;
    }
  }

  async disposeIdle(): Promise<string[]> {
    const now = Date.now();
    const disposed: string[] = [];

    for (const [id, handle] of this.sessions) {
      // KeepWarm sessions never participate in the idle sweep. Stale-flag
      // restart (see #35) still applies via getOrCreate(), so a warm agent
      // gets a fresh session on the next dispatch after config reload.
      if (handle.warm) continue;
      if (!handle.runtimeHandle.isStreaming && now - handle.lastActivityAt > this.idleTimeoutMs) {
        this.persistSessionMessages(id, handle);

        // Try auto-extraction after persistence (fire-and-forget, R9)
        if (this.autoExtractor) {
          const messages = this.runtime.getMessages(handle.runtimeHandle);
          this.autoExtractor.tryExtract(id, messages).catch((err: any) =>
            logger.error({ sessionId: id, err: err?.message || err }, 'Auto-extraction error for session'),
          );
        }

        this.runtime.dispose(handle.runtimeHandle);
        this.sessions.delete(id);
        this.memory.compress(id, id);
        disposed.push(id);
      }
    }

    return disposed;
  }

  async disposeAll(): Promise<void> {
    for (const [id, handle] of this.sessions) {
      if (handle.runtimeHandle.isStreaming) {
        // Wait briefly for current turn to finish
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      this.persistSessionMessages(id, handle);

      // Try auto-extraction after persistence (fire-and-forget, R9)
      if (this.autoExtractor) {
        const messages = this.runtime.getMessages(handle.runtimeHandle);
        this.autoExtractor.tryExtract(id, messages).catch((err: any) =>
          logger.error({ sessionId: id, err: err?.message || err }, 'Auto-extraction error for session'),
        );
      }

      this.runtime.dispose(handle.runtimeHandle);
      this.memory.compress(id, id);
    }
    this.sessions.clear();
  }

  getActiveAgents(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Return the agent IDs of all active sessions that belong to a given
   * project. Agent IDs follow the `<type>@<projectId>` convention
   * established by `resolveAllAgents` (see `config/schema.ts`).
   *
   * Used by the project-DELETE endpoint (R6 / AE8) to block destructive
   * config edits while sessions are still running for that project.
   */
  getActiveSessionsForProject(projectId: string): string[] {
    const suffix = `@${projectId}`;
    return Array.from(this.sessions.keys()).filter((id) => id.endsWith(suffix));
  }

  getAgentStatus(agentId: string): 'busy' | 'idle' | 'offline' {
    const handle = this.sessions.get(agentId);
    if (!handle) return 'offline';
    return handle.runtimeHandle.isStreaming ? 'busy' : 'idle';
  }

  /**
   * Return session timing metadata for a given agent.
   * Returns null if no active session exists.
   */
  getSessionInfo(agentId: string): { id: string; startedAt: string; idleTimeoutMs: number; msUntilIdle: number } | null {
    const handle = this.sessions.get(agentId);
    if (!handle) return null;
    const elapsed = Date.now() - handle.lastActivityAt;
    const msUntilIdle = Math.max(0, this.idleTimeoutMs - elapsed);
    return {
      id: handle.runtimeHandle.id,
      startedAt: new Date(handle.createdAt).toISOString(),
      idleTimeoutMs: this.idleTimeoutMs,
      msUntilIdle,
    };
  }

  /**
   * Stop an agent session cleanly.
   * If mid-stream, waits up to 30 s then force-disposes.
   * Returns the session id that was stopped, or null if there was no session.
   */
  async stopAgent(agentId: string): Promise<string | null> {
    const handle = this.sessions.get(agentId);
    if (!handle) return null;

    const sessionId = handle.runtimeHandle.id;

    if (handle.runtimeHandle.isStreaming) {
      // Wait up to 30 s for the current turn to finish
      const deadline = Date.now() + 30_000;
      while (handle.runtimeHandle.isStreaming && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    this.persistSessionMessages(agentId, handle);
    this.runtime.dispose(handle.runtimeHandle);
    this.sessions.delete(agentId);

    logger.info({ agentId, sessionId }, 'Agent session stopped via API');
    return sessionId;
  }
}
