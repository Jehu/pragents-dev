import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { resolveModel } from '../agents/model-resolver.js';
import { z } from 'zod';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
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
Classify the user message into EXACTLY ONE of these intents:

- "query_tasks" — the user wants to see or list tasks (by status, project, or agent)
- "create_task" — the user wants to create a new task
- "run_workflow" — the user wants to run, start, trigger, or deploy a named workflow
- "list_workflows" — the user wants to see available workflows
- "search_memory" — the user wants to recall or search stored facts, memories, or knowledge
- "remember_fact" — the user wants to save or remember a new fact
- "delete_fact" — the user wants to delete or forget a stored fact
- "list_agents" — the user wants to see available agents or their status
- "get_cost_summary" — the user wants to see token usage or costs
- "list_skills" — the user wants to see available skills
- "list_pending_gates" — the user wants to see pending approvals or human gates
- "list_goals" — the user wants to see goals or objectives
- "list_events" — the user wants to see recent activity or events
- "complex" — the message is ambiguous, chit-chat, or requires planning (NOT a simple lookup)

Also extract any relevant arguments from the message:
- For "query_tasks": extract "status" (e.g., failed, pending, blocked)
- For "run_workflow": extract "name" (the workflow name)
- For "search_memory": extract "query" (the search term)
- For "create_task": extract "description" and optionally "agentId"
- For "remember_fact": extract the fact "content" and optionally "category"
- For all others: leave args empty {}.

Return ONLY a JSON object with this exact structure, no markdown, no explanation outside the JSON:
{"tool":"<intent>","args":{...}}`;

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

    // Pick the fastest/cheapest available model and resolve to pi-ai Model object
    const modelString = this.pickModelString();
    const model = resolveModel(modelString);
    if (!model) {
      logger.warn({ modelString },
        'IntentClassifier: model could not be resolved, skipping classification');
      return null;
    }

    // Setup temp dir for SDK session
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-intent-'));
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
      // Classification doesn't need reasoning or tools — disable both to
      // force the model to answer with plain text JSON, not tool calls.
      thinkingLevel: 'off',
      noTools: 'all',
    });

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
    } finally {
      try { session.dispose(); } catch { /* ignore */ }
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
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
