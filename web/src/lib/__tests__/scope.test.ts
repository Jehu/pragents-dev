import { describe, it, expect } from 'vitest';
import { agentsInScope, eventsInScope } from '../scope.js';

const AGENTS = [
  { id: 'dev@wiki', projectId: 'wiki' },
  { id: 'seo@shop', projectId: 'shop' },
  { id: 'office@company', projectId: 'company' },
  { id: 'pm@company', projectId: 'company' },
];

describe('agentsInScope', () => {
  it('returns everything when no project is selected', () => {
    expect(agentsInScope(AGENTS, null)).toHaveLength(4);
  });

  it('keeps project agents plus company agents', () => {
    const scoped = agentsInScope(AGENTS, 'wiki');
    expect(scoped.map((a) => a.id)).toEqual(['dev@wiki', 'office@company', 'pm@company']);
  });

  it('excludes other projects entirely', () => {
    expect(agentsInScope(AGENTS, 'shop').map((a) => a.id)).not.toContain('dev@wiki');
  });
});

describe('eventsInScope', () => {
  const EVENTS = [
    { type: 'task.complete', projectId: 'wiki' },
    { type: 'task.failed', projectId: 'shop' },
    { type: 'goal.triggered', projectId: undefined },
  ];

  it('returns everything when no project is selected', () => {
    expect(eventsInScope(EVENTS, null)).toHaveLength(3);
  });

  it('keeps project events plus company-level events without projectId', () => {
    const scoped = eventsInScope(EVENTS, 'wiki');
    expect(scoped.map((e) => e.type)).toEqual(['task.complete', 'goal.triggered']);
  });
});
