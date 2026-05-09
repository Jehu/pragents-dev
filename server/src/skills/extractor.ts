import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import type { SkillDef } from './schema.js';
import type { AgentSessionManager } from '../agents/manager.js';
import { z } from 'zod';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Zod schema for the JSON the LLM extraction prompt produces.
 * Slightly looser than SkillDef — we validate and then map to SkillDef.
 */
const LLMSkillProposalSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  steps: z.array(z.object({
    id: z.string().optional(),
    agent: z.string().optional(),
    prompt: z.string(),
    output: z.string().optional(),
  })),
  tools: z.array(z.string()).optional(),
  parameters: z.array(z.object({
    name: z.string(),
    description: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'string[]']).optional().default('string'),
    default: z.any().optional(),
  })).optional(),
  examples: z.array(z.object({
    input: z.record(z.any()),
    expected_output: z.any(),
  })).optional(),
  scope: z.enum(['company', 'project', 'agent']).optional().default('project'),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * SkillExtractor analyzes completed agent session traces using an LLM
 * to identify repeatable patterns and extract them as skill templates.
 *
 * Replaces the old regex-based implementation (M1–M4) with the M5
 * LLM pipeline: pattern detection → generalization → prompt distillation
 * → proposal generation.
 */
export class SkillExtractor {
  private sessionMgr: AgentSessionManager;
  private agents: ResolvedAgent[];

  constructor(sessionMgr: AgentSessionManager, agents: ResolvedAgent[]) {
    this.sessionMgr = sessionMgr;
    this.agents = agents;
  }

  /**
   * Extract a skill template from a completed agent session trace.
   *
   * @param sessionId - The session ID whose trace to analyze
   * @returns A SkillDef proposal ready for human review
   * @throws If the session has no persisted messages or extraction fails
   */
  async extract(sessionId: string): Promise<SkillDef> {
    // 1. Load session messages
    const messages = this.sessionMgr.getSessionMessages(sessionId);
    if (!messages || messages.length === 0) {
      throw new Error(`No messages found for session ${sessionId}`);
    }

    // 2. Prepare trace text (truncate large traces for context window)
    const traceText = this.prepareTrace(messages);

    // 3. Select extraction model (cheapest capable, like NLDecomposer)
    const model = this.selectModel();

    // 4. Build the extraction prompt
    const systemPrompt = this.buildExtractionPrompt();
    const userMessage = `Session trace to analyze:\n\n${traceText}`;

    // 5. Isolated pi SDK session (NLDecomposer pattern)
    const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-skill-extract-'));
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
    });

    try {
      // Collect response
      let responseText = '';
      const responsePromise = new Promise<string>((resolve) => {
        const unsubscribe = session.subscribe((event: any) => {
          if (event.type === 'assistant_message' && event.message?.content) {
            const content = event.message.content;
            responseText += typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content.map((b: any) => b.text || '').join('')
                : '';
          }
          if (event.type === 'agent_end') {
            unsubscribe();
            resolve(responseText);
          }
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

      // 6. Parse JSON, with one retry on failure
      const parsed = this.parseWithRetry(raw, userMessage, session);
      const proposal = LLMSkillProposalSchema.parse(parsed);

      // 7. Map to SkillDef
      const skill: SkillDef = {
        name: proposal.name,
        description: proposal.description,
        tags: proposal.tags,
        steps: proposal.steps.map((s, i) => ({
          id: s.id || `step-${i + 1}`,
          agent: s.agent,
          prompt: s.prompt,
          output: s.output,
        })),
        tools: proposal.tools,
        parameters: proposal.parameters?.map((p) => ({
          name: p.name,
          description: p.description,
          type: p.type || 'string',
          default: p.default,
        })),
        examples: proposal.examples,
        scope: proposal.scope || 'project',
        status: 'proposed',
        version: 1,
        extraction_metadata: {
          source_session_id: sessionId,
          extracted_at: new Date().toISOString(),
          model_used: model,
          confidence: proposal.confidence,
        },
      };

      return skill;
    } finally {
      session.dispose();
      try { rmSync(tmpDir, { recursive: true }); } catch {}
    }
  }

  /**
   * Prepare the message trace for the LLM context window.
   * For large traces (>200 messages), keep first 50 and last 50,
   * insert a placeholder for the middle.
   */
  private prepareTrace(messages: any[]): string {
    const MAX_MESSAGES = 200;
    const HEAD_COUNT = 50;
    const TAIL_COUNT = 50;

    if (messages.length <= MAX_MESSAGES) {
      return JSON.stringify(messages, null, 2);
    }

    const head = messages.slice(0, HEAD_COUNT);
    const tail = messages.slice(-TAIL_COUNT);
    const skipped = messages.length - HEAD_COUNT - TAIL_COUNT;

    const placeholder = {
      role: 'system',
      content: `[… ${skipped} messages omitted for brevity — contains intermediate tool calls, corrections, and revisions …]`,
    };

    return JSON.stringify([...head, placeholder, ...tail], null, 2);
  }

  /**
   * Select the extraction model — prefer Haiku (cheapest), fall back to first agent's model.
   */
  private selectModel(): string {
    const haikuAgent = this.agents.find((a) => a.model?.includes('haiku'));
    return haikuAgent?.model || this.agents[0]?.model || 'claude-sonnet';
  }

  /**
   * Build the system prompt that instructs the LLM how to extract a skill.
   */
  private buildExtractionPrompt(): string {
    return `You are a skill extraction specialist. Analyze the following agent session trace and extract a reusable skill template.

A skill is a repeatable workflow pattern: a sequence of agent actions with prompts, detected tools, and parameters that generalize concrete session details.

## Extraction Rules

1. **Pattern Detection**: Identify the sequence of actions the agent performed. Look for structured steps (research, analysis, writing, review, deployment, etc.), tool calls, and output formats.

2. **Generalization**: Replace concrete values from the session with parameters. For example, "Winterjacken" becomes "{product_category}", "https://example.com/page" becomes "{url}". Define each parameter with name, description, type, and default value.

3. **Prompt Distillation**: For each step, extract the most effective prompt — the one that produced the final correct result, not early failed attempts. If the agent corrected itself, use the corrected version.

4. **Tool Detection**: List all tools the agent actually called during the session (not all available tools).

5. **Examples**: If the session includes specific input/output pairs that illustrate the pattern, include them as examples.

6. **Scope**: Recommend a scope: "company" if the pattern applies across all projects, "project" if it's project-specific, "agent" if it's specific to one agent type.

7. **Confidence**: Score your confidence in this extraction (0.0–1.0). High confidence: clear patterns, multiple iterations, well-defined output. Low confidence: ambiguous, single occurrence, unclear structure.

## Output Format

Return ONLY a valid JSON object with this structure — no markdown, no explanation:

{
  "name": "kebab-case-skill-name",
  "description": "What this skill accomplishes",
  "tags": ["tag1", "tag2"],
  "steps": [
    {
      "id": "step-1",
      "agent": "optional-agent-hint",
      "prompt": "The distilled prompt for this step, with {parameters}",
      "output": "optional-output-key"
    }
  ],
  "tools": ["tool_name_1", "tool_name_2"],
  "parameters": [
    {
      "name": "parameter_name",
      "description": "What this parameter represents",
      "type": "string",
      "default": "optional default value"
    }
  ],
  "examples": [
    {
      "input": {"param": "value"},
      "expected_output": {"key": "value"}
    }
  ],
  "scope": "project",
  "confidence": 0.85
}

If no clear pattern is extractable, return:
{"name":"no-pattern","description":"No extractable pattern found","steps":[],"confidence":0.0}`;
  }

  /**
   * Parse JSON from LLM response, with one retry on failure.
   */
  private async parseWithRetry(raw: string, originalPrompt: string, session: any): Promise<any> {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // One retry
      await session.prompt('Invalid JSON. Return ONLY the JSON object specified in the system prompt — no markdown, no explanation, no surrounding text.');

      let retryText = '';
      await new Promise<void>((resolve) => {
        const unsubscribe = session.subscribe((event: any) => {
          if (event.type === 'assistant_message' && event.message?.content) {
            const content = event.message.content;
            retryText += typeof content === 'string'
              ? content
              : Array.isArray(content)
                ? content.map((b: any) => b.text || '').join('')
                : '';
          }
          if (event.type === 'agent_end') {
            unsubscribe();
            resolve();
          }
        });
        setTimeout(() => { unsubscribe(); resolve(); }, 60000);
      });

      const retryMatch = retryText.match(/\{[\s\S]*\}/);
      if (!retryMatch) throw new Error('LLM failed to produce valid JSON after retry');
      return JSON.parse(retryMatch[0]);
    }
  }
}
