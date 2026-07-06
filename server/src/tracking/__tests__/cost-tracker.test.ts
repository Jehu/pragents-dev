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

  it('getAgentCost sums lifetime usage without a since filter', () => {
    tracker.record({ projectId: 'p1', agentId: 'budget-agent', model: 'claude-sonnet', tokensIn: 100, tokensOut: 50 });
    tracker.record({ projectId: 'p1', agentId: 'budget-agent', model: 'claude-sonnet', tokensIn: 200, tokensOut: 100 });

    const result = tracker.getAgentCost('budget-agent');
    expect(result.tokensIn).toBe(300);
    expect(result.tokensOut).toBe(150);
    expect(result.calls).toBe(2);
  });

  it('getAgentCost with a future since filter excludes all existing usage', () => {
    const future = '2099-01-01T00:00:00.000Z';
    const result = tracker.getAgentCost('budget-agent', future);
    expect(result.calls).toBe(0);
    expect(result.tokensIn).toBe(0);
  });

  it('getBudgetWindowStart defaults to the start of the current calendar month', () => {
    const windowStart = tracker.getBudgetWindowStart('fresh-agent');
    const expected = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    expect(windowStart).toBe(expected);
  });

  it('resetAgentBudget pulls the window start forward to now', () => {
    const before = tracker.getBudgetWindowStart('reset-agent');
    tracker.resetAgentBudget('reset-agent');
    const after = tracker.getBudgetWindowStart('reset-agent');
    expect(after >= before).toBe(true);
    expect(after > before || after === before).toBe(true);
    // The reset timestamp should be a valid, recent ISO string
    expect(new Date(after).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('resetAgentBudget is idempotent per agent (upsert, not duplicate rows)', () => {
    tracker.resetAgentBudget('reset-agent');
    tracker.resetAgentBudget('reset-agent');
    expect(() => tracker.getBudgetWindowStart('reset-agent')).not.toThrow();
  });

  it('getAgentBudgetStatus reports locked:false when usage is below budget', () => {
    tracker.record({ projectId: 'p1', agentId: 'under-budget', model: 'claude-sonnet', tokensIn: 100, tokensOut: 100 });
    const status = tracker.getAgentBudgetStatus('under-budget', 1000);
    expect(status.used).toBe(200);
    expect(status.budget).toBe(1000);
    expect(status.remaining).toBe(800);
    expect(status.locked).toBe(false);
  });

  it('getAgentBudgetStatus reports locked:true once usage reaches the budget', () => {
    tracker.record({ projectId: 'p1', agentId: 'over-budget', model: 'claude-sonnet', tokensIn: 600, tokensOut: 500 });
    const status = tracker.getAgentBudgetStatus('over-budget', 1000);
    expect(status.used).toBe(1100);
    expect(status.remaining).toBe(0);
    expect(status.percentUsed).toBe(100);
    expect(status.locked).toBe(true);
  });

  it('resetAgentBudget unblocks an agent locked by prior usage', () => {
    tracker.record({ projectId: 'p1', agentId: 'locked-agent', model: 'claude-sonnet', tokensIn: 1000, tokensOut: 0 });
    expect(tracker.getAgentBudgetStatus('locked-agent', 1000).locked).toBe(true);

    tracker.resetAgentBudget('locked-agent');

    const status = tracker.getAgentBudgetStatus('locked-agent', 1000);
    expect(status.used).toBe(0);
    expect(status.locked).toBe(false);
  });
});
