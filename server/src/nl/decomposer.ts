import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { resolveModel } from '../agents/model-resolver.js';
import { z } from 'zod';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

export class NLDecomposer {
  async decompose(prompt: string, agents: ResolvedAgent[]): Promise<Plan> {
    if (agents.length === 0) throw new Error('No agents configured');

    // Prefer fast/cheap models (haiku, flash) for planning
    const fastAgent = agents.find((a) =>
      a.model?.includes('haiku') || a.model?.includes('flash'),
    );
    const modelString = fastAgent?.model || agents[0].model;
    const model = resolveModel(modelString);
    if (!model) {
      throw new Error(`NLDecomposer: model "${modelString}" could not be resolved against the pi-ai registry`);
    }

    const agentList = agents
      .map((a) => `- ${a.id} (${a.type}): ${a.skills.join(', ') || 'general'}`)
      .join('\n');

    const systemPrompt = `You are a task planner. Return ONLY valid JSON with this structure:
{"steps":[{"description":"...","agentId":"id from list","dependsOn":null}]}

Rules: Use agentId from the provided list. Order steps logically. Keep descriptions concise. No markdown, no explanation — ONLY the JSON object.`;

    const userMessage = `Available agents:\n${agentList}\n\nUser request: ${prompt}`;

    // Setup temp dir for SDK session
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-nl-'));
    mkdirSync(join(tmpDir, '.pi'), { recursive: true });

    const loader = new DefaultResourceLoader({
      cwd: tmpDir,
      agentDir: join(tmpDir, '.pi'),
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: tmpDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory() as any,
      model: model as any,
      // Disable reasoning and tools — for plan generation we want direct
      // JSON output, not reasoning chains or tool calls.
      thinkingLevel: 'off',
      noTools: 'all',
    });

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
        // 120s timeout with cleanup
        setTimeout(() => {
          unsubscribe();
          try { session.dispose(); } catch {}
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
    } finally {
      session.dispose();
      try { rmSync(tmpDir, { recursive: true }); } catch {}
    }
  }
}
