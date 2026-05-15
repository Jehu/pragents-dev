import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import {
  ProjectDetailContext,
  type ProjectDetailContextValue,
} from '../$projectId.js';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  Outlet: () => null,
  useNavigate: () => vi.fn(),
}));

const SAMPLE_PROJECT = {
  id: 'alpha',
  name: 'Alpha',
  directory: '~/alpha',
  agents: {
    dev: {
      type: 'dev' as const,
      model: 'claude-sonnet',
      personality: 'helpful dev',
      capabilities: ['ts'],
      memory: { project: 'read/write' as const },
      keepWarm: false,
    },
  },
};

function makeCtx(): ProjectDetailContextValue {
  return {
    projectId: 'alpha',
    data: SAMPLE_PROJECT,
    etag: 'W/"abc"',
    readUrl: '/api/v1/projects/alpha',
    refresh: vi.fn().mockResolvedValue(undefined),
  };
}

async function renderAgentsTab(ctx: ProjectDetailContextValue = makeCtx()) {
  const mod = await import('../$projectId.index.js');
  const Comp = (mod.Route as any).component as React.FC;
  render(
    <ProjectDetailContext.Provider value={ctx}>
      <Comp />
    </ProjectDetailContext.Provider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ProjectAgentsTab', () => {
  it('shows the configured dev agent and offers slots for missing types', async () => {
    await renderAgentsTab();
    expect(screen.getByText('dev')).toBeTruthy();
    expect(screen.getAllByText(/Add/i).length).toBeGreaterThan(0);
  });

  it('saveAgent uses PUT with If-Match when editing an existing agent', async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await renderAgentsTab();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
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

  it('renders ConflictDialog when saveAgent gets 412 from the server', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init && init.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'stale' }), { status: 412 });
      }
      return new Response(
        JSON.stringify({
          id: 'alpha',
          name: 'Alpha',
          directory: '~/alpha',
          agents: { dev: { type: 'dev', model: 'OTHER MODEL' } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderAgentsTab();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const saveBtn = await waitFor(() => screen.getByRole('button', { name: /save/i }));
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => screen.getByText(/Externe Änderung erkannt/i));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Side-by-Side ansehen/i }));
    });
    expect(screen.getByText(/OTHER MODEL/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verwerfen/i }));
    });
    expect(screen.queryByText(/Externe Änderung erkannt/i)).toBeNull();
  });
});
