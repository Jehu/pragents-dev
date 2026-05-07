import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb } from '../../db/sqlite.js';
import { SkillExtractor } from '../../skills/extractor.js';
import { SkillRegistry } from '../../skills/registry.js';

describe('SkillExtractor', () => {
  const extractor = new SkillExtractor();

  it('extracts skills from numbered step output', () => {
    const output = `
Here is a plan for the feature:

1. Research the authentication options available
2. Implement the OAuth2 flow with provider configuration
3. Write integration tests for the login flow
4. Deploy to staging and verify the integration
`;

    const skills = extractor.extract(output, 'dev@proj-a', 'sess-1');
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills[0].steps.length).toBe(4);
    expect(skills[0].steps[0].prompt).toContain('Research');
    expect(skills[0].tags).toContain('testing');
    expect(skills[0].source_agent).toBe('dev@proj-a');
  });

  it('extracts skills from bullet-point action items', () => {
    const output = `
Action items for the sprint:
- Create the database migration for users table
- Build the REST API endpoints for user CRUD
- Write unit tests for the user service
`;

    const skills = extractor.extract(output, 'dev@proj-a', 'sess-2');
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills[0].steps.length).toBe(3);
  });

  it('extracts skills from section headers', () => {
    const output = `
## Research Phase
We need to investigate the existing authentication patterns and understand the security requirements.

## Implementation Phase
Build the core authentication middleware and session management logic.

## Testing Phase
Write comprehensive tests covering all auth flows including edge cases.
`;

    const skills = extractor.extract(output, 'dev@proj-a', 'sess-3');
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills[0].steps.length).toBe(3);
  });

  it('returns empty for unstructured output', () => {
    const output = 'The task is done. Everything works fine.';
    const skills = extractor.extract(output, 'dev@proj-a', 'sess-4');
    expect(skills).toHaveLength(0);
  });

  it('detects correct agent hints', () => {
    const output = `
1. Research SEO keywords for the landing page
2. Write a compelling blog article about our product
3. Deploy the code to production
`;

    const skills = extractor.extract(output, 'dev@proj-a', 'sess-5');
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills[0].steps[0].agent).toBe('seo');
    expect(skills[0].steps[1].agent).toBe('content');
  });

  it('infers appropriate tags', () => {
    const output = `
1. Write unit tests for the authentication module
2. Debug the failing integration test
3. Review the PR for security issues
`;

    const skills = extractor.extract(output, 'dev@proj-a', 'sess-6');
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills[0].tags).toContain('testing');
    expect(skills[0].tags).toContain('debugging');
  });
});

describe('SkillRegistry', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-skills-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('saves and retrieves a skill', () => {
    const registry = new SkillRegistry(join(tmpDir, 'skills'));
    const skill = {
      name: 'test-skill',
      description: 'A test skill',
      steps: [
        { id: 'step-1', prompt: 'Do something' },
        { id: 'step-2', prompt: 'Do another thing' },
      ],
    };

    registry.save(skill);
    const retrieved = registry.get('test-skill');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('test-skill');
    expect(retrieved!.steps.length).toBe(2);
  });

  it('persists skill as YAML file', () => {
    const skillsDir = join(tmpDir, 'skills-yaml');
    const registry = new SkillRegistry(skillsDir);
    registry.save({
      name: 'yaml-test',
      steps: [{ id: 'step-1', prompt: 'Test step' }],
    });

    expect(existsSync(join(skillsDir, 'yaml-test.yaml'))).toBe(true);
  });

  it('lists all skills', () => {
    const registry = new SkillRegistry(join(tmpDir, 'skills-list'));
    registry.save({ name: 'skill-a', steps: [{ id: 's1', prompt: 'A' }] });
    registry.save({ name: 'skill-b', steps: [{ id: 's1', prompt: 'B' }] });

    const list = registry.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.map((s) => s.name)).toContain('skill-a');
    expect(list.map((s) => s.name)).toContain('skill-b');
  });

  it('deletes a skill', () => {
    const registry = new SkillRegistry(join(tmpDir, 'skills-del'));
    registry.save({ name: 'to-delete', steps: [{ id: 's1', prompt: 'X' }] });
    expect(registry.get('to-delete')).toBeDefined();

    const result = registry.delete('to-delete');
    expect(result).toBe(true);
    expect(registry.get('to-delete')).toBeUndefined();
  });

  it('returns false when deleting non-existent skill', () => {
    const registry = new SkillRegistry(join(tmpDir, 'skills-del2'));
    const result = registry.delete('non-existent');
    expect(result).toBe(false);
  });

  it('finds skills by tag', () => {
    const registry = new SkillRegistry(join(tmpDir, 'skills-tags'));
    registry.save({ name: 'tagged-skill', tags: ['testing', 'ci'], steps: [{ id: 's1', prompt: 'Test' }] });
    registry.save({ name: 'other-skill', tags: ['documentation'], steps: [{ id: 's1', prompt: 'Doc' }] });

    const found = registry.findByTags(['testing']);
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('tagged-skill');
  });

  it('loads skills from YAML files', () => {
    const registry = new SkillRegistry(join(tmpDir, 'skills-load'));
    registry.save({ name: 'load-test', description: 'Loaded skill', steps: [{ id: 's1', prompt: 'Test' }] });

    // Create a new registry instance to verify loading
    const registry2 = new SkillRegistry(join(tmpDir, 'skills-load'));
    const { loaded } = registry2.load();
    expect(loaded).toContain('load-test');
    expect(registry2.get('load-test')).toBeDefined();
  });
});
