import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * Tests for the LLM extraction schema and prompt format.
 * The actual extract() method requires pi SDK integration and is tested at integration level.
 */

// This mirrors the updated LLMSkillProposal schema
const UpdatedLLMSkillProposalSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
  body: z.string().optional(),
  tools: z.array(z.string()).optional(),
  parameters: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'string[]']).default('string'),
        default: z.any().optional(),
      }),
    )
    .optional(),
  examples: z
    .array(
      z.object({
        input: z.record(z.any()),
        expected_output: z.any(),
        expected_output_format: z.string().optional(),
      }),
    )
    .optional(),
  scope: z.enum(['company', 'project', 'agent']).optional().default('project'),
  confidence: z.number().min(0).max(1).optional(),
});

describe('LLMSkillProposalSchema (updated for SKILL.md)', () => {
  it('accepts a proposal with body instead of steps', () => {
    const result = UpdatedLLMSkillProposalSchema.safeParse({
      name: 'seo-keyword-research',
      description: 'SEO keyword analysis for ecommerce.',
      tags: ['seo'],
      body: '# SEO Keyword Research\n\n## Setup\nnpm install\n\n## Steps\n1. Analyze\n2. Report',
      tools: ['Bash', 'Read'],
      parameters: [
        { name: 'product_category', description: 'Category', type: 'string' },
      ],
      examples: [
        {
          input: { product_category: 'Shoes' },
          expected_output: { keywords: 50 },
          expected_output_format: 'csv',
        },
      ],
      scope: 'project',
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('seo-keyword-research');
      expect(result.data.body).toContain('# SEO Keyword Research');
    }
  });

  it('requires description', () => {
    const result = UpdatedLLMSkillProposalSchema.safeParse({
      name: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts minimal proposal (no body)', () => {
    const result = UpdatedLLMSkillProposalSchema.safeParse({
      name: 'minimal',
      description: 'A minimal skill',
    });
    expect(result.success).toBe(true);
  });

  it('accepts no-pattern proposal', () => {
    const result = UpdatedLLMSkillProposalSchema.safeParse({
      name: 'no-pattern',
      description: 'No extractable pattern found',
      confidence: 0.0,
    });
    expect(result.success).toBe(true);
  });
});
