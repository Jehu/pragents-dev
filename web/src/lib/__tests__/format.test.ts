import { describe, it, expect } from 'vitest';
import { formatTokensCompact } from '../format.js';

describe('formatTokensCompact', () => {
  it('leaves values under 1k unformatted', () => {
    expect(formatTokensCompact(0)).toBe('0');
    expect(formatTokensCompact(999)).toBe('999');
  });

  it('uses a k suffix from 1_000', () => {
    expect(formatTokensCompact(1_000)).toBe('1.0k');
    expect(formatTokensCompact(40_500)).toBe('40.5k');
  });

  it('uses an M suffix from 1_000_000', () => {
    expect(formatTokensCompact(1_000_000)).toBe('1.0M');
    expect(formatTokensCompact(2_400_000)).toBe('2.4M');
  });
});
