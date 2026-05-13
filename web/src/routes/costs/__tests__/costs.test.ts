import { describe, it, expect } from 'vitest';
import {
  formatCostEur,
  formatTokens,
  sortAgentsByCost,
  sortModelsByCost,
  maxCost,
} from '../index.js';
import type { AgentCostRow, ModelCostRow } from '../index.js';

// ─── formatCostEur ────────────────────────────────────────────────────────────

describe('formatCostEur', () => {
  it('returns — for null', () => {
    expect(formatCostEur(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatCostEur(undefined)).toBe('—');
  });

  it('formats cost with euro sign and 4 decimals', () => {
    expect(formatCostEur(0.0123)).toBe('€0.0123');
  });

  it('formats zero', () => {
    expect(formatCostEur(0)).toBe('€0.0000');
  });
});

// ─── formatTokens ─────────────────────────────────────────────────────────────

describe('formatTokens', () => {
  it('returns — for null', () => {
    expect(formatTokens(null)).toBe('—');
  });

  it('formats integer with locale separator', () => {
    const result = formatTokens(12345);
    // Accept both "12,345" and "12345" depending on locale
    expect(result).toMatch(/12.?345/);
  });
});

// ─── sortAgentsByCost ─────────────────────────────────────────────────────────

describe('sortAgentsByCost', () => {
  const agents: AgentCostRow[] = [
    { agentId: 'a', costEur: 0.01, calls: 1, tokensIn: 100, tokensOut: 50 },
    { agentId: 'b', costEur: 0.05, calls: 5, tokensIn: 500, tokensOut: 200 },
    { agentId: 'c', costEur: 0.02, calls: 2, tokensIn: 200, tokensOut: 100 },
  ];

  it('sorts descending by costEur', () => {
    const sorted = sortAgentsByCost(agents);
    expect(sorted[0].agentId).toBe('b');
    expect(sorted[1].agentId).toBe('c');
    expect(sorted[2].agentId).toBe('a');
  });

  it('does not mutate original array', () => {
    const original = [...agents];
    sortAgentsByCost(agents);
    expect(agents).toEqual(original);
  });

  it('handles empty array', () => {
    expect(sortAgentsByCost([])).toEqual([]);
  });
});

// ─── sortModelsByCost ─────────────────────────────────────────────────────────

describe('sortModelsByCost', () => {
  const models: ModelCostRow[] = [
    { model: 'claude-haiku', costEur: 0.001, calls: 10, tokensIn: 1000, tokensOut: 500 },
    { model: 'claude-opus', costEur: 0.05, calls: 5, tokensIn: 500, tokensOut: 300 },
    { model: 'claude-sonnet', costEur: 0.02, calls: 20, tokensIn: 2000, tokensOut: 1000 },
  ];

  it('sorts descending by costEur', () => {
    const sorted = sortModelsByCost(models);
    expect(sorted[0].model).toBe('claude-opus');
    expect(sorted[1].model).toBe('claude-sonnet');
    expect(sorted[2].model).toBe('claude-haiku');
  });

  it('first item is most expensive (badge candidate)', () => {
    const sorted = sortModelsByCost(models);
    expect(sorted[0].model).toBe('claude-opus');
  });
});

// ─── maxCost ──────────────────────────────────────────────────────────────────

describe('maxCost', () => {
  it('returns 0 for empty array', () => {
    expect(maxCost([])).toBe(0);
  });

  it('returns max value', () => {
    const rows = [{ costEur: 0.01 }, { costEur: 0.05 }, { costEur: 0.02 }];
    expect(maxCost(rows)).toBe(0.05);
  });

  it('works with single element', () => {
    expect(maxCost([{ costEur: 0.1 }])).toBe(0.1);
  });
});

// ─── fixture: both tables ─────────────────────────────────────────────────────

describe('agent + model fixture', () => {
  const agentFixture: AgentCostRow[] = [
    { agentId: 'researcher', costEur: 0.12, calls: 30, tokensIn: 10000, tokensOut: 5000 },
    { agentId: 'writer', costEur: 0.08, calls: 20, tokensIn: 8000, tokensOut: 4000 },
  ];

  const modelFixture: ModelCostRow[] = [
    { model: 'claude-sonnet-4-5', costEur: 0.15, calls: 40, tokensIn: 15000, tokensOut: 7000 },
    { model: 'claude-haiku-3', costEur: 0.05, calls: 10, tokensIn: 3000, tokensOut: 1500 },
  ];

  it('agent table sorts correctly', () => {
    const sorted = sortAgentsByCost(agentFixture);
    expect(sorted[0].agentId).toBe('researcher');
  });

  it('model badge targets most expensive', () => {
    const sorted = sortModelsByCost(modelFixture);
    expect(sorted[0].model).toBe('claude-sonnet-4-5');
  });

  it('maxCost used for progress bar scale', () => {
    const sorted = sortAgentsByCost(agentFixture);
    const max = maxCost(sorted);
    expect(max).toBe(0.12);
  });
});
