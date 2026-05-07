import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
import { MemoryEngine } from '../../memory/engine.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('MemoryEngine', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-test-'));
  let engine: MemoryEngine;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    engine = new MemoryEngine(100);
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('remembers and recalls facts', async () => {
    engine.remember('proj-a', 'convention', 'Use tabs not spaces', 'dev@a');
    engine.remember('proj-a', 'decision', 'Use Hono for routing', 'dev@a');
    engine.remember('proj-b', 'convention', 'Use spaces', 'dev@b');

    const aFacts = await engine.recall('tabs', 'proj-a');
    expect(aFacts).toHaveLength(1);
    expect(aFacts[0].content).toBe('Use tabs not spaces');

    const bFacts = await engine.recall('spaces', 'proj-b');
    expect(bFacts).toHaveLength(1);
  });

  it('recall returns empty for non-existent scope', async () => {
    const facts = await engine.recall('nothing', 'non-existent');
    expect(facts).toHaveLength(0);
  });

  it('forgets facts', async () => {
    const fact = engine.remember('proj-a', 'test', 'temporary', 'dev@a');
    const before = await engine.recall('temporary', 'proj-a');
    expect(before).toHaveLength(1);

    await engine.forget(fact.id);
    const after = await engine.recall('temporary', 'proj-a');
    expect(after).toHaveLength(0);
  });

  it('short-term memory respects max entries with priority eviction', () => {
    const smallMem = new MemoryEngine(5);
    for (let i = 0; i < 10; i++) {
      smallMem.append('session-1', { content: `entry-${i}`, priority: 0, timestamp: Date.now() });
    }
    const entries = smallMem.context('session-1');
    expect(entries.length).toBeLessThanOrEqual(5);
  });

  it('compresses short-term to long-term', () => {
    const mem = new MemoryEngine(10);
    mem.append('sess-1', { content: 'event A', priority: 1, timestamp: Date.now() });
    mem.append('sess-1', { content: 'event B', priority: 1, timestamp: Date.now() });

    const summary = mem.compress('sess-1', 'dev@a');
    expect(summary).not.toBeNull();
    expect(summary!.compressedSummary).toContain('event A');
    expect(summary!.compressedSummary).toContain('event B');
    expect(mem.context('sess-1')).toHaveLength(0);
  });
});
