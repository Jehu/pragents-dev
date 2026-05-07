import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentSession, ResourceLoader } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { MemoryEngine } from '../memory/engine.js';

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

  constructor(memory: MemoryEngine, idleTimeoutMs: number = 10 * 60 * 1000) {
    this.memory = memory;
    this.idleTimeoutMs = idleTimeoutMs;
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
    const loader = new DefaultResourceLoader({
      cwd: agent.projectDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: (base: string | undefined) =>
        (base ?? '') + '\n\n---\n' + (agent.personality || 'You are a helpful coding agent.'),
    });

    await loader.reload();

    const { session } = await createAgentSession({
      cwd: agent.projectDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory() as any,
      model: agent.model as any,
    });

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

    // Assemble memory context
    const facts = this.memory.recall(task, agent.projectId, 5);
    const contextStr =
      facts.length > 0
        ? '\n\nRelevant project knowledge:\n' +
          facts.map((f) => `- ${f.category}: ${f.content}`).join('\n')
        : '';

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
    return responsePromise;
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
