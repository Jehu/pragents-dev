import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentSession, ResourceLoader } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { MemoryEngine } from '../memory/engine.js';
import type { CostTracker } from '../tracking/cost-tracker.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SessionHandle {
  agentId: string;
  session: AgentSession;
  loader: ResourceLoader;
  createdAt: number;
  lastActivityAt: number;
}

export class AgentSessionManager {
  private sessions: Map<string, SessionHandle> = new Map();
  private idleTimeoutMs: number;
  private memory: MemoryEngine;
  private onEvent: ((event: any) => void) | null = null;

  private costTracker: CostTracker | null = null;

  constructor(memory: MemoryEngine, idleTimeoutMs: number = 10 * 60 * 1000) {
    this.memory = memory;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  setCostTracker(ct: CostTracker): void {
    this.costTracker = ct;
  }

  setEventCallback(cb: (event: any) => void): void {
    this.onEvent = cb;
  }

  async getOrCreate(agent: ResolvedAgent): Promise<SessionHandle> {
    const existing = this.sessions.get(agent.id);
    if (existing && !existing.session.isStreaming) {
      existing.lastActivityAt = Date.now();
      return existing;
    }

    return this.create(agent);
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
      systemPromptOverride: (base: string | undefined) =>
        (base ?? '') + '\n\n---\n' + (agent.personality || 'You are a helpful coding agent.'),
    });

    console.log(`Agent "${agent.id}" model: ${agent.model}, projectDir: ${agent.projectDir}, cwd: ${agent.projectDir}`);
    if (!agent.projectDir) {
      console.error(`FATAL: agent.projectDir is undefined for ${agent.id}. Agent config:`, JSON.stringify(agent));
    }
    await loader.reload();

    // Need to pass projectDir so agent tools can access actual project files
    const { session } = await createAgentSession({
      cwd: agent.projectDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory() as any,
      model: agent.model as any,
    });
    console.log(`Session created for "${agent.id}" with model "${agent.model}"`);

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
    const handle = await this.getOrCreate(agent);

    // Assemble memory context — respect token budget
    const facts = await this.memory.recall(task, agent.projectId, 10);
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

    // Capture agent response via one-time event listener
    const responsePromise = new Promise<string>((resolve) => {
      const messages: string[] = [];
      const unsubscribe = handle.session.subscribe((event: any) => {
        if (event.type === 'assistant_message' && event.message?.content) {
          const content = typeof event.message.content === 'string'
            ? event.message.content
            : event.message.content.map((b: any) => b.text || '').join('');
          messages.push(content);
        }
        if (event.type === 'agent_end') {
          unsubscribe();
          resolve(messages.join('\n') || 'Task completed (no text response)');
        }
      });
      // Timeout safety net
      setTimeout(() => {
        unsubscribe();
        resolve(messages.join('\n') || 'Task timed out without response');
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

    return response;
  }

  async disposeIdle(): Promise<string[]> {
    const now = Date.now();
    const disposed: string[] = [];

    for (const [id, handle] of this.sessions) {
      if (!handle.session.isStreaming && now - handle.lastActivityAt > this.idleTimeoutMs) {
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
