import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { resolveModel } from '../agents/model-resolver.js';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../logging/index.js';

// ---- Schemas ----

export const IntentResultSchema = z.object({
  tool: z.enum([
    'query_tasks',
    'create_task',
    'run_workflow',
    'list_workflows',
    'search_memory',
    'remember_fact',
    'delete_fact',
    'list_agents',
    'get_cost_summary',
    'list_skills',
    'list_pending_gates',
    'list_goals',
    'list_events',
    'complex',
  ]),
  args: z.record(z.unknown()).optional().default({}),
  explanation: z.string().optional(),
});

export type IntentResult = z.infer<typeof IntentResultSchema>;

// ---- Classifier ----

const CLASSIFIER_TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT = `You are an intent classifier for a developer operations platform.
Your ONLY job: pick the single best tool for the user's message.

DECISION RULE (apply in order):
1. If the message is a simple lookup/fetch ("show me X", "list Y", "what is Z")
   → route to the specific tool (query_tasks, list_agents, list_workflows, etc.).
2. If the message asks to CREATE, RUN, DELETE, or MODIFY something
   → route to the specific tool (create_task, run_workflow, delete_fact, etc.).
3. ONLY if none of the above tools fit → use "complex".

Available tools:
- "query_tasks" — list or search tasks (often includes status words like failed/pending/blocked)
- "create_task" — create a new task
- "run_workflow" — start, trigger, deploy a named workflow
- "list_workflows" — show available workflows
- "search_memory" — recall/search stored facts or knowledge
- "remember_fact" — save a new fact
- "delete_fact" — delete a stored fact
- "list_agents" — show available agents or their status
- "get_cost_summary" — show token usage or costs
- "list_skills" — show available skills
- "list_pending_gates" — show pending approvals
- "list_goals" — show goals/objectives
- "list_events" — show recent activity
- "complex" — anything that doesn't fit the above (building, planning, analyzing, chit-chat)

EXAMPLES:
"Zeig alle Agents" → {"tool":"list_agents","args":{}}
"Welche Tasks sind failed?" → {"tool":"query_tasks","args":{"status":"failed"}}
"Was kostet das?" → {"tool":"get_cost_summary","args":{}}
"Start den weekly-article Workflow" → {"tool":"run_workflow","args":{"name":"weekly-article"}}
"Erstell einen Task für SEO" → {"tool":"create_task","args":{"description":"SEO task"}}
"Was weißt du über den API Bug?" → {"tool":"search_memory","args":{"query":"API Bug"}}
"Merk dir: Port 3000 ist der API-Server" → {"tool":"remember_fact","args":{"content":"Port 3000 ist der API-Server"}}
"Bau eine Landing Page" → {"tool":"complex","args":{}}
"Optimier meine SEO" → {"tool":"complex","args":{}}
"Hallo" → {"tool":"complex","args":{}}

Return ONLY: {"tool":"<tool>","args":{...}}`;

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
  if (!model) throw new Error(`IntentClassifier: model "${modelString}" could not be resolved`);

  const tmpDir = join(tmpdir(), `pragents-intent-${modelString.replace(/[^a-z0-9]/gi, '-')}`);
  mkdirSync(join(tmpDir, '.pi'), { recursive: true });

  const loader = new DefaultResourceLoader({
    cwd: tmpDir,
    agentDir: join(tmpDir, '.pi'),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => SYSTEM_PROMPT,
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
  logger.info({ modelString }, 'IntentClassifier: created and cached pi-session');
  return entry;
}

/**
 * Dispose all cached sessions. Call this on server shutdown.
 */
export async function shutdownClassifierSessions(): Promise<void> {
  for (const [modelString, { session }] of sessionCache) {
    try { session.dispose(); } catch { /* ignore */ }
    logger.info({ modelString }, 'IntentClassifier: disposed cached session');
  }
  sessionCache.clear();
}

export class IntentClassifier {
  private agents: ResolvedAgent[];
  private modelOverride: string | undefined;

  /**
   * @param agents — the configured agents (used as fallback model source)
   * @param modelOverride — optional model string ("provider/modelId") to use
   *   for classification instead of the first agent's model. Useful for
   *   running a fast/cheap model (e.g. claude-haiku) for routing while
   *   agents use stronger models for actual work.
   */
  constructor(agents: ResolvedAgent[], modelOverride?: string) {
    this.agents = agents;
    this.modelOverride = modelOverride;
  }

  /**
   * Classify a chat message into a tool intent or "complex".
   * Returns null if classification fails (graceful degradation → route to NL Decomposer).
   */
  async classify(message: string): Promise<IntentResult | null> {
    if (!message?.trim()) return null;

    // Pick the fastest/cheapest available model
    const modelString = this.pickModelString();
    if (!modelString) {
      logger.warn('IntentClassifier: no model configured, skipping classification');
      return null;
    }

    // Reuse cached session for this model (avoids per-call tmpdir + session setup)
    let session: any;
    try {
      ({ session } = await getOrCreateSession(modelString));
    } catch (err) {
      logger.warn({ err, modelString },
        'IntentClassifier: model could not be resolved, skipping classification');
      return null;
    }

    try {
      let responseText = '';
      const responsePromise = new Promise<string>((resolve) => {
        const unsubscribe = session.subscribe((event: any) => {
          // pi SDK fires message_end with the finalized assistant message.
          // We collect text content from there (not from streaming updates).
          if (event.type === 'message_end' && event.message?.role === 'assistant') {
            const content = event.message.content;
            if (typeof content === 'string') {
              responseText = content;
            } else if (Array.isArray(content)) {
              responseText = content
                .filter((b: any) => b?.text)
                .map((b: any) => b.text)
                .join('');
            } else if (content && typeof content === 'object' && (content as any).text) {
              responseText = (content as any).text;
            }
          }
          if (event.type === 'agent_end') {
            unsubscribe();
            resolve(responseText);
          }
        });
        // Timeout with cleanup
        setTimeout(() => {
          unsubscribe();
          resolve(responseText || '');
        }, CLASSIFIER_TIMEOUT_MS);
      });

      await session.prompt(message);
      const raw = await responsePromise;

      // Extract JSON from response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn({ raw: raw.substring(0, 200) }, 'IntentClassifier: no JSON in response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const result = IntentResultSchema.safeParse(parsed);

      if (!result.success) {
        logger.warn({ parsed, issues: result.error.issues },
          'IntentClassifier: invalid classification result');
        // Try to recover: if tool is valid but args aren't, use empty args
        if (parsed.tool && IntentResultSchema.shape.tool.safeParse(parsed.tool).success) {
          return { tool: parsed.tool, args: {} };
        }
        return null;
      }

      return result.data;
    } catch (err) {
      logger.warn({ err }, 'IntentClassifier: session failed');
      return null;
    }
  }

  /**
   * Pick the best model string for classification.
   * Resolution order:
   *   1. Explicit override passed to the constructor (config.chat.classifierModel)
   *   2. First agent that already runs a fast/cheap model (haiku, flash)
   *   3. First configured agent's model
   *   4. Empty string (resolveModel will return null → classifier returns null)
   */
  private pickModelString(): string {
    if (this.modelOverride) return this.modelOverride;

    const fastAgent = this.agents.find((a) =>
      a.model?.includes('haiku') || a.model?.includes('flash'),
    );
    if (fastAgent?.model) return fastAgent.model;

    if (this.agents[0]?.model) return this.agents[0].model;

    return '';
  }
}
