import { describe, it, expect } from 'vitest';
import { formatBytes, formatUptime, isHealthy, isWarning } from '../index.js';
import type { HealthData } from '../index.js';

function makeHealth(overrides: Partial<HealthData> = {}): HealthData {
  return {
    status: 'ok',
    uptime: 3600,
    db: { connected: true, size: 4 * 1024 * 1024 },
    memory: { store: 'LanceDB', degraded: false },
    agents_active: 2,
    ...overrides,
  };
}

// ─── formatBytes ──────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('returns bytes for < 1KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('returns KB for < 1MB', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('returns MB for < 1GB', () => {
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB');
  });

  it('returns GB for >= 1GB', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

// ─── formatUptime ─────────────────────────────────────────────────────────────

describe('formatUptime', () => {
  it('shows seconds for < 60s', () => {
    expect(formatUptime(45)).toBe('45s');
  });

  it('shows minutes only', () => {
    expect(formatUptime(180)).toBe('3m');
  });

  it('shows hours and minutes', () => {
    expect(formatUptime(3690)).toBe('1h 1m');
  });

  it('shows days, hours and minutes', () => {
    expect(formatUptime(2 * 86400 + 4 * 3600 + 12 * 60)).toBe('2d 4h 12m');
  });

  it('omits zero components', () => {
    expect(formatUptime(2 * 86400)).toBe('2d');
  });

  it('returns 0s for zero seconds', () => {
    expect(formatUptime(0)).toBe('0s');
  });
});

// ─── isHealthy / isWarning ────────────────────────────────────────────────────

describe('isHealthy', () => {
  it('returns true when db connected and memory nominal', () => {
    expect(isHealthy(makeHealth())).toBe(true);
  });

  it('returns false when db disconnected', () => {
    expect(isHealthy(makeHealth({ db: { connected: false, size: 0 } }))).toBe(false);
  });

  it('returns false when memory degraded', () => {
    expect(isHealthy(makeHealth({ memory: { store: 'Simple', degraded: true } }))).toBe(false);
  });
});

describe('isWarning', () => {
  it('returns false when all nominal', () => {
    expect(isWarning(makeHealth())).toBe(false);
  });

  it('returns true when db disconnected', () => {
    expect(isWarning(makeHealth({ db: { connected: false, size: 0 } }))).toBe(true);
  });

  it('returns true when memory degraded', () => {
    expect(isWarning(makeHealth({ memory: { store: 'Simple', degraded: true } }))).toBe(true);
  });
});

// ─── Status dot logic ─────────────────────────────────────────────────────────

describe('status dot color logic', () => {
  it('db connected maps to nominal state', () => {
    const h = makeHealth();
    expect(h.db.connected).toBe(true);
    expect(h.memory.degraded).toBe(false);
  });

  it('db disconnected maps to error state', () => {
    const h = makeHealth({ db: { connected: false, size: 0 } });
    expect(isWarning(h)).toBe(true);
  });
});
