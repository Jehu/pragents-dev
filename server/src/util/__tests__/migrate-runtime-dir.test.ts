import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateLegacyRuntimeDir } from '../migrate-runtime-dir.js';

describe('migrateLegacyRuntimeDir', () => {
  let root: string;
  let legacy: string;
  let target: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pragents-migrate-'));
    legacy = join(root, 'legacy');
    target = join(root, 'target');
    mkdirSync(legacy, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies yaml files into an empty target and reports them', () => {
    writeFileSync(join(legacy, 'a.yaml'), 'id: a');
    writeFileSync(join(legacy, 'b.yml'), 'id: b');
    writeFileSync(join(legacy, 'README.md'), 'not yaml');

    const migrated = migrateLegacyRuntimeDir(legacy, target);

    expect(migrated.sort()).toEqual(['a.yaml', 'b.yml']);
    expect(readFileSync(join(target, 'a.yaml'), 'utf8')).toBe('id: a');
    expect(readdirSync(target).sort()).toEqual(['a.yaml', 'b.yml']);
  });

  it('leaves the legacy directory untouched (copy, not move)', () => {
    writeFileSync(join(legacy, 'a.yaml'), 'id: a');
    migrateLegacyRuntimeDir(legacy, target);
    expect(readdirSync(legacy)).toEqual(['a.yaml']);
  });

  it('does nothing when the target already has yaml files', () => {
    writeFileSync(join(legacy, 'a.yaml'), 'id: legacy');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'existing.yaml'), 'id: existing');

    const migrated = migrateLegacyRuntimeDir(legacy, target);

    expect(migrated).toEqual([]);
    expect(readdirSync(target)).toEqual(['existing.yaml']);
  });

  it('returns [] when the legacy directory is missing', () => {
    expect(migrateLegacyRuntimeDir(join(root, 'nope'), target)).toEqual([]);
  });

  it('returns [] when the legacy directory has no yaml files', () => {
    writeFileSync(join(legacy, 'notes.txt'), 'x');
    expect(migrateLegacyRuntimeDir(legacy, target)).toEqual([]);
  });
});
