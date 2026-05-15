import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWithinRoot, assertWithinAnyRoot, PathOutOfBoundsError } from '../paths.js';

describe('assertWithinRoot', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paths-test-'));
    mkdirSync(join(root, 'inner'), { recursive: true });
    writeFileSync(join(root, 'inner', 'file.yaml'), 'x', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts a literal nested path under the root', () => {
    const resolved = assertWithinRoot('inner/file.yaml', root);
    expect(resolved).toBe(join(root, 'inner', 'file.yaml'));
  });

  it('rejects literal ../../etc/passwd', () => {
    expect(() => assertWithinRoot('../../etc/passwd', root)).toThrow(PathOutOfBoundsError);
  });

  it('rejects URL-encoded traversal (%2e%2e%2f)', () => {
    expect(() => assertWithinRoot('%2e%2e%2fetc%2fpasswd', root)).toThrow(PathOutOfBoundsError);
  });

  it('rejects double-encoded traversal (%252e%252e%252f → %2e%2e%2f → ../)', () => {
    expect(() => assertWithinRoot('%252e%252e%252fetc%252fpasswd', root)).toThrow(
      PathOutOfBoundsError,
    );
  });

  it('rejects absolute paths that escape the root', () => {
    expect(() => assertWithinRoot('/etc/passwd', root)).toThrow(PathOutOfBoundsError);
  });

  it('accepts the root itself', () => {
    expect(() => assertWithinRoot('.', root)).not.toThrow();
  });

  it('PathOutOfBoundsError carries input, resolvedPath, and rootDir', () => {
    try {
      assertWithinRoot('../escape', root);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PathOutOfBoundsError);
      const e = err as PathOutOfBoundsError;
      expect(e.input).toBe('../escape');
      expect(e.rootDir).toBe(root);
      expect(e.resolvedPath.startsWith(root)).toBe(false);
    }
  });

  it('honours followSymlinks=true and rejects escapes via symlink', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 's', 'utf8');
      symlinkSync(outside, join(root, 'link-out'));
      expect(() =>
        assertWithinRoot('link-out/secret.txt', root, { followSymlinks: true }),
      ).toThrow(PathOutOfBoundsError);
      // Without followSymlinks, the resolved path is link-out/secret.txt which
      // is *lexically* under root — the safer mode is followSymlinks: true.
      expect(() => assertWithinRoot('link-out/secret.txt', root)).not.toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips decoding when decodeUrl=false (caller wants literal % handling)', () => {
    expect(() => assertWithinRoot('%2e%2e', root, { decodeUrl: false })).not.toThrow();
  });
});

describe('assertWithinAnyRoot', () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    rootA = mkdtempSync(join(tmpdir(), 'roots-a-'));
    rootB = mkdtempSync(join(tmpdir(), 'roots-b-'));
    writeFileSync(join(rootA, 'a.yaml'), 'a', 'utf8');
    writeFileSync(join(rootB, 'b.yaml'), 'b', 'utf8');
  });

  afterEach(() => {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  it('accepts paths under either root (returns the first matching resolution)', () => {
    expect(assertWithinAnyRoot('a.yaml', [rootA, rootB])).toBe(join(rootA, 'a.yaml'));
    expect(assertWithinAnyRoot('a.yaml', [rootB, rootA])).toBe(join(rootB, 'a.yaml'));
  });

  it('throws when no root accepts the input', () => {
    expect(() => assertWithinAnyRoot('../etc/passwd', [rootA, rootB])).toThrow(
      PathOutOfBoundsError,
    );
  });
});
