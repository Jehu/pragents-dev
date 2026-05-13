import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { AgentSession, ResourceLoader } from '@mariozechner/pi-coding-agent';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentRuntime,
  CreateSessionOpts,
  EventCallback,
  RuntimeMessage,
  SessionHandle,
} from './types.js';

/**
 * Internal shape of the pi SDK session object as pragents uses it.
 * Carried as `SessionHandle.raw` and unpacked only inside this file.
 */
interface PiSessionRaw {
  session: AgentSession;
  loader: ResourceLoader;
}

/**
 * Concrete `AgentRuntime` backed by `@mariozechner/pi-coding-agent`.
 *
 * This is the ONLY file in the codebase that imports from the pi SDK for the
 * managed-session lifecycle. Other short-lived pi usages (intent-classifier,
 * nl/decomposer, skills/extractor, semantic-compare) remain out-of-scope —
 * see issue #25.
 *
 * Every `as any` cast against pi internals is concentrated here.
 */
export class PiRuntime implements AgentRuntime {
  async createSession(opts: CreateSessionOpts): Promise<SessionHandle> {
    const agentDir = join(opts.sessionDir, '.pi', 'agent');
    mkdirSync(agentDir, { recursive: true });

    const loader = new DefaultResourceLoader({
      cwd: opts.sessionDir,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: opts.systemPromptOverride,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: opts.cwd,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory() as any,
      customTools: opts.customTools as any,
      // model auto-discovered by pi SDK from configured API keys
    });

    const raw: PiSessionRaw = { session, loader };
    return this.wrapHandle(opts.id, raw);
  }

  getMessages(handle: SessionHandle): RuntimeMessage[] | undefined {
    const raw = handle.raw as PiSessionRaw | undefined;
    if (!raw) return undefined;
    // The brittle pi-internals accessor — kept in exactly one place. If pi
    // changes its internal shape, this is the only file that needs updating.
    const messages = (raw.session.agent as any)?.state?.messages;
    if (messages === undefined || messages === null) return undefined;
    return messages as RuntimeMessage[];
  }

  async prompt(handle: SessionHandle, message: string): Promise<void> {
    const raw = handle.raw as PiSessionRaw;
    await raw.session.prompt(message);
  }

  subscribe(handle: SessionHandle, cb: EventCallback): () => void {
    const raw = handle.raw as PiSessionRaw;
    return raw.session.subscribe((event: any) => cb(event));
  }

  sendToolResult(handle: SessionHandle, callId: string, result: string): void {
    const raw = handle.raw as PiSessionRaw;
    try {
      (raw.session as any).sendToolResult?.(callId, result);
    } catch {
      // Best-effort — older pi SDK versions may not expose sendToolResult.
    }
  }

  dispose(handle: SessionHandle): void {
    const raw = handle.raw as PiSessionRaw | undefined;
    if (!raw) return;
    raw.session.dispose();
  }

  /**
   * Wrap a raw pi session in a `SessionHandle`. `isStreaming` is exposed as a
   * live getter so callers always see the current state without re-reading
   * the raw object.
   */
  private wrapHandle(id: string, raw: PiSessionRaw): SessionHandle {
    return {
      id,
      raw,
      get isStreaming(): boolean {
        return Boolean(raw.session.isStreaming);
      },
    };
  }
}
