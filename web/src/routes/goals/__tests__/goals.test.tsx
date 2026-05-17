import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

function renderGoalsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return import('../index.js').then((mod) => {
    const Comp = (mod.Route as any).component as React.FC;
    render(
      <QueryClientProvider client={queryClient}>
        <Comp />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      if (path.endsWith('/api/v1/goals/runs')) {
        return new Response(JSON.stringify([
          {
            id: 'gr-1',
            goalId: 'weekly-article',
            workflowRunId: 'wf-1',
            status: 'complete',
            triggeredAt: new Date(Date.now() - 60_000).toISOString(),
            completedAt: new Date().toISOString(),
          },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([
        {
          id: 'weekly-article',
          description: 'Publish one article per week',
          cadence: '0 8 * * 1',
          deadline: '0 16 * * 5',
          workflow: 'content-pipeline',
          acceptance: ['article is published', 'min 1500 words'],
          humanGates: [{ step: 'after_draft', label: 'Review draft', timeout: '4h' }],
          nextTriggerAt: new Date(Date.now() + 86_400_000).toISOString(),
          nextDeadlineAt: new Date(Date.now() + 172_800_000).toISOString(),
        },
      ]), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GoalsPage', () => {
  it('renders goals as managed outcomes, not just scheduled workflows', async () => {
    await renderGoalsPage();

    await waitFor(() => expect(screen.getAllByText('weekly-article').length).toBeGreaterThan(0));
    expect(screen.getByText('Publish one article per week')).toBeTruthy();
    expect(screen.getByText('article is published')).toBeTruthy();
    expect(screen.getByText('min 1500 words')).toBeTruthy();
    expect(screen.getByText(/Review draft/)).toBeTruthy();
    expect(screen.getByText(/Next trigger/i)).toBeTruthy();
    expect(screen.getByText(/Deadline/i)).toBeTruthy();
    expect(screen.getByText('content-pipeline')).toBeTruthy();
    expect(screen.getByText('gr-1')).toBeTruthy();
  });
});
