import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { resolveModel } from '../agents/model-resolver.js';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../logging/index.js';

export const PlanStepSchema = z.object({
  description: z.string(),
  agentId: z.string(),
  dependsOn: z.any().optional(),
});

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

/**
 * Normalise `dependsOn` before Zod validation. The LLM occasionally emits
 * numeric strings (`"0"`) or string arrays (`["1"]`) where the schema wants
 * integers. Mutates `parsed` in place and returns it.
 */
export function normalizePlan(parsed: any): any {
  if (parsed?.steps && Array.isArray(parsed.steps)) {
    for (const step of parsed.steps) {
      if (step.dependsOn != null) {
        if (typeof step.dependsOn === 'string' && /^\d+$/.test(step.dependsOn)) {
          step.dependsOn = parseInt(step.dependsOn, 10);
        } else if (Array.isArray(step.dependsOn)) {
          step.dependsOn = step.dependsOn.map((v: any) =>
            typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : v,
          );
        }
      }
    }
  }
  return parsed;
}

// ---- System prompt (module-level constant, same for every call) ----

const DECOMPOSER_SYSTEM_PROMPT = `You are a task planner. Return ONLY valid JSON with this structure:
{"steps":[{"description":"...","agentId":"id from list","dependsOn":null}]}

Rules: Use agentId from the provided list. Order steps logically. Keep descriptions concise. No markdown, no explanation — ONLY the JSON object.`;

// ---- Session cache ----
// One persistent in-memory pi-session per model string, reused across calls.
// Avoids per-call mkdtempSync + session setup overhead (fixes #18).

interface CachedSession {
  session: any;
  tmpDir: string;
}

const sessionCache = new Map<string, CachedSession>();

async function getOrCreateSession(modelString: string): Promise<CachedSession> {
  const cached = sessionCache.get(modelString);
  if (cached) return cached;

  const model = resolveModel(modelString);
  if (!model) throw new Error(`NLDecomposer: model "${modelString}" could not be resolved against the pi-ai registry`);

  const tmpDir = join(tmpdir(), `pragents-nl-${modelString.replace(/[^a-z0-9]/gi, '-')}`);
  mkdirSync(join(tmpDir, '.pi'), { recursive: true });

  const loader = new DefaultResourceLoader({
    cwd: tmpDir,
    agentDir: join(tmpDir, '.pi'),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => DECOMPOSER_SYSTEM_PROMPT,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: tmpDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory() as any,
    model: model as any,
    thinkingLevel: 'off',
    noTools: 'all',
  });

  const entry: CachedSession = { session, tmpDir };
  sessionCache.set(modelString, entry);
  logger.info({ modelString }, 'NLDecomposer: created and cached pi-session');
  return entry;
}

/**
 * Dispose all cached sessions. Call this on server shutdown.
 */
export async function shutdownDecomposerSessions(): Promise<void> {
  for (const [modelString, { session }] of sessionCache) {
    try { session.dispose(); } catch { /* ignore */ }
    logger.info({ modelString }, 'NLDecomposer: disposed cached session');
  }
  sessionCache.clear();
}

export class NLDecomposer {
  async decompose(prompt: string, agents: ResolvedAgent[]): Promise<Plan> {
    if (agents.length === 0) throw new Error('No agents configured');

    // Prefer the agent explicitly marked as fast; fall back to first agent.
    const fastAgent = agents.find((a) => a.role === 'fast');
    if (!fastAgent) {
      logger.warn('NLDecomposer: no agent with role "fast" configured; falling back to first agent');
    }
    const modelString = (fastAgent ?? agents[0]).model;

    const agentList = agents
      .map((a) => `- ${a.id} (${a.type}): ${a.skills.join(', ') || 'general'}`)
      .join('\n');

    const userMessage = `Available agents:\n${agentList}\n\nUser request: ${prompt}`;

    // Reuse cached session for this model (avoids per-call tmpdir + session setup)
    const { session } = await getOrCreateSession(modelString);

    try {
      let responseText = '';
      let unsubscribe = () => {};
      const responsePromise = new Promise<string>((resolve, reject) => {
        unsubscribe = session.subscribe((event: any) => {
          // pi SDK fires message_end with the finalized assistant message.
          if (event.type === 'message_end' && event.message?.role === 'assistant') {
            const content = event.message.content;
            if (typeof content === 'string') {
              responseText += content;
            } else if (Array.isArray(content)) {
              responseText += content.map((b: any) => b.text || '').join('');
            }
          }
          if (event.type === 'agent_end') resolve(responseText);
        });
        // 120s timeout
        setTimeout(() => {
          unsubscribe();
          resolve(responseText || '');
        }, 120000);
      });

      await session.prompt(userMessage);
      const raw = await responsePromise;

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in LLM response');

      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        await session.prompt('Invalid JSON. Return ONLY the JSON object, no other text.');
        let retryUnsubscribe = () => {};
        const retryRaw = await new Promise<string>((resolve) => {
          let rt = '';
          retryUnsubscribe = session.subscribe((event: any) => {
            if (event.type === 'message_end' && event.message?.role === 'assistant') {
              const content = event.message.content;
              if (typeof content === 'string') {
                rt += content;
              } else if (Array.isArray(content)) {
                rt += content.map((b: any) => b.text || '').join('');
              }
            }
            if (event.type === 'agent_end') resolve(rt);
          });
          setTimeout(() => { retryUnsubscribe(); resolve(rt); }, 120000);
        });
        const retryMatch = retryRaw.match(/\{[\s\S]*\}/);
        if (!retryMatch) throw new Error('LLM failed to produce valid JSON after retry');
        parsed = JSON.parse(retryMatch[0]);
      }

      const plan = PlanSchema.parse(normalizePlan(parsed));
      const validIds = new Set(agents.map((a) => a.id));
      for (const step of plan.steps) {
        if (!validIds.has(step.agentId)) {
          const byType = agents.find((a) => a.type === step.agentId || a.id.includes(step.agentId));
          if (byType) step.agentId = byType.id;
        }
      }

      return plan;
    } catch (err) {
      logger.warn({ err }, 'NLDecomposer: session failed');
      throw err;
    }
  }
}
