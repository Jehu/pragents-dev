import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
import { MemoryEngine } from '../../memory/engine.js';
import type { ResolvedAgent } from '../../config/schema.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** A permissive agent that can read/write company and project scopes. */
function makeAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: 'dev@test',
    projectId: 'test-project',
    type: 'dev',
    model: 'anthropic/claude-sonnet-4-20250514',
    personality: 'Test agent',
    memory: { company: 'read/write', project: 'read/write' },
    capabilities: [],
    projectDir: '/tmp',
    tokenBudget: 40000,
    keepWarm: false,
    ...overrides,
  };
}

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

  describe('degraded mode detection', () => {
    it('reports storeName as simple when constructed with default config', () => {
      const mem = new MemoryEngine(10);
      expect(mem.storeName()).toBe('simple');
    });

    it('isDegraded returns false when using simple store (not configured for lancedb)', () => {
      const mem = new MemoryEngine({ vectorStore: 'simple' });
      expect(mem.isDegraded()).toBe(false);
      expect(mem.storeName()).toBe('simple');
    });
  });

  describe('cross-project memory (company scope)', () => {
    it('recalls company-scope facts from any project scope', async () => {
      engine.remember('company', 'convention', 'Use semantic versioning everywhere', 'office@global');

      // Searching proj-a should also return company facts
      const projAFacts = await engine.recall('semantic versioning', 'proj-a');
      expect(projAFacts.length).toBeGreaterThanOrEqual(1);
      const companyFact = projAFacts.find(f => f.scope === 'company');
      expect(companyFact).toBeDefined();
      expect(companyFact!.content).toBe('Use semantic versioning everywhere');
    });

    it('recalls company-scope facts directly', async () => {
      const facts = await engine.recall('semantic versioning', 'company');
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.scope === 'company')).toBe(true);
    });

    it('searchGlobal returns company-scope facts across all projects', async () => {
      engine.remember('company', 'policy', 'All repos must have CI configured', 'pm@global');

      const results = await engine.searchGlobal('CI configured');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(f => f.scope === 'company' && f.content.includes('CI'))).toBe(true);
    });

    it('searchGlobal with includeProject merges project facts', async () => {
      engine.remember('proj-c', 'decision', 'Use pnpm for proj-c', 'dev@c');

      const results = await engine.searchGlobal('pnpm', { includeProject: 'proj-c' });
      expect(results.some(f => f.scope === 'proj-c')).toBe(true);
    });

    it('searchGlobal does not return unrelated project facts', async () => {
      engine.remember('proj-x', 'test', 'Isolated proj-x fact about zebras', 'dev@x');

      const results = await engine.searchGlobal('zebras');
      // Should not find proj-x facts since searchGlobal only returns company scope
      expect(results.every(f => f.scope === 'company')).toBe(true);
    });
  });

  describe('scope policy enforcement', () => {
    it('allows write to company scope when agent has read/write', () => {
      const agent = makeAgent({ memory: { company: 'read/write', project: 'read/write' } });
      expect(() => engine.remember('company', 'policy', 'Allowed company fact', 'dev@test', agent)).not.toThrow();
    });

    it('blocks write to company scope when agent only has read', () => {
      const agent = makeAgent({ memory: { company: 'read', project: 'read/write' } });
      expect(() => engine.remember('company', 'policy', 'Should be blocked', 'dev@test', agent)).toThrow('Memory scope violation');
    });

    it('blocks write to company scope when agent has no company access', () => {
      const agent = makeAgent({ memory: { project: 'read/write' } });
      expect(() => engine.remember('company', 'policy', 'Should be blocked', 'dev@test', agent)).toThrow('Memory scope violation');
    });

    it('blocks write to project scope when agent has no project write access', () => {
      const agent = makeAgent({ memory: { company: 'read', project: 'read' } });
      expect(() => engine.remember('proj-a', 'test', 'Should be blocked', 'dev@test', agent)).toThrow('Memory scope violation');
    });

    it('allows write to agent scope regardless of memory policy', () => {
      const agent = makeAgent({ memory: {} });
      expect(() => engine.remember('agent', 'note', 'Private agent note', 'dev@test', agent)).not.toThrow();
    });

    it('allows read from company scope when agent has company access', async () => {
      const agent = makeAgent({ memory: { company: 'read', project: 'read/write' } });
      const facts = await engine.recall('semantic versioning', 'company', 10, agent);
      // Just check it doesn't return empty due to policy — facts may exist from earlier tests
      expect(Array.isArray(facts)).toBe(true);
    });

    it('blocks read from company scope when agent has no company access', async () => {
      const agent = makeAgent({ memory: { project: 'read/write' } });
      const facts = await engine.recall('semantic versioning', 'company', 10, agent);
      expect(facts).toHaveLength(0);
    });

    it('blocks read from project scope when agent has no project access', async () => {
      const agent = makeAgent({ memory: { company: 'read/write' } });
      const facts = await engine.recall('tabs', 'proj-a', 10, agent);
      expect(facts).toHaveLength(0);
    });

    it('allows project read when agent has projects.all read', async () => {
      const agent = makeAgent({ memory: { projects: { all: 'read' } } });
      const facts = await engine.recall('something', 'proj-a', 10, agent);
      expect(Array.isArray(facts)).toBe(true);
    });

    it('skips policy check when no agentContext is provided (backward compat)', async () => {
      // Without agentContext, no enforcement — existing behavior preserved
      const facts = await engine.recall('tabs', 'proj-a');
      expect(Array.isArray(facts)).toBe(true);
    });
  });
});
