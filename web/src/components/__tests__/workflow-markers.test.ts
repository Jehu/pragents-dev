import { describe, it, expect } from 'vitest';
import { computeAgentMarkers } from '../workflow-markers.js';

// `computeAgentMarkers` is pure — we test it in isolation so we never
// have to spin up Monaco in jsdom (Monaco's worker setup blows up).

describe('computeAgentMarkers', () => {
  const KNOWN = ['dev@alpha', 'seo@alpha', 'office@company'];

  it('returns no markers when every agent ref is known', () => {
    const yaml = `name: ok\nsteps:\n  - id: a\n    agent: dev@alpha\n    prompt: "x"\n  - id: b\n    agent: seo@alpha\n    prompt: "y"\n`;
    expect(computeAgentMarkers(yaml, KNOWN)).toEqual([]);
  });

  it('flags an unknown agent ref with a 1-based line + column', () => {
    const yaml = `name: ok\nsteps:\n  - id: a\n    agent: ghost@alpha\n    prompt: "x"\n`;
    const markers = computeAgentMarkers(yaml, KNOWN);
    expect(markers).toHaveLength(1);
    const [m] = markers;
    expect(m.line).toBe(4);
    // "    agent: " is the prefix → column should point at the ref start.
    expect(m.column).toBe('    agent: '.length + 1);
    expect(m.length).toBe('ghost@alpha'.length);
    expect(m.message).toMatch(/ghost@alpha/);
  });

  it('handles quoted agent refs', () => {
    const yaml = `steps:\n  - id: a\n    agent: "ghost@alpha"\n    prompt: x\n`;
    const markers = computeAgentMarkers(yaml, KNOWN);
    expect(markers).toHaveLength(1);
    expect(markers[0].length).toBe('ghost@alpha'.length);
  });

  it('flags multiple bad refs across lines', () => {
    const yaml = `steps:\n  - id: a\n    agent: ghost1@alpha\n    prompt: x\n  - id: b\n    agent: ghost2@beta\n    prompt: y\n`;
    expect(computeAgentMarkers(yaml, KNOWN)).toHaveLength(2);
  });

  it('ignores the structured `route_by` agent form (no scalar ref on that line)', () => {
    const yaml = `steps:\n  - id: a\n    agent:\n      route_by: capabilities\n      prefer: [writing]\n    prompt: x\n`;
    // `agent:` line has no scalar on the same line — regex skips it.
    expect(computeAgentMarkers(yaml, KNOWN)).toEqual([]);
  });
});
