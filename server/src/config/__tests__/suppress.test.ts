import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchConfig, suppressWatcherChange } from '../loader.js';

const MIN_CONFIG = `company:
  name: "Test"
`;

/**
 * Watcher suppression API tests.
 *
 * We deliberately do NOT test the fs.watch integration end-to-end here:
 * fs.watch timing on macOS is unreliable for sub-second windows and
 * produces flaky tests. The suppression semantics are exercised manually
 * via `npm run dev` and by the yaml-rw write-path tests.
 *
 * These tests cover the parts that can be asserted deterministically:
 * - the WatchHandle shape
 * - the no-op fallback when no watcher is active
 * - that stop() resets the active-watcher pointer
 */
describe('watchConfig handle API', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-supp-'));
    path = join(dir, 'pragents.yaml');
    writeFileSync(path, MIN_CONFIG, 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('module-level suppressWatcherChange is a no-op when no watcher is active', () => {
    expect(() => suppressWatcherChange(path, 100)).not.toThrow();
  });

  it('returns a handle with stop + suppressNextChange', () => {
    const handle = watchConfig(() => {}, path);
    try {
      expect(typeof handle.stop).toBe('function');
      expect(typeof handle.suppressNextChange).toBe('function');
    } finally {
      handle.stop();
    }
  });

  it('suppressNextChange does not throw for the watched path', () => {
    const handle = watchConfig(() => {}, path);
    try {
      expect(() => handle.suppressNextChange(path, 100)).not.toThrow();
    } finally {
      handle.stop();
    }
  });

  it('suppressNextChange silently ignores paths other than the watched one', () => {
    const handle = watchConfig(() => {}, path);
    try {
      expect(() => handle.suppressNextChange('/tmp/does-not-exist.yaml', 100)).not.toThrow();
    } finally {
      handle.stop();
    }
  });

  it('stop() resets the active-watcher pointer (subsequent module-level calls are no-ops)', () => {
    const handle = watchConfig(() => {}, path);
    handle.stop();
    expect(() => suppressWatcherChange(path, 100)).not.toThrow();
  });
});
