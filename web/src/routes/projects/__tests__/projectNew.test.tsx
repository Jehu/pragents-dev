import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => {
    const route = opts as { component: React.FC };
    return Object.assign(route, {
      useSearch: () => ({ duplicate: undefined }),
    });
  },
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => mockNavigate,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockNavigate.mockClear();
  mockInvalidate.mockClear();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id: 'blog' }), { status: 201 })),
  );
});

async function loadRoute() {
  const mod = await import('../new.js');
  return mod.Route.component as React.FC;
}

// ─── Wizard ──────────────────────────────────────────────────────────────────

describe('NewProjectPage wizard', () => {
  it('starts on step 1 (Project details)', async () => {
    const Comp = await loadRoute();
    render(<Comp />);
    expect(screen.getByText(/Step 1 of 2/)).toBeTruthy();
    expect(screen.getByLabelText('Project ID')).toBeTruthy();
  });

  it('advances to step 2 after a valid project form submit', async () => {
    const Comp = await loadRoute();
    render(<Comp />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Blog' } });
    fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '~/blog' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    expect(screen.getByText(/Step 2 of 2/)).toBeTruthy();
  });

  it('Skip-agents path: submits POST with empty agents map', async () => {
    const Comp = await loadRoute();
    render(<Comp />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Blog' } });
    fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '~/blog' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    // Click "Create project" without adding agents.
    const create = screen.getByRole('button', { name: /create project/i });
    await act(async () => {
      fireEvent.click(create);
    });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/projects');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string) as {
      id: string;
      agents: Record<string, unknown>;
    };
    expect(body.id).toBe('blog');
    expect(body.agents).toEqual({});
  });

  it('adds agents to the POST body keyed by type', async () => {
    const Comp = await loadRoute();
    render(<Comp />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Blog' } });
    fireEvent.change(screen.getByLabelText('Directory'), { target: { value: '~/blog' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    // Open Add-agent → AgentForm appears → submit defaults.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add agent$/i }));
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'claude-sonnet' },
    });
    // After the form opens, two buttons match /add agent/ — the header
    // trigger and the form submit. The form submit is type="submit".
    const submitAgent = await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /add agent/i });
      const submit = buttons.find((b) => (b as HTMLButtonElement).type === 'submit');
      if (!submit) throw new Error('submit button not found');
      return submit;
    });
    await act(async () => {
      fireEvent.click(submitAgent);
    });
    // Now create.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const lastCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse((lastCall[1] as RequestInit).body as string) as {
      agents: Record<string, { model?: string }>;
    };
    expect(Object.keys(body.agents)).toHaveLength(1);
    expect(Object.values(body.agents)[0].model).toBe('claude-sonnet');
  });
});
