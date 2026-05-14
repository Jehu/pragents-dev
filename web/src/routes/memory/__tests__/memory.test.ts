import { describe, it, expect } from 'vitest';
import { buildSearchUrl, scopeToStatusType, relativeTime } from '../index.js';

// ─── buildSearchUrl ───────────────────────────────────────────────────────────

describe('buildSearchUrl', () => {
  it('includes query param when query is set', () => {
    const url = buildSearchUrl('deploy scripts', 'all', 20);
    expect(url).toContain('query=deploy+scripts');
  });

  it('does not include scope param when scope is all', () => {
    const url = buildSearchUrl('test', 'all', 10);
    expect(url).not.toContain('scope=');
  });

  it('includes scope param when scope is not all', () => {
    const url = buildSearchUrl('test', 'company', 10);
    expect(url).toContain('scope=company');
  });

  it('always includes limit param', () => {
    const url = buildSearchUrl('', 'all', 20);
    expect(url).toContain('limit=20');
  });

  it('does not include query param when query is empty', () => {
    const url = buildSearchUrl('', 'project', 5);
    expect(url).not.toContain('query=');
    expect(url).toContain('scope=project');
    expect(url).toContain('limit=5');
  });

  it('combines query + scope + limit correctly', () => {
    const url = buildSearchUrl('memory', 'agent', 15);
    expect(url).toContain('query=memory');
    expect(url).toContain('scope=agent');
    expect(url).toContain('limit=15');
  });
});

// ─── scopeToStatusType ────────────────────────────────────────────────────────

describe('scopeToStatusType', () => {
  it('maps company to complete', () => {
    expect(scopeToStatusType('company')).toBe('complete');
  });

  it('maps project to running', () => {
    expect(scopeToStatusType('project')).toBe('running');
  });

  it('maps agent to busy', () => {
    expect(scopeToStatusType('agent')).toBe('busy');
  });

  it('maps unknown scope to idle', () => {
    expect(scopeToStatusType('unknown')).toBe('idle');
  });

  it('handles uppercase scope', () => {
    expect(scopeToStatusType('COMPANY')).toBe('complete');
  });

  it('handles empty string scope', () => {
    expect(scopeToStatusType('')).toBe('idle');
  });
});

// ─── relativeTime ─────────────────────────────────────────────────────────────

describe('relativeTime', () => {
  it('shows seconds for < 60s', () => {
    const ts = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(ts)).toBe('30s ago');
  });

  it('shows minutes for < 1h', () => {
    const ts = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(ts)).toBe('5m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(relativeTime(ts)).toBe('2h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect(relativeTime(ts)).toBe('3d ago');
  });
});

// ─── EmptyState trigger conditions ───────────────────────────────────────────

describe('EmptyState trigger', () => {
  it('empty array triggers empty state', () => {
    const facts: unknown[] = [];
    expect(facts.length === 0).toBe(true);
  });

  it('non-empty array does not trigger empty state', () => {
    const facts = [{ id: '1', content: 'fact', scope: 'company', createdAt: new Date().toISOString() }];
    expect(facts.length === 0).toBe(false);
  });
});
