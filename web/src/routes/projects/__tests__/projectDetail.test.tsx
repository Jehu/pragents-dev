import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import { buildAgentPayload, type AgentFormValues } from '../../../components/AgentForm.js';
import { toAgentFormValues } from '../$projectId.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => {
    const route = opts as { component: React.FC };
    return Object.assign(route, {
      useParams: () => ({ projectId: 'alpha' }),
    });
  },
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

const mockUseEtagFetch = vi.fn();
vi.mock('../../../hooks/useEtagFetch.js', () => ({
  useEtagFetch: (...args: unknown[]) => mockUseEtagFetch(...args),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Pure logic ───────────────────────────────────────────────────────────────

describe('toAgentFormValues ↔ buildAgentPayload round trip', () => {
  it('preserves the structured memory map across the inverse', () => {
    const raw = {
      type: 'dev' as const,
      model: 'claude-sonnet',
      personality: 'helpful',
      capabilities: ['ts', 'rust'],
      memory: {
        company: 'read' as const,
        project: 'read/write' as const,
        projects: { all: 'read' as const },
      },
      tokenBudget: 50_000,
      keepWarm: true,
    };
    const form = toAgentFormValues(raw, 'dev');
    expect(form.memory.projectsAll).toBe('read');
    expect(form.memory.company).toBe('read');
    expect(form.memory.project).toBe('read/write');
    const back = buildAgentPayload(form);
    expect(back).toMatchObject({
      type: 'dev',
      model: 'claude-sonnet',
      personality: 'helpful',
      capabilities: ['ts', 'rust'],
      memory: {
        company: 'read',
        project: 'read/write',
        projects: { all: 'read' },
      },
      tokenBudget: 50_000,
      keepWarm: true,
    });
  });

  it('returns sane defaults for an undefined raw input', () => {
    const form = toAgentFormValues(undefined, 'seo');
    expect(form.type).toBe('seo');
    expect(form.memory).toEqual({ company: 'none', project: 'none', projectsAll: 'none' });
    expect(form.capabilities).toEqual([]);
    expect(form.keepWarm).toBe(false);
  });
});

// ─── Route component integration ─────────────────────────────────────────────

const SAMPLE_PROJECT = {
  id: 'alpha',
  name: 'Alpha',
  directory: '~/alpha',
  agents: {
    dev: {
      type: 'dev',
      model: 'claude-sonnet',
      personality: 'helpful dev',
      capabilities: ['ts'],
      memory: { project: 'read/write' },
      keepWarm: false,
    },
  },
};

function setUseEtagFetch(state: {
  data: unknown;
  etag?: string | null;
  loading?: boolean;
  error?: Error | null;
}) {
  mockUseEtagFetch.mockReturnValue({
    data: state.data,
    etag: state.etag ?? 'W/"abc"',
    loading: state.loading ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  // Provide a default fetch stub the route may call (PUT/POST/DELETE).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});

describe('ProjectDetailPage', () => {
  it('renders loading state', async () => {
    setUseEtagFetch({ data: undefined, loading: true });
    const mod = await import('../$projectId.js');
    const Comp = mod.Route.component as React.FC;
    render(<Comp />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });

  it('renders error state when project read fails', async () => {
    setUseEtagFetch({ data: undefined, error: new Error('boom') });
    const mod = await import('../$projectId.js');
    const Comp = mod.Route.component as React.FC;
    render(<Comp />);
    expect(screen.getByRole('alert').textContent).toMatch(/boom/);
  });

  it('shows the configured dev agent and offers slots for missing types', async () => {
    setUseEtagFetch({ data: SAMPLE_PROJECT, etag: 'W/"abc"' });
    const mod = await import('../$projectId.js');
    const Comp = mod.Route.component as React.FC;
    render(<Comp />);
    // dev shows up; seo and content offer "Add" affordances.
    expect(screen.getByText('dev')).toBeTruthy();
    expect(screen.getAllByText(/Add/i).length).toBeGreaterThan(0);
  });

  it('renders ConflictDialog when saveAgent gets 412 from the server (I4)', async () => {
    setUseEtagFetch({ data: SAMPLE_PROJECT, etag: 'W/"abc"' });
    // First fetch: the PUT that 412s. Second fetch: the diff probe.
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init && init.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'stale' }), { status: 412 });
      }
      // GET the diff probe — return a different agents block.
      return new Response(
        JSON.stringify({
          id: 'alpha',
          name: 'Alpha (changed externally)',
          directory: '~/alpha',
          agents: { dev: { type: 'dev', model: 'OTHER MODEL' } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('../$projectId.js');
    const Comp = mod.Route.component as React.FC;
    render(<Comp />);
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editButtons[editButtons.length - 1]);
    const saveBtn = await waitFor(() => screen.getByRole('button', { name: /save/i }));
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // ConflictDialog renders with the German heading from the component.
    await waitFor(() => screen.getByText(/Externe Änderung erkannt/i));
    // The remote diff content is visible after clicking "Side-by-Side ansehen".
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Side-by-Side ansehen/i }));
    });
    expect(screen.getByText(/OTHER MODEL/)).toBeTruthy();

    // "Verwerfen" closes the dialog and re-fetches.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verwerfen/i }));
    });
    expect(screen.queryByText(/Externe Änderung erkannt/i)).toBeNull();
  });

  it('saveAgent uses PUT when editing an existing agent and threads If-Match', async () => {
    setUseEtagFetch({ data: SAMPLE_PROJECT, etag: 'W/"abc"' });
    const fetchSpy = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
    const mod = await import('../$projectId.js');
    const Comp = mod.Route.component as React.FC;
    render(<Comp />);
    // Open the dev agent for edit, submit unchanged.
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    // The first "Edit" button is for the project; the per-agent edit follows.
    fireEvent.click(editButtons[editButtons.length - 1]);
    const saveBtn = await waitFor(() => screen.getByRole('button', { name: /save/i }));
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const lastCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes('/agents/dev'),
    );
    expect(lastCall).toBeDefined();
    const init = lastCall![1] as RequestInit;
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"abc"');
  });
});
