import { describe, it, expect } from 'vitest';
import { EventBuffer } from '../../events/buffer.js';

describe('EventBuffer', () => {
  it('push returns sequential IDs', () => {
    const buf = new EventBuffer(100);
    const e1 = buf.push('p1', 'a1', 'test', {});
    const e2 = buf.push('p1', 'a1', 'test', {});
    expect(e2.id).toBe(e1.id + 1);
  });

  it('getSince filters by lastEventId', () => {
    const buf = new EventBuffer(100);
    buf.push('p1', 'a1', 'e1', {});
    buf.push('p1', 'a1', 'e2', {});
    buf.push('p1', 'a1', 'e3', {});
    const events = buf.getSince(1);
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe(2);
  });

  it('getSince with project filter', () => {
    const buf = new EventBuffer(100);
    buf.push('p1', 'a1', 'e1', {});
    buf.push('p2', 'a2', 'e2', {});
    const events = buf.getSince(0, 'p1');
    expect(events).toHaveLength(1);
    expect(events[0].projectId).toBe('p1');
  });

  it('evicts oldest on overflow', () => {
    const buf = new EventBuffer(3);
    buf.push('p1', 'a1', 'e1', {});
    buf.push('p1', 'a1', 'e2', {});
    buf.push('p1', 'a1', 'e3', {});
    buf.push('p1', 'a1', 'e4', {});
    const events = buf.getRecent(10);
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe(2); // e1 was evicted
  });

  it('getRecent with limit', () => {
    const buf = new EventBuffer(100);
    for (let i = 0; i < 10; i++) buf.push('p1', 'a1', 'test', {});
    expect(buf.getRecent(3)).toHaveLength(3);
  });
});
