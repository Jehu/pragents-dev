import { describe, it, expect } from 'vitest';
import { parseCron, relativeTimeMs } from '../index.js';

// ─── parseCron ────────────────────────────────────────────────────────────────

describe('parseCron', () => {
  it('returns "every minute" for * * * * *', () => {
    expect(parseCron('* * * * *')).toBe('every minute');
  });

  it('returns "every hour" for 0 * * * *', () => {
    expect(parseCron('0 * * * *')).toBe('every hour');
  });

  it('returns "every day at 09:00" for 0 9 * * *', () => {
    expect(parseCron('0 9 * * *')).toBe('every day at 09:00');
  });

  it('returns "every Monday at 09:00" for 0 9 * * 1', () => {
    expect(parseCron('0 9 * * 1')).toBe('every Monday at 09:00');
  });

  it('returns "every 1st of the month at 09:00" for 0 9 1 * *', () => {
    expect(parseCron('0 9 1 * *')).toBe('every 1st of the month at 09:00');
  });

  it('returns "every weekday at 09:00" for 0 9 * * 1-5', () => {
    expect(parseCron('0 9 * * 1-5')).toBe('every weekday at 09:00');
  });

  it('returns "every Sunday at 00:00" for 0 0 * * 0', () => {
    expect(parseCron('0 0 * * 0')).toBe('every Sunday at 00:00');
  });

  it('returns "every Saturday at 12:00" for 0 12 * * 6', () => {
    expect(parseCron('0 12 * * 6')).toBe('every Saturday at 12:00');
  });

  it('returns "every 15th of the month at 10:00" for 0 10 15 * *', () => {
    expect(parseCron('0 10 15 * *')).toBe('every 15th of the month at 10:00');
  });

  it('returns original string for unrecognized patterns', () => {
    expect(parseCron('*/5 * * * *')).toBe('*/5 * * * *');
  });

  it('returns original string for invalid cron (wrong parts)', () => {
    expect(parseCron('0 9 * *')).toBe('0 9 * *');
  });

  it('handles leading/trailing whitespace', () => {
    expect(parseCron('  * * * * *  ')).toBe('every minute');
  });
});

// ─── relativeTimeMs ───────────────────────────────────────────────────────────

describe('relativeTimeMs', () => {
  it('shows seconds for < 60s', () => {
    const ts = Date.now() - 30_000;
    expect(relativeTimeMs(ts)).toBe('30s ago');
  });

  it('shows minutes for < 1h', () => {
    const ts = Date.now() - 2 * 60_000;
    expect(relativeTimeMs(ts)).toBe('2m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = Date.now() - 3 * 3_600_000;
    expect(relativeTimeMs(ts)).toBe('3h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = Date.now() - 2 * 86_400_000;
    expect(relativeTimeMs(ts)).toBe('2d ago');
  });
});
