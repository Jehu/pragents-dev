import { describe, it, expect } from 'vitest';
import { normalizePlan } from '../decomposer.js';

describe('normalizePlan', () => {
  it('converts numeric-string dependsOn to integer', () => {
    const out = normalizePlan({ steps: [{ description: 'a', agentId: 'dev', dependsOn: '3' }] });
    expect(out.steps[0].dependsOn).toBe(3);
  });

  it('converts string array dependsOn to integer array', () => {
    const out = normalizePlan({ steps: [{ description: 'a', agentId: 'dev', dependsOn: ['0', '2'] }] });
    expect(out.steps[0].dependsOn).toEqual([0, 2]);
  });

  it('leaves numeric dependsOn untouched', () => {
    const out = normalizePlan({ steps: [{ description: 'a', agentId: 'dev', dependsOn: 1 }] });
    expect(out.steps[0].dependsOn).toBe(1);
  });

  it('leaves non-numeric strings untouched (so Zod can reject them)', () => {
    const out = normalizePlan({ steps: [{ description: 'a', agentId: 'dev', dependsOn: 'foo' }] });
    expect(out.steps[0].dependsOn).toBe('foo');
  });

  it('ignores missing dependsOn', () => {
    const out = normalizePlan({ steps: [{ description: 'a', agentId: 'dev' }] });
    expect(out.steps[0].dependsOn).toBeUndefined();
  });

  it('returns input unchanged when steps is missing', () => {
    expect(normalizePlan({})).toEqual({});
    expect(normalizePlan(null)).toBeNull();
  });
});
