import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import type { ResolvedAgent } from '../config/schema.js';
import { PragentsSkillFrontmatter, type PragentsSkillFrontmatter as SkillFM } from './schema.js';
import type { AgentSessionManager } from '../agents/manager.js';
import { getDb } from '../db/sqlite.js';
import { z } from 'zod';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Result of skill extraction: frontmatter + body.
 */
export interface ExtractedSkill {
  frontmatter: SkillFM;
  body: string;
}

/**
 * Zod schema for the JSON the LLM extraction prompt produces.
 * Updated for SKILL.md format: body (markdown) replaces steps.
 */
const LLMSkillProposalSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
  body: z.string().optional(),
  tools: z.array(z.string()).optional(),
  parameters: z.array(z.object({
    name: z.string().min(1),
    description: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'string[]']).default('string'),
    default: z.any().optional(),
  })).optional(),
  examples: z.array(z.object({
    input: z.record(z.any()),
    expected_output: z.any(),
    expected_output_format: z.string().optional(),
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
   * @returns An ExtractedSkill with frontmatter + markdown body
   * @throws If the session has no persisted messages or extraction fails
   */
  async extract(sessionId: string): Promise<ExtractedSkill> {
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
      const parsed = await this.parseWithRetry(raw, userMessage, session);
      const proposal = LLMSkillProposalSchema.parse(parsed);

      // 7. Map to ExtractedSkill (frontmatter + body)
      const now = new Date().toISOString();
      const agentId = this.resolveAgentId(sessionId);
      const agentType = this.resolveAgentType(sessionId);

      const frontmatter: SkillFM = {
        name: proposal.name,
        description: proposal.description,
        'x-pragents-tags': proposal.tags || [],
        'allowed-tools': proposal.tools?.join(' '),
        'x-pragents-parameters': proposal.parameters?.map((p) => ({
          name: p.name,
          description: p.description,
          type: p.type || 'string',
          default: p.default,
        })),
        'x-pragents-examples': proposal.examples?.map((e) => ({
          input: e.input,
          expected_output: e.expected_output,
          expected_output_format: e.expected_output_format,
        })),
        'x-pragents-scope': proposal.scope || 'project',
        'x-pragents-status': 'proposed',
        'x-pragents-version': 1,
        'x-pragents-agent-types': agentType ? [agentType] : [],
        'x-pragents-extraction': {
          source: 'extracted',
          source_session_id: sessionId,
          source_agent_id: agentId,
          extracted_at: now,
          model_used: model,
          confidence: proposal.confidence,
        },
      };

      return {
        frontmatter,
        body: proposal.body || '',
      };
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
   * Resolve the agent ID that produced a session from the sessions table.
   */
  private resolveAgentId(sessionId: string): string | undefined {
    try {
      const db = getDb();
      const row = db.prepare('SELECT agent_id FROM sessions WHERE id = ?').get(sessionId) as { agent_id: string } | undefined;
      return row?.agent_id;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve the agent type from a session's agent ID.
   */
  private resolveAgentType(sessionId: string): string | undefined {
    const agentId = this.resolveAgentId(sessionId);
    if (!agentId) return undefined;
    const agent = this.agents.find((a) => a.id === agentId);
    return agent?.type;
  }

  /**
   * Build the system prompt that instructs the LLM how to extract a skill.
   * Output format: JSON with body (markdown) instead of steps array.
   */
  private buildExtractionPrompt(): string {
    return `You are a skill extraction specialist. Analyze the following agent session trace and extract a reusable skill template.

A skill is a repeatable workflow pattern: a sequence of agent actions with prompts, detected tools, and parameters that generalize concrete session details.

## Extraction Rules

1. **Pattern Detection**: Identify the sequence of actions the agent performed. Look for structured steps (research, analysis, writing, review, deployment, etc.), tool calls, and output formats.

2. **Generalization**: Replace concrete values from the session with parameters. For example, "Winterjacken" becomes "{product_category}", "https://example.com/page" becomes "{url}". Define each parameter with name, description, type, and default value.

3. **Prompt Distillation**: For the body, write clear numbered steps that another agent could follow. Use the most effective prompts from the session — the ones that produced the final correct result, not early failed attempts. If the agent corrected itself, use the corrected version.

4. **Tool Detection**: List all tools the agent actually called during the session (not all available tools).

5. **Examples**: If the session includes specific input/output pairs that illustrate the pattern, include them as examples.

6. **Scope**: Recommend a scope: "company" if the pattern applies across all projects, "project" if it's project-specific, "agent" if it's specific to one agent type.

7. **Confidence**: Score your confidence in this extraction (0.0–1.0). High confidence: clear patterns, multiple iterations, well-defined output. Low confidence: ambiguous, single occurrence, unclear structure.

## Output Format

Return ONLY a valid JSON object with this structure — no markdown, no explanation:

{
  "name": "kebab-case-skill-name",
  "description": "What this skill accomplishes and when to use it",
  "tags": ["tag1", "tag2"],
  "body": "# Skill Title\\n\\n## Setup\\nInstall dependencies with npm install\\n\\n## Steps\\n1. First step with {parameter}\\n2. Second step\\n\\n## Output\\nExpected output format (e.g., CSV, JSON)",
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
      "expected_output": {"key": "value"},
      "expected_output_format": "csv"
    }
  ],
  "scope": "project",
  "confidence": 0.85
}

The "body" field contains the skill instructions as a markdown string with numbered steps, setup instructions, and output format. Use {parameter_name} placeholders in the body.

If no clear pattern is extractable, return:
{"name":"no-pattern","description":"No extractable pattern found","body":"","confidence":0.0}`;
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
      // One retry: subscribe BEFORE prompting to catch all events
      let retryText = '';
      const retryPromise = new Promise<string>((resolve) => {
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
            resolve(retryText);
          }
        });
        setTimeout(() => { unsubscribe(); resolve(retryText || ''); }, 60000);
      });

      await session.prompt('Invalid JSON. Return ONLY the JSON object specified in the system prompt — no markdown, no explanation, no surrounding text.');
      retryText = await retryPromise;

      const retryMatch = retryText.match(/\{[\s\S]*\}/);
      if (!retryMatch) throw new Error('LLM failed to produce valid JSON after retry');
      return JSON.parse(retryMatch[0]);
    }
  }
}
