import { describe, it, expect } from 'vitest';
import { PragentsSkillFrontmatter } from '../schema.js';

describe('PragentsSkillFrontmatter', () => {
  describe('minimal valid skill', () => {
    it('accepts name and description only', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Does something useful.',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('name validation', () => {
    it('requires name', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        description: 'Does something.',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name longer than 64 characters', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'a'.repeat(65),
        description: 'Test.',
      });
      expect(result.success).toBe(false);
    });

    it('rejects uppercase characters in name', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'My-Skill',
        description: 'Test.',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name starting with hyphen', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: '-bad-name',
        description: 'Test.',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name ending with hyphen', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'bad-name-',
        description: 'Test.',
      });
      expect(result.success).toBe(false);
    });

    it('rejects consecutive hyphens', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'bad--name',
        description: 'Test.',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid kebab-case name', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'seo-keyword-research',
        description: 'Test.',
      });
      expect(result.success).toBe(true);
    });

    it('accepts name with digits', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'm5-skill-extraction',
        description: 'Test.',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('description validation', () => {
    it('requires description', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty description', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects description longer than 1024 characters', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'x'.repeat(1025),
      });
      expect(result.success).toBe(false);
    });

    it('accepts description at exactly 1024 characters', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'x'.repeat(1024),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('optional agentskills.io standard fields', () => {
    it('accepts license field', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        license: 'MIT',
      });
      expect(result.success).toBe(true);
    });

    it('accepts compatibility field', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        compatibility: 'Requires git, node >= 20',
      });
      expect(result.success).toBe(true);
    });

    it('accepts allowed-tools field', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'allowed-tools': 'Bash(git:*) Read',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('pi-specific fields', () => {
    it('accepts argument-hint', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'argument-hint': '[product categories]',
      });
      expect(result.success).toBe(true);
    });

    it('accepts disable-model-invocation', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'disable-model-invocation': true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('x-pragents-* fields', () => {
    it('accepts x-pragents-scope', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-scope': 'project',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid x-pragents-scope value', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-scope': 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('accepts x-pragents-status', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-status': 'active',
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-version', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-version': 2,
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-tags', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-tags': ['seo', 'keyword-research'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-agent-types', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-agent-types': ['seo', 'pm'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-parameters with typed parameters', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-parameters': [
          {
            name: 'product_categories',
            description: 'Categories to analyze',
            type: 'string[]',
            default: [],
          },
          {
            name: 'max_keywords',
            description: 'Max keywords',
            type: 'number',
            default: 50,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-extraction metadata', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-extraction': {
          source: 'extracted',
          source_session_id: 'session-1',
          source_agent_id: 'agent-1',
          extracted_at: '2026-05-10T00:00:00Z',
          model_used: 'claude-sonnet-4',
          confidence: 0.85,
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-changelog', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-changelog': [
          { version: 2, date: '2026-05-10', change: 'Added parameter' },
          { version: 1, date: '2026-05-01', change: 'Initial' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts x-pragents-examples', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'x-pragents-examples': [
          {
            input: { product_categories: ['Shoes'] },
            expected_output: { keywords: 50 },
            expected_output_format: 'csv',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts unknown fields silently (forward-compat)', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'my-skill',
        description: 'Test.',
        'some-future-field': 'value',
      });
      // Should still parse successfully — unknown fields stripped by zod .passthrough() or .strip()
      // We use .passthrough() here for agentskills.io/pragents forward-compat
      expect(result.success).toBe(true);
    });
  });

  describe('full skill frontmatter', () => {
    it('accepts a complete frontmatter with all fields', () => {
      const result = PragentsSkillFrontmatter.safeParse({
        name: 'seo-keyword-research',
        description: 'Analysiert Keywords für E-Commerce-Produktseiten.',
        license: 'MIT',
        compatibility: 'Requires puppeteer, googleapis',
        'allowed-tools': 'Bash(grep:*) Read',
        'argument-hint': '[product categories]',
        'disable-model-invocation': true,
        'x-pragents-scope': 'project',
        'x-pragents-status': 'active',
        'x-pragents-version': 2,
        'x-pragents-tags': ['seo', 'keyword-research'],
        'x-pragents-agent-types': ['seo', 'pm'],
        'x-pragents-parameters': [
          {
            name: 'product_categories',
            description: 'Produktkategorien',
            type: 'string[]',
            default: [],
          },
        ],
        'x-pragents-extraction': {
          source: 'manual',
        },
        'x-pragents-changelog': [
          { version: 1, date: '2026-05-01', change: 'Initial' },
        ],
        'x-pragents-examples': [
          {
            input: { product_categories: ['Schuhe'] },
            expected_output: { keywords: 50 },
            expected_output_format: 'csv',
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('seo-keyword-research');
        expect(result.data['x-pragents-tags']).toEqual(['seo', 'keyword-research']);
      }
    });
  });
});
