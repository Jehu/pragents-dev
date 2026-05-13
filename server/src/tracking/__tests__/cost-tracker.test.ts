import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
import { CostTracker } from '../cost-tracker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CostTracker', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-cost-test-'));
  let tracker: CostTracker;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    tracker = new CostTracker({
      'claude-sonnet': { in: 3, out: 15 },
    });
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('getDailyCost returns zero for empty db', () => {
    const result = tracker.getDailyCost();
    expect(result.costEur).toBe(0);
    expect(result.calls).toBe(0);
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getDailyCost returns today totals after recording', () => {
    tracker.record({ projectId: 'p1', agentId: 'a1', model: 'claude-sonnet', tokensIn: 1000, tokensOut: 500 });
    tracker.record({ projectId: 'p1', agentId: 'a1', model: 'claude-sonnet', tokensIn: 2000, tokensOut: 1000 });

    const result = tracker.getDailyCost();
    expect(result.calls).toBe(2);
    expect(result.tokensIn).toBe(3000);
    expect(result.tokensOut).toBe(1500);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('getDailyCost filters by project', () => {
    tracker.record({ projectId: 'p2', agentId: 'a2', model: 'claude-sonnet', tokensIn: 500, tokensOut: 200 });

    const p1Result = tracker.getDailyCost(undefined, 'p1');
    const p2Result = tracker.getDailyCost(undefined, 'p2');
    expect(p1Result.calls).toBe(2);
    expect(p2Result.calls).toBe(1);
  });

  it('getDailyCost with explicit date', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = tracker.getDailyCost(today);
    expect(result.date).toBe(today);
    expect(result.calls).toBeGreaterThanOrEqual(3);
  });

  it('getCostByModel groups correctly', () => {
    const result = tracker.getCostByModel();
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const sonnetItem = result.items.find((i) => i.model === 'claude-sonnet');
    expect(sonnetItem).toBeDefined();
    expect(sonnetItem!.calls).toBeGreaterThanOrEqual(3);
    expect(sonnetItem!.tokensIn).toBeGreaterThan(0);
  });

  it('getCostByModel respects since filter', () => {
    const future = '2099-01-01T00:00:00.000Z';
    const result = tracker.getCostByModel(future);
    expect(result.items).toHaveLength(0);
  });

  it('getCostByModel returns items array', () => {
    const result = tracker.getCostByModel();
    expect(Array.isArray(result.items)).toBe(true);
  });
});
