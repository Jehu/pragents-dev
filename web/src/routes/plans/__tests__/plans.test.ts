import { describe, it, expect } from 'vitest';
import {
  filterByPlanStatus,
  countByPlanStatus,
  relativeTimeMs,
  toPlanStatusPill,
  type Plan,
  type PlanStatusTab,
} from '../index.js';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    prompt: 'Test plan',
    status: 'draft',
    origin: 'nl',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── filterByPlanStatus ───────────────────────────────────────────────────────

describe('filterByPlanStatus', () => {
  const plans: Plan[] = [
    makePlan({ id: '1', status: 'draft', origin: 'nl' }),
    makePlan({ id: '2', status: 'running', origin: 'chat' }),
    makePlan({ id: '3', status: 'done', origin: 'nl' }),
    makePlan({ id: '4', status: 'failed', origin: 'chat' }),
    makePlan({ id: '5', status: 'cancelled', origin: 'nl' }),
  ];

  it('returns all plans for tab "all" and origin "all"', () => {
    expect(filterByPlanStatus(plans, 'all', 'all')).toHaveLength(5);
  });

  it('filters by status tab', () => {
    expect(filterByPlanStatus(plans, 'draft', 'all')).toHaveLength(1);
    expect(filterByPlanStatus(plans, 'running', 'all')).toHaveLength(1);
    expect(filterByPlanStatus(plans, 'done', 'all')).toHaveLength(1);
    expect(filterByPlanStatus(plans, 'failed', 'all')).toHaveLength(1);
    expect(filterByPlanStatus(plans, 'cancelled', 'all')).toHaveLength(1);
  });

  it('filters by origin', () => {
    expect(filterByPlanStatus(plans, 'all', 'nl')).toHaveLength(3);
    expect(filterByPlanStatus(plans, 'all', 'chat')).toHaveLength(2);
  });

  it('combines status and origin filter', () => {
    expect(filterByPlanStatus(plans, 'draft', 'nl')).toHaveLength(1);
    expect(filterByPlanStatus(plans, 'draft', 'chat')).toHaveLength(0);
  });

  it('returns empty array when no match', () => {
    expect(filterByPlanStatus(plans, 'running', 'nl')).toHaveLength(0);
  });
});

// ─── countByPlanStatus ────────────────────────────────────────────────────────

describe('countByPlanStatus', () => {
  const plans: Plan[] = [
    makePlan({ status: 'draft' }),
    makePlan({ status: 'draft' }),
    makePlan({ status: 'running' }),
    makePlan({ status: 'done' }),
    makePlan({ status: 'failed' }),
  ];

  it('counts "all" as total', () => {
    expect(countByPlanStatus(plans, 'all')).toBe(5);
  });

  it('counts by specific status', () => {
    expect(countByPlanStatus(plans, 'draft')).toBe(2);
    expect(countByPlanStatus(plans, 'running')).toBe(1);
    expect(countByPlanStatus(plans, 'done')).toBe(1);
    expect(countByPlanStatus(plans, 'failed')).toBe(1);
    expect(countByPlanStatus(plans, 'cancelled')).toBe(0);
  });
});

// ─── toPlanStatusPill ─────────────────────────────────────────────────────────

describe('toPlanStatusPill', () => {
  it('maps draft to proposed', () => {
    expect(toPlanStatusPill('draft')).toBe('proposed');
  });

  it('maps running to running', () => {
    expect(toPlanStatusPill('running')).toBe('running');
  });

  it('maps done to complete', () => {
    expect(toPlanStatusPill('done')).toBe('complete');
  });

  it('maps failed to failed', () => {
    expect(toPlanStatusPill('failed')).toBe('failed');
  });

  it('maps cancelled to cold', () => {
    expect(toPlanStatusPill('cancelled')).toBe('cold');
  });

  it('falls back to idle for unknown', () => {
    expect(toPlanStatusPill('unknown-status')).toBe('idle');
  });
});

// ─── relativeTimeMs ───────────────────────────────────────────────────────────

describe('relativeTimeMs (plans)', () => {
  it('shows seconds for < 60s', () => {
    expect(relativeTimeMs(Date.now() - 45_000)).toBe('45s ago');
  });

  it('shows minutes for < 1h', () => {
    expect(relativeTimeMs(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('shows hours for < 24h', () => {
    expect(relativeTimeMs(Date.now() - 2 * 3_600_000)).toBe('2h ago');
  });

  it('shows days', () => {
    expect(relativeTimeMs(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });
});
