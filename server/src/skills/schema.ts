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
/**
 * agentskills.io-compatible skill frontmatter schema.
 *
 * Standard fields: name, description (required), license, compatibility, allowed-tools (optional).
 * Pi-specific: argument-hint, disable-model-invocation.
 * Pragents extensions: x-pragents-* prefixed fields (ignored by pi and other clients).
 * Uses .passthrough() for forward-compat with unknown fields.
 */
export const PragentsSkillFrontmatter = z.object({
  // === agentskills.io required ===
  name: z
    .string()
    .min(1, 'name is required')
    .max(64, 'name must be at most 64 characters')
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'name must be lowercase letters, digits, and hyphens only; no leading/trailing/consecutive hyphens',
    ),
  description: z
    .string()
    .min(1, 'description is required')
    .max(1024, 'description must be at most 1024 characters'),

  // === agentskills.io optional ===
  license: z.string().optional(),
  compatibility: z.string().max(500, 'compatibility must be at most 500 characters').optional(),
  'allowed-tools': z.string().optional(),

  // === pi-specific ===
  'argument-hint': z.string().optional(),
  'disable-model-invocation': z.boolean().optional(),

  // === pragents extensions (x-pragents-*) ===
  'x-pragents-scope': z.enum(['company', 'project', 'agent']).optional().default('project'),
  'x-pragents-status': z
    .enum(['draft', 'proposed', 'approved', 'active', 'rejected'])
    .optional()
    .default('draft'),
  'x-pragents-version': z.number().int().positive().optional().default(1),
  'x-pragents-tags': z.array(z.string()).optional().default([]),
  'x-pragents-agent-types': z.array(z.string()).optional().default([]),

  'x-pragents-parameters': z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'string[]']).default('string'),
        default: z.any().optional(),
      }),
    )
    .optional(),

  'x-pragents-extraction': z
    .object({
      source: z.enum(['manual', 'extracted']),
      source_session_id: z.string().optional(),
      source_agent_id: z.string().optional(),
      extracted_at: z.string().optional(),
      model_used: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .optional(),

  'x-pragents-changelog': z
    .array(
      z.object({
        version: z.number().int().positive(),
        date: z.string(),
        change: z.string(),
      }),
    )
    .optional(),

  'x-pragents-examples': z
    .array(
      z.object({
        input: z.record(z.any()),
        expected_output: z.any(),
        expected_output_format: z.string().optional(),
      }),
    )
    .optional(),
}).passthrough(); // forward-compat: unknown fields pass through silently

export type PragentsSkillFrontmatter = z.infer<typeof PragentsSkillFrontmatter>;
export type PragentsSkillFrontmatterInput = z.input<typeof PragentsSkillFrontmatter>;

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
