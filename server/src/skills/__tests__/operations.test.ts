import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SkillOperations,
  SkillNotFoundError,
} from '../operations.js';
import { EtagMismatchError, computeEtag } from '../../config/yaml-rw.js';

const QUARANTINED_SKILL = `---
name: deploy-helper
description: Helper for deploying releases
x-pragents-status: proposed
x-pragents-extraction:
  source: extracted
  confidence: 0.85
---
Use me to ship.
`;

const ACTIVE_SKILL = `---
name: write-readme
description: Bootstraps a README
x-pragents-status: active
---
Run me to scaffold a README.
`;

describe('SkillOperations', () => {
  let root: string;
  let ops: SkillOperations;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skill-ops-'));
    mkdirSync(join(root, '_quarantine', 'deploy-helper'), { recursive: true });
    writeFileSync(
      join(root, '_quarantine', 'deploy-helper', 'SKILL.md'),
      QUARANTINED_SKILL,
      'utf8',
    );
    mkdirSync(join(root, 'write-readme'), { recursive: true });
    writeFileSync(join(root, 'write-readme', 'SKILL.md'), ACTIVE_SKILL, 'utf8');
    ops = new SkillOperations({ skillsRoot: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('listQuarantined', () => {
    it('returns parsed quarantined skills with etag + body', () => {
      const list = ops.listQuarantined();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('deploy-helper');
      expect(list[0].frontmatter['x-pragents-status']).toBe('proposed');
      expect(list[0].body).toContain('Use me to ship.');
      expect(list[0].etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
    });

    it('returns an empty array when _quarantine does not exist', () => {
      rmSync(join(root, '_quarantine'), { recursive: true, force: true });
      expect(ops.listQuarantined()).toEqual([]);
    });
  });

  describe('getQuarantined', () => {
    it('returns the parsed quarantined skill', () => {
      const skill = ops.getQuarantined('deploy-helper');
      expect(skill.name).toBe('deploy-helper');
      expect(skill.frontmatter.description).toBe('Helper for deploying releases');
    });

    it('throws SkillNotFoundError when missing', () => {
      expect(() => ops.getQuarantined('does-not-exist')).toThrow(SkillNotFoundError);
    });

    it('rejects path-traversal names', () => {
      expect(() => ops.getQuarantined('../../etc/passwd')).toThrow(/Invalid skill name/);
    });
  });

  describe('getActive', () => {
    it('returns active skills', () => {
      const skill = ops.getActive('write-readme');
      expect(skill.frontmatter['x-pragents-status']).toBe('active');
    });

    it('throws SkillNotFoundError for unknown names', () => {
      expect(() => ops.getActive('missing')).toThrow(SkillNotFoundError);
    });
  });

  describe('updateSkill', () => {
    it('updates a quarantined skill body and returns the new etag', () => {
      const before = ops.getQuarantined('deploy-helper');
      const result = ops.updateSkill('deploy-helper', 'quarantine', {
        frontmatter: before.frontmatter,
        body: 'Updated body',
      });
      expect(result.body.trim()).toBe('Updated body');
      expect(result.etag).not.toBe(before.etag);
    });

    it('honors If-Match and throws EtagMismatchError on stale etag', () => {
      const before = ops.getQuarantined('deploy-helper');
      writeFileSync(
        join(root, '_quarantine', 'deploy-helper', 'SKILL.md'),
        QUARANTINED_SKILL + '\nedited\n',
        'utf8',
      );
      expect(() =>
        ops.updateSkill(
          'deploy-helper',
          'quarantine',
          { frontmatter: before.frontmatter, body: 'noop' },
          { ifMatch: before.etag },
        ),
      ).toThrow(EtagMismatchError);
    });

    it('refuses to rename a skill via update', () => {
      const before = ops.getQuarantined('deploy-helper');
      expect(() =>
        ops.updateSkill('deploy-helper', 'quarantine', {
          frontmatter: { ...before.frontmatter, name: 'renamed' },
          body: before.body,
        }),
      ).toThrow(/does not match/);
    });

    it('throws SkillNotFoundError when bucket is wrong', () => {
      expect(() =>
        ops.updateSkill('deploy-helper', 'active', {
          frontmatter: ops.getQuarantined('deploy-helper').frontmatter,
          body: 'x',
        }),
      ).toThrow(SkillNotFoundError);
    });
  });

  describe('approveQuarantined', () => {
    it('moves the skill from _quarantine to the active root and flips status', () => {
      const beforeQuarantine = ops.getQuarantined('deploy-helper');
      // The promote callback simulates the registry's promoteFromQuarantine —
      // tests don't need the full registry to verify operations behavior.
      const promote = (name: string) => {
        const src = join(root, '_quarantine', name, 'SKILL.md');
        const destDir = join(root, name);
        mkdirSync(destDir, { recursive: true });
        const dest = join(destDir, 'SKILL.md');
        const content = readFileSync(src, 'utf8');
        writeFileSync(dest, content, 'utf8');
        rmSync(join(root, '_quarantine', name), { recursive: true, force: true });
        return destDir;
      };
      const result = ops.approveQuarantined('deploy-helper', promote, {
        ifMatch: beforeQuarantine.etag,
      });
      expect(existsSync(join(root, '_quarantine', 'deploy-helper'))).toBe(false);
      expect(existsSync(join(root, 'deploy-helper', 'SKILL.md'))).toBe(true);
      expect(result.frontmatter['x-pragents-status']).toBe('active');
    });

    it('returns SkillNotFoundError when source missing', () => {
      expect(() => ops.approveQuarantined('missing', () => null)).toThrow(SkillNotFoundError);
    });

    it('throws when If-Match does not match', () => {
      const before = ops.getQuarantined('deploy-helper');
      writeFileSync(
        join(root, '_quarantine', 'deploy-helper', 'SKILL.md'),
        QUARANTINED_SKILL + '\nedited\n',
        'utf8',
      );
      expect(() =>
        ops.approveQuarantined('deploy-helper', () => null, { ifMatch: before.etag }),
      ).toThrow(EtagMismatchError);
    });
  });

  describe('rejectQuarantined', () => {
    it('flips status to rejected and keeps the file', () => {
      const result = ops.rejectQuarantined('deploy-helper');
      expect(existsSync(join(root, '_quarantine', 'deploy-helper', 'SKILL.md'))).toBe(true);
      expect(result.frontmatter['x-pragents-status']).toBe('rejected');
    });

    it('throws SkillNotFoundError when missing', () => {
      expect(() => ops.rejectQuarantined('missing')).toThrow(SkillNotFoundError);
    });

    it('honors If-Match', () => {
      const before = ops.getQuarantined('deploy-helper');
      writeFileSync(
        join(root, '_quarantine', 'deploy-helper', 'SKILL.md'),
        QUARANTINED_SKILL + '\nedited\n',
        'utf8',
      );
      expect(() => ops.rejectQuarantined('deploy-helper', { ifMatch: before.etag })).toThrow(
        EtagMismatchError,
      );
    });
  });

  describe('etag stability', () => {
    it('listQuarantined etag matches a fresh getQuarantined etag', () => {
      const list = ops.listQuarantined();
      const fetched = ops.getQuarantined('deploy-helper');
      expect(list[0].etag).toBe(fetched.etag);
    });

    it('etag matches computeEtag of file content', () => {
      const skill = ops.getQuarantined('deploy-helper');
      const raw = readFileSync(join(root, '_quarantine', 'deploy-helper', 'SKILL.md'), 'utf8');
      expect(skill.etag).toBe(computeEtag(raw));
    });
  });
});
