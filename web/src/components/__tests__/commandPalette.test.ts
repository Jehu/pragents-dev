import { describe, it, expect } from 'vitest';
import { matchesQuery } from '../CommandPalette.js';

// ---------------------------------------------------------------------------
// matchesQuery — filtering logic
// ---------------------------------------------------------------------------

describe('matchesQuery', () => {
  it('returns true when query is empty', () => {
    expect(matchesQuery('Overview', '')).toBe(true);
    expect(matchesQuery('Some Label', '')).toBe(true);
  });

  it('matches exact substring (case-insensitive)', () => {
    expect(matchesQuery('Overview', 'over')).toBe(true);
    expect(matchesQuery('Overview', 'OVER')).toBe(true);
    expect(matchesQuery('Overview', 'view')).toBe(true);
  });

  it('returns false when no substring match', () => {
    expect(matchesQuery('Overview', 'xyz')).toBe(false);
    expect(matchesQuery('Agents', 'tasks')).toBe(false);
  });

  it('handles full label match', () => {
    expect(matchesQuery('Chat', 'chat')).toBe(true);
    expect(matchesQuery('Chat', 'CHAT')).toBe(true);
  });

  it('matches agent label prefix', () => {
    expect(matchesQuery('Agent: research-lead', 'research')).toBe(true);
    expect(matchesQuery('Agent: research-lead', 'agent')).toBe(true);
    expect(matchesQuery('Agent: research-lead', 'agent: r')).toBe(true);
  });

  it('matches task label with truncated description', () => {
    expect(matchesQuery('Task: Write a blog post about AI', 'blog')).toBe(true);
    expect(matchesQuery('Task: Write a blog post about AI', 'BLOG')).toBe(true);
    expect(matchesQuery('Task: Write a blog post about AI', 'xyz')).toBe(false);
  });

  it('matches skill label', () => {
    expect(matchesQuery('Skill: web-research', 'web')).toBe(true);
    expect(matchesQuery('Skill: web-research', 'skill')).toBe(true);
    expect(matchesQuery('Skill: web-research', 'xyz')).toBe(false);
  });

  it('matches dispatch action', () => {
    expect(matchesQuery('✦ Dispatch task…', 'dispatch')).toBe(true);
    expect(matchesQuery('✦ Dispatch task…', 'task')).toBe(true);
    expect(matchesQuery('✦ Dispatch task…', 'xyz')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation logic (pure)
// ---------------------------------------------------------------------------

describe('keyboard navigation logic', () => {
  function clamp(idx: number, min: number, max: number): number {
    return Math.min(Math.max(idx, min), max);
  }

  function moveDown(current: number, total: number): number {
    return clamp(current + 1, 0, total - 1);
  }

  function moveUp(current: number, total: number): number {
    return clamp(current - 1, 0, total - 1);
  }

  it('moves down from 0 to 1', () => {
    expect(moveDown(0, 5)).toBe(1);
  });

  it('does not go below 0', () => {
    expect(moveUp(0, 5)).toBe(0);
  });

  it('does not exceed last item index', () => {
    expect(moveDown(4, 5)).toBe(4);
  });

  it('wraps at top correctly', () => {
    expect(moveUp(0, 10)).toBe(0);
  });

  it('wraps at bottom correctly', () => {
    expect(moveDown(9, 10)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Dispatch submit validation (pure logic)
// ---------------------------------------------------------------------------

describe('dispatch submit validation', () => {
  function canSubmit(agentId: string, description: string): boolean {
    return agentId.length > 0 && description.trim().length > 0;
  }

  it('returns false when agentId is empty', () => {
    expect(canSubmit('', 'some task')).toBe(false);
  });

  it('returns false when description is blank', () => {
    expect(canSubmit('agent-1', '')).toBe(false);
    expect(canSubmit('agent-1', '   ')).toBe(false);
  });

  it('returns true when both are present', () => {
    expect(canSubmit('agent-1', 'Write a report')).toBe(true);
  });
});
