import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentSession, ResourceLoader } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { MemoryEngine } from '../memory/engine.js';
import type { CostTracker } from '../tracking/cost-tracker.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolExecutor } from './tool-executor.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';
import { getDb } from '../db/sqlite.js';
import type { SkillAutoExtractor } from '../skills/auto-extractor.js';
import { logger } from '../logging/index.js';

export interface SessionHandle {
  agentId: string;
  session: AgentSession;
  loader: ResourceLoader;
  createdAt: number;
  lastActivityAt: number;
  stale?: boolean;
}

export class AgentSessionManager {
  private sessions: Map<string, SessionHandle> = new Map();
  private idleTimeoutMs: number;
  private memory: MemoryEngine;
  private onEvent: ((event: any) => void) | null = null;

  private costTracker: CostTracker | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private autoExtractor: SkillAutoExtractor | null = null;

  constructor(memory: MemoryEngine, idleTimeoutMs: number = 10 * 60 * 1000) {
    this.memory = memory;
    this.idleTimeoutMs = idleTimeoutMs;
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
      if (existing.stale && !existing.session.isStreaming) {
        logger.info({ agentId: agent.id }, 'Restarting stale session with updated config');
        this.persistSessionMessages(agent.id, existing);
        existing.session.dispose();
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
    // Create temp dir for SDK session (avoids pi SDK init issues)
    const tmpDir = join(process.env.HOME || '/tmp', '.pragents', 'sessions', agent.id);
    const agentDir = join(tmpDir, '.pi', 'agent');
    mkdirSync(agentDir, { recursive: true });

    const loader = new DefaultResourceLoader({
      cwd: tmpDir,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
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
    });

    logger.info({ agentId: agent.id, model: agent.model, projectDir: agent.projectDir }, 'Agent session initializing');
    if (!agent.projectDir) {
      logger.error({ agentId: agent.id, config: JSON.stringify(agent) }, 'FATAL: agent.projectDir is undefined');
    }
    await loader.reload();

    // Need to pass projectDir so agent tools can access actual project files
    const { session } = await createAgentSession({
      cwd: agent.projectDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory() as any,
      customTools: this.toolExecutor ? TOOL_DEFINITIONS as any : undefined,
      // model auto-discovered by pi SDK from configured API keys
    });
    logger.info({ agentId: agent.id, model: agent.model }, 'Session created');

    // Subscribe to SDK events
    session.subscribe((event: any) => {
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

    const handle: SessionHandle = {
      agentId: agent.id,
      session,
      loader,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.sessions.set(agent.id, handle);
    return handle;
  }

  async dispatch(agent: ResolvedAgent, task: string): Promise<string> {
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
      const unsubscribe = handle.session.subscribe((event: any) => {
        if (event.type === 'agent_end') {
          unsubscribe();
          // Read last assistant message, filtering out thinking blocks
          const msgs = (handle.session.agent as any)?.state?.messages || [];
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
          this.toolExecutor.execute(event.name, event.args || {}).then((result) => {
            try { (handle.session as any).sendToolResult?.(event.callId, result); } catch {}
          }).catch((err) => {
            try { (handle.session as any).sendToolResult?.(event.callId, `Error: ${err?.message || String(err)}`); } catch {}
          });
        }
      });
      // Timeout safety net
      setTimeout(() => {
        unsubscribe();
        reject(new Error('Task timed out without response'));
      }, 10 * 60 * 1000);
    });

    await handle.session.prompt(task + contextStr);
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
   * Called from disposeIdle() and disposeAll() before session.dispose().
   */
  private persistSessionMessages(sessionId: string, handle: SessionHandle): void {
    try {
      const messages = (handle.session.agent as any)?.state?.messages;
      if (messages === undefined || messages === null) {
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
      if (!handle.session.isStreaming && now - handle.lastActivityAt > this.idleTimeoutMs) {
        this.persistSessionMessages(id, handle);

        // Try auto-extraction after persistence (fire-and-forget, R9)
        if (this.autoExtractor) {
          const messages = (handle.session.agent as any)?.state?.messages;
          this.autoExtractor.tryExtract(id, messages).catch((err: any) =>
            logger.error({ sessionId: id, err: err?.message || err }, 'Auto-extraction error for session'),
          );
        }

        handle.session.dispose();
        this.sessions.delete(id);
        this.memory.compress(id, id);
        disposed.push(id);
      }
    }

    return disposed;
  }

  async disposeAll(): Promise<void> {
    for (const [id, handle] of this.sessions) {
      if (handle.session.isStreaming) {
        // Wait briefly for current turn to finish
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      this.persistSessionMessages(id, handle);

      // Try auto-extraction after persistence (fire-and-forget, R9)
      if (this.autoExtractor) {
        const messages = (handle.session.agent as any)?.state?.messages;
        this.autoExtractor.tryExtract(id, messages).catch((err: any) =>
          logger.error({ sessionId: id, err: err?.message || err }, 'Auto-extraction error for session'),
        );
      }

      handle.session.dispose();
      this.memory.compress(id, id);
    }
    this.sessions.clear();
  }

  getActiveAgents(): string[] {
    return Array.from(this.sessions.keys());
  }

  getAgentStatus(agentId: string): 'busy' | 'idle' | 'offline' {
    const handle = this.sessions.get(agentId);
    if (!handle) return 'offline';
    return handle.session.isStreaming ? 'busy' : 'idle';
  }
}
