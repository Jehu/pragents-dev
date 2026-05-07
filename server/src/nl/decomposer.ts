import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { z } from 'zod';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const PlanStepSchema = z.object({
  description: z.string(),
  agentId: z.string(),
  dependsOn: z.number().int().optional(),
});

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

export class NLDecomposer {
  async decompose(prompt: string, agents: ResolvedAgent[]): Promise<Plan> {
    if (agents.length === 0) throw new Error('No agents configured');

    const haikuAgent = agents.find((a) => a.model?.includes('haiku'));
    const model = haikuAgent?.model || agents[0].model || 'claude-sonnet';

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
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: tmpDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory() as any,
      model: model as any,
    });

    try {
      let responseText = '';
      const responsePromise = new Promise<string>((resolve) => {
        session.subscribe((event: any) => {
          if (event.type === 'assistant_message' && event.message?.content) {
            responseText += typeof event.message.content === 'string'
              ? event.message.content
              : event.message.content.map((b: any) => b.text || '').join('');
          }
          if (event.type === 'agent_end') resolve(responseText);
        });
        setTimeout(() => resolve(responseText), 30000);
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
        const retryRaw = await new Promise<string>((resolve) => {
          let rt = '';
          session.subscribe((event: any) => {
            if (event.type === 'assistant_message' && event.message?.content) {
              rt += typeof event.message.content === 'string' ? event.message.content : event.message.content.map((b: any) => b.text || '').join('');
            }
            if (event.type === 'agent_end') resolve(rt);
          });
          setTimeout(() => resolve(rt), 30000);
        });
        const retryMatch = retryRaw.match(/\{[\s\S]*\}/);
        if (!retryMatch) throw new Error('LLM failed to produce valid JSON after retry');
        parsed = JSON.parse(retryMatch[0]);
      }

      const plan = PlanSchema.parse(parsed);
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
