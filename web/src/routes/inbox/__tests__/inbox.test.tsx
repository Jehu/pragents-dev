import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));

// eventBus mock — path from THIS file to the store
vi.mock('../../../stores/eventBus.js', () => ({
  useEventBusStore: vi.fn(() => []),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as TanStackQuery from '@tanstack/react-query';
import * as InboxModule from '../index.js';
import { useEventBusStore } from '../../../stores/eventBus.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AnyFn = (...args: unknown[]) => unknown;

function mockUseQuery(impl: (opts: { queryKey: unknown[] }) => { data: unknown; isLoading?: boolean }) {
  (TanStackQuery.useQuery as unknown as { mockImplementation: (fn: AnyFn) => void })
    .mockImplementation(impl as AnyFn);
}

function mockUseMutation(impl: (opts: {
  mutationFn?: unknown;
  onMutate?: (v: unknown) => void;
  onError?: (e: unknown, v: unknown) => void;
  onSuccess?: (data: unknown, v: unknown) => void;
}) => { mutate: AnyFn; isPending: boolean }) {
  (TanStackQuery.useMutation as unknown as { mockImplementation: (fn: AnyFn) => void })
    .mockImplementation(impl as AnyFn);
}

function mockUseMutationSimple(mutate: AnyFn = vi.fn()) {
  mockUseMutation(() => ({ mutate, isPending: false }));
}

function renderInbox() {
  const Route = InboxModule.Route as unknown as { component: React.ComponentType };
  return render(React.createElement(Route.component));
}

// ─── Keyboard shortcut tests ──────────────────────────────────────────────────

describe('Inbox keyboard shortcuts', () => {
  const gates = [
    { id: 'g1', label: 'Gate 1', status: 'pending', createdAt: new Date().toISOString() },
    { id: 'g2', label: 'Gate 2', status: 'pending', createdAt: new Date().toISOString() },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));

    (TanStackQuery.useQueryClient as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue({ invalidateQueries: vi.fn().mockResolvedValue(undefined) });

    (useEventBusStore as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue([]);

    mockUseQuery(({ queryKey }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'inbox-gates') {
        return { data: gates, isLoading: false };
      }
      return { data: [], isLoading: false };
    });

    mockUseMutation(({ onMutate, onSuccess }) => ({
      mutate: vi.fn((entry: unknown) => {
        onMutate?.(entry);
        Promise.resolve().then(() => onSuccess?.(undefined, entry));
      }),
      isPending: false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders tab bar with all tabs', () => {
    const { getByTestId } = renderInbox();
    expect(getByTestId('tab-all')).toBeTruthy();
    expect(getByTestId('tab-gates')).toBeTruthy();
    expect(getByTestId('tab-plans')).toBeTruthy();
    expect(getByTestId('tab-skills')).toBeTruthy();
  });

  it('shows correct count for gates tab', () => {
    const { getByTestId } = renderInbox();
    expect(getByTestId('tab-count-gates').textContent).toBe('2');
  });

  it('shows correct count for all tab', () => {
    const { getByTestId } = renderInbox();
    expect(getByTestId('tab-count-all').textContent).toBe('2');
  });

  it('renders inbox items', () => {
    const { getByTestId } = renderInbox();
    expect(getByTestId('inbox-list')).toBeTruthy();
  });

  it('J key moves focus to next item', async () => {
    const { getByTestId } = renderInbox();
    const container = getByTestId('inbox-container');
    container.focus();

    const item0 = getByTestId('inbox-item-gate-g1');
    expect(item0.className).toContain('ring');

    fireEvent.keyDown(container, { key: 'j' });

    await waitFor(() => {
      expect(getByTestId('inbox-item-gate-g2').className).toContain('ring');
    });
  });

  it('K key moves focus to previous item', async () => {
    const { getByTestId } = renderInbox();
    const container = getByTestId('inbox-container');
    container.focus();

    fireEvent.keyDown(container, { key: 'j' });
    await waitFor(() => {
      expect(getByTestId('inbox-item-gate-g2').className).toContain('ring');
    });

    fireEvent.keyDown(container, { key: 'k' });
    await waitFor(() => {
      expect(getByTestId('inbox-item-gate-g1').className).toContain('ring');
    });
  });

  it('? key toggles help modal', async () => {
    const { getByTestId, queryByTestId } = renderInbox();
    const container = getByTestId('inbox-container');
    container.focus();

    expect(queryByTestId('help-modal')).toBeNull();
    fireEvent.keyDown(container, { key: '?' });
    await waitFor(() => { expect(getByTestId('help-modal')).toBeTruthy(); });

    fireEvent.keyDown(container, { key: '?' });
    await waitFor(() => { expect(queryByTestId('help-modal')).toBeNull(); });
  });

  it('A key calls approve mutate on focused item', async () => {
    // The approve mutation is set up in beforeEach — render then fire A key.
    // We verify the behavior by checking that clicking Approve works the same way (indirect).
    // For direct keyboard path: just verify the item disappears (onMutate is called).
    const { getByTestId, queryByTestId } = renderInbox();
    const container = getByTestId('inbox-container');
    container.focus();

    expect(getByTestId('inbox-item-gate-g1')).toBeTruthy();
    fireEvent.keyDown(container, { key: 'a' });

    // onMutate was wired in beforeEach to call setRemovedKeys; item should disappear
    await waitFor(() => {
      expect(queryByTestId('inbox-item-gate-g1')).toBeNull();
    });
  });

  it('R key calls reject mutate on focused item', async () => {
    const { getByTestId, queryByTestId } = renderInbox();
    const container = getByTestId('inbox-container');
    container.focus();

    expect(getByTestId('inbox-item-gate-g1')).toBeTruthy();
    fireEvent.keyDown(container, { key: 'r' });

    // onMutate removes item optimistically
    await waitFor(() => {
      expect(queryByTestId('inbox-item-gate-g1')).toBeNull();
    });
  });
});

// ─── Optimistic update tests ──────────────────────────────────────────────────

describe('Inbox optimistic updates', () => {
  const gates = [
    { id: 'g1', label: 'Gate One', status: 'pending', createdAt: new Date().toISOString() },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));

    (TanStackQuery.useQueryClient as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue({ invalidateQueries: vi.fn().mockResolvedValue(undefined) });

    (useEventBusStore as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue([]);

    mockUseQuery(({ queryKey }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'inbox-gates') {
        return { data: gates, isLoading: false };
      }
      return { data: [], isLoading: false };
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('item disappears optimistically when approved via onMutate', async () => {
    mockUseMutation(({ onMutate }) => ({
      mutate: vi.fn((entry: unknown) => { onMutate?.(entry); }),
      isPending: false,
    }));

    const { queryByTestId, getByText } = renderInbox();

    expect(queryByTestId('inbox-item-gate-g1')).toBeTruthy();

    await act(async () => {
      fireEvent.click(getByText('Approve'));
    });

    await waitFor(() => {
      expect(queryByTestId('inbox-item-gate-g1')).toBeNull();
    });
  });

  it('item reappears on error rollback via onError', async () => {
    let capturedOnError: ((err: unknown, entry: unknown) => void) | undefined;
    let capturedEntry: unknown;

    mockUseMutation(({ onMutate, onError }) => {
      capturedOnError = onError;
      return {
        mutate: vi.fn((entry: unknown) => {
          capturedEntry = entry;
          onMutate?.(entry);
        }),
        isPending: false,
      };
    });

    const { queryByTestId, getByText } = renderInbox();

    expect(queryByTestId('inbox-item-gate-g1')).toBeTruthy();

    await act(async () => {
      fireEvent.click(getByText('Approve'));
    });

    await waitFor(() => {
      expect(queryByTestId('inbox-item-gate-g1')).toBeNull();
    });

    await act(async () => {
      capturedOnError?.(new Error('Network error'), capturedEntry);
    });

    await waitFor(() => {
      expect(queryByTestId('inbox-item-gate-g1')).toBeTruthy();
    });
  });
});

// ─── Tab filtering tests ──────────────────────────────────────────────────────

describe('Inbox tab filtering', () => {
  const gates = [{ id: 'g1', label: 'Gate 1', status: 'pending', createdAt: new Date().toISOString() }];
  const plans = [{ id: 'p1', prompt: 'Plan 1', status: 'draft', createdAt: new Date().toISOString() }];
  const skills = [{ name: 'sk1', status: 'proposed', createdAt: new Date().toISOString() }];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));

    (TanStackQuery.useQueryClient as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue({ invalidateQueries: vi.fn().mockResolvedValue(undefined) });

    (useEventBusStore as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue([]);

    mockUseQuery(({ queryKey }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : '';
      if (key === 'inbox-gates') return { data: gates };
      if (key === 'inbox-plans') return { data: plans };
      if (key === 'inbox-skills') return { data: skills };
      return { data: [] };
    });

    mockUseMutationSimple();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('All tab shows all items', () => {
    const { getByTestId } = renderInbox();
    expect(getByTestId('inbox-item-gate-g1')).toBeTruthy();
    expect(getByTestId('inbox-item-plan-p1')).toBeTruthy();
    expect(getByTestId('inbox-item-skill-sk1')).toBeTruthy();
  });

  it('Gates tab shows only gates', async () => {
    const { getByTestId, queryByTestId } = renderInbox();
    fireEvent.click(getByTestId('tab-gates'));
    await waitFor(() => {
      expect(getByTestId('inbox-item-gate-g1')).toBeTruthy();
      expect(queryByTestId('inbox-item-plan-p1')).toBeNull();
      expect(queryByTestId('inbox-item-skill-sk1')).toBeNull();
    });
  });

  it('Plans tab shows only plans', async () => {
    const { getByTestId, queryByTestId } = renderInbox();
    fireEvent.click(getByTestId('tab-plans'));
    await waitFor(() => {
      expect(getByTestId('inbox-item-plan-p1')).toBeTruthy();
      expect(queryByTestId('inbox-item-gate-g1')).toBeNull();
    });
  });

  it('Skills tab shows only skills', async () => {
    const { getByTestId, queryByTestId } = renderInbox();
    fireEvent.click(getByTestId('tab-skills'));
    await waitFor(() => {
      expect(getByTestId('inbox-item-skill-sk1')).toBeTruthy();
      expect(queryByTestId('inbox-item-gate-g1')).toBeNull();
    });
  });

  it('tab counts reflect total items regardless of active tab', () => {
    const { getByTestId } = renderInbox();
    expect(getByTestId('tab-count-all').textContent).toBe('3');
    expect(getByTestId('tab-count-gates').textContent).toBe('1');
    expect(getByTestId('tab-count-plans').textContent).toBe('1');
    expect(getByTestId('tab-count-skills').textContent).toBe('1');
  });

  it('shows empty state when no items match tab', async () => {
    mockUseQuery(({ queryKey }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : '';
      if (key === 'inbox-gates') return { data: gates };
      return { data: [] };
    });

    const { getByTestId, queryByTestId } = renderInbox();
    fireEvent.click(getByTestId('tab-skills'));
    await waitFor(() => {
      expect(queryByTestId('inbox-list')).toBeNull();
    });
  });
});

export {};
