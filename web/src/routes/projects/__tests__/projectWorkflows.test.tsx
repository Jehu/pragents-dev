import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── TanStack mocks (same shape as existing project route tests) ─────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));

import * as TanStackQuery from '@tanstack/react-query';

type AnyFn = (...args: unknown[]) => unknown;

beforeEach(() => {
  vi.spyOn(global, 'fetch' as any).mockImplementation(((url: any, init: any) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ name: 'newone', etag: 'W/"x"' }), {
          status: 201,
        }),
      );
    }
    return Promise.resolve(
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderListRoute(params = { projectId: 'alpha' }) {
  const mod = await import('../$projectId.workflows.js');
  const route: any = mod.Route;
  // The route component reads Route.useParams() — stub it.
  (route as any).useParams = () => params;
  const Comp = (route.options?.component ?? route.component) as React.FC;
  render(<Comp />);
}

describe('Workflows list route', () => {
  it('renders the empty state when the project has no workflows', async () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    await renderListRoute();
    expect(screen.getByText(/No workflows yet/)).toBeTruthy();
  });

  it('renders rows for each returned workflow', async () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: [
        { name: 'publish-post', description: 'Publish a post', mtime: 0 },
        { name: 'audit-skills', description: undefined, mtime: 0 },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    await renderListRoute();
    expect(screen.getByTestId('workflow-row-publish-post')).toBeTruthy();
    expect(screen.getByTestId('workflow-row-audit-skills')).toBeTruthy();
  });

  it('opens the new-workflow modal and validates the name', async () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    await renderListRoute();
    fireEvent.click(screen.getByRole('button', { name: /new workflow/i }));
    const nameInput = screen.getByLabelText('Workflow name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'BAD NAME' } });
    const submit = screen.getByRole('button', { name: /create \+ open editor/i });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/kebab-case/i);
    });
  });
});
