import { describe, it, expect } from 'vitest';
import { messageText } from '../$agentId.js';

describe('messageText', () => {
  it('passes plain string content through', () => {
    expect(messageText({ role: 'user', content: 'hello' })).toBe('hello');
  });

  it('flattens text blocks from array content', () => {
    expect(
      messageText({
        role: 'assistant',
        content: [
          { type: 'text', text: 'part one' },
          { type: 'thinking', text: undefined },
          { type: 'text', text: 'part two' },
        ],
      }),
    ).toBe('part one\npart two');
  });

  it('returns empty string for missing content', () => {
    expect(messageText({ role: 'assistant' })).toBe('');
  });
});
