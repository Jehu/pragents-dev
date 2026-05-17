import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import {
  fetchInboxItems,
  approveItem,
  rejectItem,
  relativeTime,
  inboxItemTitle,
  inboxItemBody,
  type InboxItem,
  type Gate,
  type Plan,
  type Skill,
} from '../index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── relativeTime ─────────────────────────────────────────────────────────────

describe('relativeTime', () => {
  it('shows seconds for < 60s', () => {
    const ts = Date.now() - 30_000;
    expect(relativeTime(ts)).toBe('30s ago');
  });

  it('shows minutes for < 1h', () => {
    const ts = Date.now() - 2 * 60 * 1000;
    expect(relativeTime(ts)).toBe('2m ago');
  });

  it('shows hours for < 24h', () => {
    const ts = Date.now() - 3 * 3600 * 1000;
    expect(relativeTime(ts)).toBe('3h ago');
  });

  it('shows days for >= 24h', () => {
    const ts = Date.now() - 2 * 86400 * 1000;
    expect(relativeTime(ts)).toBe('2d ago');
  });
});

// ─── inboxItemTitle ───────────────────────────────────────────────────────────

describe('inboxItemTitle', () => {
  it('returns gate label', () => {
    const item: InboxItem = {
      _kind: 'gate',
      item: { id: '1', label: 'Review deploy', status: 'pending', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    expect(inboxItemTitle(item)).toBe('Review deploy');
  });

  it('returns plan prompt truncated at 60 chars', () => {
    const longPrompt = 'A'.repeat(70);
    const item: InboxItem = {
      _kind: 'plan',
      item: { id: '2', prompt: longPrompt, status: 'draft', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    const title = inboxItemTitle(item);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
  });

  it('returns plan prompt as-is if short', () => {
    const item: InboxItem = {
      _kind: 'plan',
      item: { id: '2', prompt: 'Short prompt', status: 'draft', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    expect(inboxItemTitle(item)).toBe('Short prompt');
  });

  it('returns skill name', () => {
    const item: InboxItem = {
      _kind: 'skill',
      item: { name: 'my-skill', status: 'proposed', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    expect(inboxItemTitle(item)).toBe('my-skill');
  });
});

// ─── inboxItemBody ────────────────────────────────────────────────────────────

describe('inboxItemBody', () => {
  it('returns a ReactNode for gate', () => {
    const item: InboxItem = {
      _kind: 'gate',
      item: { id: '1', label: 'Gate A', status: 'pending', workflowName: 'Deploy', description: 'Check logs', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    const body = inboxItemBody(item);
    expect(body).toBeTruthy();
  });

  it('returns a ReactNode for plan with steps', () => {
    const item: InboxItem = {
      _kind: 'plan',
      item: { id: '2', prompt: 'Do work', status: 'draft', steps: [{ description: 'Step 1' }], createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    const body = inboxItemBody(item);
    expect(body).toBeTruthy();
  });

  it('returns a ReactNode for skill', () => {
    const item: InboxItem = {
      _kind: 'skill',
      item: { name: 'foo', status: 'proposed', sourceAgent: 'agent-1', tags: ['t1', 't2'], createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    const body = inboxItemBody(item);
    expect(body).toBeTruthy();
  });
});

// ─── fetchInboxItems ──────────────────────────────────────────────────────────

describe('fetchInboxItems', () => {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 1000).toISOString();

  function mockFetch(gates: Gate[], plans: Plan[], skills: Skill[]) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      let data: unknown;
      if (url.includes('/gates')) data = { gates };
      else if (url.includes('/plans')) data = { plans };
      else if (url.includes('/skills')) data = { skills };
      else data = {};
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      });
    }));
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('merges gates, plans, skills and sorts desc by createdAt', async () => {
    const gate: Gate = { id: 'g1', label: 'Gate', status: 'pending', createdAt: now };
    const plan: Plan = { id: 'p1', prompt: 'Plan', status: 'draft', createdAt: earlier };
    const skill: Skill = { name: 'sk1', status: 'proposed', createdAt: earlier };
    mockFetch([gate], [plan], [skill]);

    const items = await fetchInboxItems();
    expect(items[0]._kind).toBe('gate');
    expect(items[0].item).toMatchObject({ id: 'g1' });
  });

  it('returns at most 3 items', async () => {
    const gates: Gate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `g${i}`,
      label: `Gate ${i}`,
      status: 'pending',
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
    mockFetch(gates, [], []);

    const items = await fetchInboxItems();
    expect(items.length).toBe(3);
  });

  it('throws when inbox fetches fail instead of hiding failure as empty', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) }),
    ));
    await expect(fetchInboxItems()).rejects.toThrow('boom');
  });

  it('handles response without wrapper key (array response)', async () => {
    const gate: Gate = { id: 'g1', label: 'Direct array gate', status: 'pending', createdAt: now };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      let data: unknown;
      if (url.includes('/gates')) data = [gate];
      else if (url.includes('/plans')) data = [];
      else data = [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    }));

    const items = await fetchInboxItems();
    expect(items).toHaveLength(1);
    expect(items[0]._kind).toBe('gate');
  });
});

// ─── approveItem ─────────────────────────────────────────────────────────────

describe('approveItem', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
  });

  it('calls gates approve endpoint for gate', async () => {
    const item: InboxItem = {
      _kind: 'gate',
      item: { id: 'g42', label: 'G', status: 'pending', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    await act(async () => { await approveItem(item); });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gates/g42/approve'),
      { method: 'POST' },
    );
  });

  it('calls plans approve endpoint for plan', async () => {
    const item: InboxItem = {
      _kind: 'plan',
      item: { id: 'p7', prompt: 'Do X', status: 'draft', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    await act(async () => { await approveItem(item); });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/plans/p7/approve'),
      { method: 'POST' },
    );
  });

  it('calls skills approve endpoint for skill', async () => {
    const item: InboxItem = {
      _kind: 'skill',
      item: { name: 'search-web', status: 'proposed', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    await act(async () => { await approveItem(item); });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/skills/search-web/approve'),
      { method: 'POST' },
    );
  });
});

// ─── rejectItem ──────────────────────────────────────────────────────────────

describe('rejectItem', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
  });

  it('calls gates reject endpoint for gate', async () => {
    const item: InboxItem = {
      _kind: 'gate',
      item: { id: 'g1', label: 'G', status: 'pending', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    await act(async () => { await rejectItem(item); });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gates/g1/reject'),
      { method: 'POST' },
    );
  });

  it('calls plans cancel endpoint for plan', async () => {
    const item: InboxItem = {
      _kind: 'plan',
      item: { id: 'p3', prompt: 'Plan', status: 'draft', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    await act(async () => { await rejectItem(item); });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/plans/p3/cancel'),
      { method: 'POST' },
    );
  });

  it('calls skills reject endpoint for skill', async () => {
    const item: InboxItem = {
      _kind: 'skill',
      item: { name: 'my-skill', status: 'proposed', createdAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    await act(async () => { await rejectItem(item); });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/skills/my-skill/reject'),
      { method: 'POST' },
    );
  });
});
