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
});

export type SkillDef = z.infer<typeof SkillDef>;
