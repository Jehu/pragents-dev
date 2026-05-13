import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry } from '../registry.js';

describe('SkillRegistry (SKILL.md format)', () => {
  let skillsDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), 'pragents-skill-test-'));
    registry = new SkillRegistry(skillsDir);
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  function createSkillMd(dirName: string, frontmatter: string, body: string = '# My Skill\n') {
    const dir = join(skillsDir, dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  }

  describe('load()', () => {
    it('returns empty when skills directory is empty', () => {
      const result = registry.load();
      expect(result.loaded).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('loads a minimal valid skill from SKILL.md', () => {
      createSkillMd('my-skill', 'name: my-skill\ndescription: Does something.');
      const result = registry.load();
      expect(result.loaded).toContain('my-skill');
      expect(registry.get('my-skill')).toBeDefined();
    });

    it('loads multiple skills from separate subdirectories', () => {
      createSkillMd('skill-a', 'name: skill-a\ndescription: First skill.');
      createSkillMd('skill-b', 'name: skill-b\ndescription: Second skill.');
      const result = registry.load();
      expect(result.loaded).toContain('skill-a');
      expect(result.loaded).toContain('skill-b');
      expect(registry.list()).toHaveLength(2);
    });

    it('warns on skill with missing description', () => {
      createSkillMd('bad-skill', 'name: bad-skill');
      const result = registry.load();
      expect(result.loaded).not.toContain('bad-skill');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('warns on skill with invalid YAML', () => {
      const dir = join(skillsDir, 'bad-yaml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), '---\ninvalid: yaml: :\n---\n# Body');
      const result = registry.load();
      expect(result.loaded).not.toContain('bad-yaml');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('loads skill with x-pragents-* fields', () => {
      createSkillMd(
        'seo-skill',
        [
          'name: seo-skill',
          'description: SEO analysis.',
          'x-pragents-scope: company',
          'x-pragents-tags:',
          '  - seo',
          '  - keyword-research',
        ].join('\n'),
      );
      const result = registry.load();
      expect(result.loaded).toContain('seo-skill');
      const skill = registry.get('seo-skill');
      expect(skill).toBeDefined();
      expect(skill!['x-pragents-scope']).toBe('company');
    });

    it('reloads skills on subsequent load() calls', () => {
      createSkillMd('skill-1', 'name: skill-1\ndescription: First.');
      registry.load();
      createSkillMd('skill-2', 'name: skill-2\ndescription: Second.');
      const result = registry.load();
      expect(result.loaded).toContain('skill-1');
      expect(result.loaded).toContain('skill-2');
    });

    it('never loads skills from _quarantine subdirectory (security: U17)', () => {
      createSkillMd('active-skill', 'name: active-skill\ndescription: Active.');
      // Manually place a skill in _quarantine
      const quarantineDir = join(skillsDir, '_quarantine', 'injected-skill');
      mkdirSync(quarantineDir, { recursive: true });
      writeFileSync(
        join(quarantineDir, 'SKILL.md'),
        '---\nname: injected-skill\ndescription: Should not load.\n---\n# Body',
      );
      const result = registry.load();
      expect(result.loaded).toContain('active-skill');
      expect(result.loaded).not.toContain('injected-skill');
      expect(registry.get('injected-skill')).toBeUndefined();
    });
  });

  describe('save()', () => {
    it('creates a skill directory with SKILL.md', () => {
      const frontmatter = {
        name: 'new-skill',
        description: 'A new skill.',
      };
      registry.save(frontmatter);
      const result = registry.load();
      expect(result.loaded).toContain('new-skill');

      const skill = registry.get('new-skill');
      expect(skill).toBeDefined();
      expect(skill!.name).toBe('new-skill');
    });

    it('writes x-pragents-* fields to SKILL.md', () => {
      const frontmatter = {
        name: 'tagged-skill',
        description: 'Skill with tags.',
        'x-pragents-tags': ['seo', 'testing'],
        'x-pragents-scope': 'project' as const,
      };
      registry.save(frontmatter);
      const result = registry.load();
      expect(result.loaded).toContain('tagged-skill');
      const skill = registry.get('tagged-skill');
      expect(skill!['x-pragents-tags']).toEqual(['seo', 'testing']);
    });

    it('updates an existing skill on save', () => {
      const frontmatter = {
        name: 'update-skill',
        description: 'Version 1.',
        'x-pragents-version': 1,
      };
      registry.save(frontmatter);
      registry.save({
        ...frontmatter,
        description: 'Version 2.',
        'x-pragents-version': 2,
      });
      const skill = registry.get('update-skill');
      expect(skill!.description).toBe('Version 2.');
      expect(skill!['x-pragents-version']).toBe(2);
    });

    it('includes body content in SKILL.md', () => {
      const frontmatter = {
        name: 'body-skill',
        description: 'Has body.',
      };
      const body = '# Instructions\n\n1. Do this\n2. Do that';
      registry.save(frontmatter, body);
      registry.load();
      const full = registry.getFullSkill('body-skill');
      expect(full).toBeDefined();
      expect(full!.body.trim()).toBe(body.trim());
    });

    it('preserves body on partial update (approve without body)', () => {
      const frontmatter = {
        name: 'approve-skill',
        description: 'Skill to approve.',
        'x-pragents-status': 'proposed' as const,
      };
      const body = '# Original instructions';
      registry.save(frontmatter, body);
      registry.load();

      // Simulate approve: save with updated status, no body
      const updated = { ...registry.get('approve-skill')!, 'x-pragents-status': 'active' as const };
      registry.save(updated);
      registry.load();

      const full = registry.getFullSkill('approve-skill');
      expect(full).toBeDefined();
      expect(full!.frontmatter['x-pragents-status']).toBe('active');
      expect(full!.body.trim()).toBe(body.trim()); // Body preserved!
    });
  });

  describe('delete()', () => {
    it('removes skill from memory and filesystem', () => {
      createSkillMd('delete-me', 'name: delete-me\ndescription: Temp.');
      registry.load();
      expect(registry.get('delete-me')).toBeDefined();

      const deleted = registry.delete('delete-me');
      expect(deleted).toBe(true);
      expect(registry.get('delete-me')).toBeUndefined();

      // Reload — should not come back
      registry.load();
      expect(registry.get('delete-me')).toBeUndefined();
    });

    it('returns false for non-existent skill', () => {
      const deleted = registry.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('get() and list()', () => {
    it('returns undefined for unknown skill', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('lists all loaded skills', () => {
      createSkillMd('a', 'name: a\ndescription: A.');
      createSkillMd('b', 'name: b\ndescription: B.');
      registry.load();
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.name).sort()).toEqual(['a', 'b']);
    });
  });

  describe('saveToQuarantine()', () => {
    it('writes SKILL.md to _quarantine/<name>/ and returns the path', () => {
      const quarantinePath = registry.saveToQuarantine({
        name: 'quarantine-skill',
        description: 'Pending review.',
      });
      expect(quarantinePath).toContain('_quarantine');
      expect(quarantinePath).toContain('quarantine-skill');
      expect(existsSync(join(quarantinePath, 'SKILL.md'))).toBe(true);
    });

    it('quarantined skills are not loaded by load()', () => {
      registry.saveToQuarantine({
        name: 'quarantined',
        description: 'Should not be active.',
      }, '# Quarantined body');
      const result = registry.load();
      expect(result.loaded).not.toContain('quarantined');
      expect(registry.get('quarantined')).toBeUndefined();
    });
  });

  describe('rejectSkill()', () => {
    it('returns null for unknown skill', () => {
      expect(registry.rejectSkill('nonexistent')).toBeNull();
    });

    it('increments reject count on each call', () => {
      registry.save({ name: 'count-skill', description: 'Reject counting.', 'x-pragents-status': 'active' });

      const r1 = registry.rejectSkill('count-skill');
      expect(r1).not.toBeNull();
      expect(r1!.rejectCount).toBe(1);
      expect(r1!.demoted).toBe(false);

      const r2 = registry.rejectSkill('count-skill');
      expect(r2!.rejectCount).toBe(2);
      expect(r2!.demoted).toBe(false);
    });

    it('demotes skill to proposed after reaching threshold (default 3)', () => {
      registry.save({ name: 'demote-skill', description: 'Will be demoted.', 'x-pragents-status': 'active' });

      registry.rejectSkill('demote-skill');
      registry.rejectSkill('demote-skill');
      const r3 = registry.rejectSkill('demote-skill');

      expect(r3!.rejectCount).toBe(3);
      expect(r3!.demoted).toBe(true);

      const skill = registry.get('demote-skill');
      expect(skill!['x-pragents-status']).toBe('proposed');
    });

    it('demotes at custom threshold', () => {
      registry.save({ name: 'custom-threshold', description: 'Custom threshold.', 'x-pragents-status': 'active' });

      const r1 = registry.rejectSkill('custom-threshold', 2);
      expect(r1!.demoted).toBe(false);

      const r2 = registry.rejectSkill('custom-threshold', 2);
      expect(r2!.demoted).toBe(true);
      expect(registry.get('custom-threshold')!['x-pragents-status']).toBe('proposed');
    });

    it('getRejectCount returns 0 for unknown skill', () => {
      expect(registry.getRejectCount('no-such-skill')).toBe(0);
    });

    it('getRejectCount reflects increments', () => {
      registry.save({ name: 'count-check', description: 'Count check.' });
      expect(registry.getRejectCount('count-check')).toBe(0);
      registry.rejectSkill('count-check');
      expect(registry.getRejectCount('count-check')).toBe(1);
    });

    it('persists demoted status to SKILL.md (survives reload)', () => {
      registry.save({ name: 'persist-demote', description: 'Persists.', 'x-pragents-status': 'active' });

      // Reject 3 times to trigger demotion
      registry.rejectSkill('persist-demote');
      registry.rejectSkill('persist-demote');
      registry.rejectSkill('persist-demote');

      // Reload from disk
      const fresh = new SkillRegistry(skillsDir);
      fresh.load();
      const skill = fresh.get('persist-demote');
      expect(skill).toBeDefined();
      expect(skill!['x-pragents-status']).toBe('proposed');
    });
  });

  describe('findByTags()', () => {
    it('finds skills by x-pragents-tags', () => {
      createSkillMd(
        'seo',
        ['name: seo', 'description: SEO.', 'x-pragents-tags:', '  - seo', '  - marketing'].join('\n'),
      );
      createSkillMd(
        'dev',
        ['name: dev', 'description: Dev.', 'x-pragents-tags:', '  - typescript', '  - react'].join('\n'),
      );
      registry.load();

      const seoSkills = registry.findByTags(['seo']);
      expect(seoSkills).toHaveLength(1);
      expect(seoSkills[0].name).toBe('seo');

      const noneSkills = registry.findByTags(['nonexistent']);
      expect(noneSkills).toHaveLength(0);
    });
  });
});
