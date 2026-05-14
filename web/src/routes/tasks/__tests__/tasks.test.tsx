import { describe, it, expect } from 'vitest';
import { filterTasks, countByStatus, formatDuration, formatCost, formatAge } from '../index.js';
import type { Task } from '../index.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    agentId: 'agent-1',
    status: 'complete',
    type: 'agent',
    description: 'Test task',
    result: null,
    reason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    costEur: 0,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: null,
    ...overrides,
  };
}

// ─── filterTasks ──────────────────────────────────────────────────────────────

describe('filterTasks', () => {
  const tasks: Task[] = [
    makeTask({ id: '1', status: 'running', agentId: 'agent-a' }),
    makeTask({ id: '2', status: 'complete', agentId: 'agent-a' }),
    makeTask({ id: '3', status: 'failed', agentId: 'agent-b' }),
    makeTask({ id: '4', status: 'needs_review', agentId: 'agent-b' }),
  ];

  it('returns all tasks when tab is "all" and no agent filter', () => {
    expect(filterTasks(tasks, 'all', '')).toHaveLength(4);
  });

  it('filters by status tab', () => {
    const result = filterTasks(tasks, 'running', '');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by agentId', () => {
    const result = filterTasks(tasks, 'all', 'agent-b');
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.agentId === 'agent-b')).toBe(true);
  });

  it('combines status tab and agent filter', () => {
    const result = filterTasks(tasks, 'failed', 'agent-b');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('returns empty array when no tasks match', () => {
    expect(filterTasks(tasks, 'blocked', '')).toHaveLength(0);
  });
});

// ─── countByStatus ────────────────────────────────────────────────────────────

describe('countByStatus', () => {
  const tasks: Task[] = [
    makeTask({ status: 'running' }),
    makeTask({ status: 'running' }),
    makeTask({ status: 'complete' }),
    makeTask({ status: 'failed' }),
  ];

  it('counts "all" as total length', () => {
    expect(countByStatus(tasks, 'all')).toBe(4);
  });

  it('counts by specific status', () => {
    expect(countByStatus(tasks, 'running')).toBe(2);
    expect(countByStatus(tasks, 'complete')).toBe(1);
    expect(countByStatus(tasks, 'failed')).toBe(1);
    expect(countByStatus(tasks, 'pending')).toBe(0);
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns — for null', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('returns — for 0', () => {
    expect(formatDuration(0)).toBe('—');
  });

  it('returns ms for < 1000ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('returns seconds for >= 1000ms', () => {
    expect(formatDuration(2300)).toBe('2.3s');
  });
});

// ─── formatCost ───────────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('returns — for 0', () => {
    expect(formatCost(0)).toBe('—');
  });

  it('formats euro with 4 decimals', () => {
    expect(formatCost(0.02)).toBe('€0.0200');
  });

  it('formats larger cost', () => {
    expect(formatCost(1.5)).toBe('€1.5000');
  });
});

// ─── formatAge ────────────────────────────────────────────────────────────────

describe('formatAge', () => {
  it('shows seconds for < 60s', () => {
    const ts = new Date(Date.now() - 30_000).toISOString();
    expect(formatAge(ts)).toBe('30s ago');
  });

  it('shows minutes for < 1h', () => {
    const ts = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(formatAge(ts)).toBe('2m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(formatAge(ts)).toBe('3h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
    expect(formatAge(ts)).toBe('2d ago');
  });
});
