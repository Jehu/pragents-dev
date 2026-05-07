import { describe, it, expect } from 'vitest';
import { SkillRouter } from '../../routing/router.js';
import type { ResolvedAgent } from '../../config/schema.js';

function agent(id: string, type: string, skills: string[], projectId = 'proj-a'): ResolvedAgent {
  return { id, projectId, type: type as any, model: 'test', personality: '', memory: {}, skills, projectDir: '/tmp', tokenBudget: 40000 };
}

describe('SkillRouter', () => {
  const agents = [
    agent('dev@proj-a', 'dev', ['typescript', 'react', 'testing']),
    agent('seo@proj-a', 'seo', ['keyword-research', 'technical-seo']),
    agent('dev@proj-b', 'dev', ['python', 'django'], 'proj-b'),
  ];

  it('routes by keyword match', async () => {
    const router = new SkillRouter(agents);
    const result = await router.resolveAgent('Fix TypeScript type error', 'proj-a');
    expect(result).toBe('dev@proj-a');
  });

  it('routes SEO tasks correctly', async () => {
    const router = new SkillRouter(agents);
    const result = await router.resolveAgent('Optimize meta tags for SEO', 'proj-a');
    expect(result).toBe('seo@proj-a');
  });

  it('boost preferred skills', async () => {
    const router = new SkillRouter(agents);
    // Both dev and seo might match, but prefer SEO
    const result = await router.resolveAgent('research keywords for SEO', 'proj-a', ['keyword-research']);
    expect(result).toBe('seo@proj-a');
  });

  it('scopes to project', async () => {
    const router = new SkillRouter(agents);
    const result = await router.resolveAgent('Write Python code', 'proj-b');
    expect(result).toBe('dev@proj-b');
  });

  it('falls back to first agent on no match', async () => {
    const router = new SkillRouter(agents);
    const result = await router.resolveAgent('do something random', 'proj-a');
    expect(result).toBeDefined();
    expect(['dev@proj-a', 'seo@proj-a']).toContain(result);
  });
});
