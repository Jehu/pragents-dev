import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));

import * as TanStackQuery from '@tanstack/react-query';

type AnyFn = (...args: unknown[]) => unknown;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Projects index route', () => {
  it('renders cards for each returned project', async () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: [
        { id: 'blog', name: 'Blog', directory: '~/blog' },
        { id: 'shop', name: 'Shop', directory: '~/shop' },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const mod = await import('../index.js');
    const route: any = mod.Route;
    const Comp = (route.options?.component ?? route.component) as React.FC;
    render(<Comp />);

    expect(screen.getByText('Blog')).toBeTruthy();
    expect(screen.getByText('Shop')).toBeTruthy();
    expect(screen.getByTestId('project-card-blog')).toBeTruthy();
    expect(screen.getByTestId('project-card-shop')).toBeTruthy();
  });

  it('shows the empty state when no projects are returned', async () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const mod = await import('../index.js');
    const route: any = mod.Route;
    const Comp = (route.options?.component ?? route.component) as React.FC;
    render(<Comp />);
    await waitFor(() => screen.getByText(/No projects yet/i));
  });

  it('shows loading state', async () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    const mod = await import('../index.js');
    const route: any = mod.Route;
    const Comp = (route.options?.component ?? route.component) as React.FC;
    render(<Comp />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });
});
