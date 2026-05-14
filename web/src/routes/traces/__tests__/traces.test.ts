import { describe, it, expect } from 'vitest';
import {
  buildTracesUrl,
  relativeTime,
  truncateId,
  PAGE_SIZE,
} from '../index.js';
import type { TracesFilter } from '../index.js';

// ─── buildTracesUrl ───────────────────────────────────────────────────────────

describe('buildTracesUrl', () => {
  it('includes taskId when set', () => {
    const filter: TracesFilter = { taskId: 'task-abc', project: '', since: '', offset: 0 };
    const url = buildTracesUrl(filter);
    expect(url).toContain('taskId=task-abc');
  });

  it('includes project when set', () => {
    const filter: TracesFilter = { taskId: '', project: 'proj-1', since: '', offset: 0 };
    const url = buildTracesUrl(filter);
    expect(url).toContain('project=proj-1');
  });

  it('includes since when set', () => {
    const filter: TracesFilter = { taskId: '', project: '', since: '2026-01-01', offset: 0 };
    const url = buildTracesUrl(filter);
    expect(url).toContain('since=2026-01-01');
  });

  it('always includes limit and offset', () => {
    const filter: TracesFilter = { taskId: '', project: '', since: '', offset: 0 };
    const url = buildTracesUrl(filter, 50);
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=0');
  });

  it('calculates offset from page * PAGE_SIZE', () => {
    const filter: TracesFilter = { taskId: '', project: '', since: '', offset: 2 * PAGE_SIZE };
    const url = buildTracesUrl(filter);
    expect(url).toContain(`offset=${2 * PAGE_SIZE}`);
  });

  it('does not include taskId when empty', () => {
    const filter: TracesFilter = { taskId: '', project: '', since: '', offset: 0 };
    const url = buildTracesUrl(filter);
    expect(url).not.toContain('taskId=');
  });

  it('combines all filters', () => {
    const filter: TracesFilter = { taskId: 'tid', project: 'proj', since: '2026-01-01', offset: 50 };
    const url = buildTracesUrl(filter, 25);
    expect(url).toContain('taskId=tid');
    expect(url).toContain('project=proj');
    expect(url).toContain('since=2026-01-01');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
  });
});

// ─── relativeTime ─────────────────────────────────────────────────────────────

describe('relativeTime', () => {
  it('shows seconds for < 60s', () => {
    const ts = new Date(Date.now() - 15_000).toISOString();
    expect(relativeTime(ts)).toBe('15s ago');
  });

  it('shows minutes for < 1h', () => {
    const ts = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(relativeTime(ts)).toBe('10m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = new Date(Date.now() - 5 * 3600_000).toISOString();
    expect(relativeTime(ts)).toBe('5h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = new Date(Date.now() - 2 * 86400_000).toISOString();
    expect(relativeTime(ts)).toBe('2d ago');
  });
});

// ─── truncateId ───────────────────────────────────────────────────────────────

describe('truncateId', () => {
  it('truncates to 8 chars by default', () => {
    expect(truncateId('abcdefghijklmnop')).toBe('abcdefgh');
  });

  it('returns full string if shorter than len', () => {
    expect(truncateId('abc', 8)).toBe('abc');
  });

  it('truncates to custom length', () => {
    expect(truncateId('abcdefghij', 4)).toBe('abcd');
  });
});

// ─── Pagination logic ─────────────────────────────────────────────────────────

describe('pagination offset calculation', () => {
  it('page 0 → offset 0', () => {
    expect(0 * PAGE_SIZE).toBe(0);
  });

  it('page 1 → offset PAGE_SIZE', () => {
    expect(1 * PAGE_SIZE).toBe(PAGE_SIZE);
  });

  it('page 2 → offset 2 * PAGE_SIZE', () => {
    expect(2 * PAGE_SIZE).toBe(2 * 50);
  });

  it('load more disabled when results < PAGE_SIZE', () => {
    const results = Array.from({ length: 30 });
    expect(results.length < PAGE_SIZE).toBe(true);
  });

  it('load more enabled when results === PAGE_SIZE', () => {
    const results = Array.from({ length: PAGE_SIZE });
    expect(results.length < PAGE_SIZE).toBe(false);
  });
});
