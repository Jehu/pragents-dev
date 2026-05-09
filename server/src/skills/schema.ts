import { z } from 'zod';

/**
 * A single step within an extracted skill template.
 * Each step represents one agent action in the pattern.
 */
export const SkillStep = z.object({
  id: z.string().min(1),
  agent: z.string().optional(),
  prompt: z.string(),
  output: z.string().optional(),
  timeout: z.number().int().positive().optional(),
});

export type SkillStep = z.infer<typeof SkillStep>;

/**
 * A parameter for a skill template — concrete values from sessions
 * are generalized into parameters during LLM extraction.
 */
export const SkillParameter = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'string[]']).default('string'),
  default: z.any().optional(),
});

export type SkillParameter = z.infer<typeof SkillParameter>;

/**
 * An example input/output pair for test-run validation.
 */
export const SkillExample = z.object({
  input: z.record(z.any()),
  expected_output: z.any(),
});

export type SkillExample = z.infer<typeof SkillExample>;

/**
 * Metadata about the extraction run that produced this skill.
 */
export const ExtractionMetadata = z.object({
  source_session_id: z.string().optional(),
  source_agent_id: z.string().optional(),
  extracted_at: z.string().optional(),
  model_used: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ExtractionMetadata = z.infer<typeof ExtractionMetadata>;

/**
 * A skill template extracted from session analysis.
 * Similar in structure to WorkflowDef but focused on
 * repeatable patterns discovered from agent behavior.
 */
export const SkillDef = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  source_session: z.string().optional(),
  source_agent: z.string().optional(),
  extracted_at: z.string().optional(),
  tags: z.array(z.string()).optional(),
  steps: z.array(SkillStep),

  // M5: LLM extraction fields (all optional for backward compat with manually-created skills)
  parameters: z.array(SkillParameter).optional(),
  tools: z.array(z.string()).optional(),
  examples: z.array(SkillExample).optional(),
  scope: z.enum(['company', 'project', 'agent']).optional().default('project'),
  status: z.enum(['draft', 'proposed', 'approved', 'active', 'rejected']).optional().default('draft'),
  version: z.number().int().positive().optional().default(1),
  extraction_metadata: ExtractionMetadata.optional(),
});

export type SkillDef = z.infer<typeof SkillDef>;
