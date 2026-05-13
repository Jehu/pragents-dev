import { describe, it, expect } from 'vitest';
import {
  formatPercent,
  formatInteger,
  formatEscalations,
  relativeTime,
  hasNotes,
} from '../index.js';

// ─── formatPercent ────────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('returns — for null', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('converts rate to percentage string', () => {
    expect(formatPercent(0.9234)).toBe('92.3');
  });

  it('handles 0', () => {
    expect(formatPercent(0)).toBe('0.0');
  });

  it('handles 1.0', () => {
    expect(formatPercent(1.0)).toBe('100.0');
  });
});

// ─── formatInteger ────────────────────────────────────────────────────────────

describe('formatInteger', () => {
  it('returns — for null', () => {
    expect(formatInteger(null)).toBe('—');
  });

  it('formats large number with locale separator', () => {
    // 2450 → "2,450" in en-US; but locale may vary. Just check it's not raw digits blindly
    const result = formatInteger(2450);
    expect(result).toMatch(/2.450|2450/);
  });

  it('formats 0', () => {
    expect(formatInteger(0)).toBe('0');
  });
});

// ─── formatEscalations ────────────────────────────────────────────────────────

describe('formatEscalations', () => {
  it('returns — for null', () => {
    expect(formatEscalations(null)).toBe('—');
  });

  it('returns 2 decimal places', () => {
    expect(formatEscalations(1.5)).toBe('1.50');
    expect(formatEscalations(0)).toBe('0.00');
  });
});

// ─── relativeTime ─────────────────────────────────────────────────────────────

describe('relativeTime', () => {
  it('shows seconds for < 60s', () => {
    const ts = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(ts)).toBe('30s ago');
  });

  it('shows minutes for < 1h', () => {
    const ts = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(relativeTime(ts)).toBe('2m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(relativeTime(ts)).toBe('3h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = new Date(Date.now() - 2 * 86400_000).toISOString();
    expect(relativeTime(ts)).toBe('2d ago');
  });
});

// ─── hasNotes ─────────────────────────────────────────────────────────────────

describe('hasNotes', () => {
  it('returns false for empty object', () => {
    expect(hasNotes({})).toBe(false);
  });

  it('returns false when all values are empty strings', () => {
    expect(hasNotes({ skillSuccessRate: '' })).toBe(false);
  });

  it('returns true when at least one note has content', () => {
    expect(hasNotes({ skillSuccessRate: 'Insufficient data' })).toBe(true);
  });

  it('handles mixed empty and non-empty', () => {
    expect(hasNotes({ a: '', b: 'note' })).toBe(true);
  });
});

// ─── fixture: null metrics ────────────────────────────────────────────────────

describe('null metrics fixture', () => {
  const fixture = {
    skillSuccessRate: null,
    memoryHitRate: null,
    escalationsPerGoalRun: null,
    tokensPerCompletedTask: null,
    windowDays: 7,
    computedAt: new Date(Date.now() - 5_000).toISOString(),
    notes: {
      skillSuccessRate: 'No skill executions in window',
      memoryHitRate: '',
    },
  };

  it('all values render as —', () => {
    expect(formatPercent(fixture.skillSuccessRate)).toBe('—');
    expect(formatPercent(fixture.memoryHitRate)).toBe('—');
    expect(formatEscalations(fixture.escalationsPerGoalRun)).toBe('—');
    expect(formatInteger(fixture.tokensPerCompletedTask)).toBe('—');
  });

  it('hasNotes detects non-empty note', () => {
    expect(hasNotes(fixture.notes)).toBe(true);
  });
});
