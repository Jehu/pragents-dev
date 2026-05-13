import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
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

vi.mock('../../../stores/eventBus.js', () => ({
  useEventBusStore: vi.fn(() => []),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as TanStackQuery from '@tanstack/react-query';
import * as WorkflowsModule from '../index.js';
import { useEventBusStore } from '../../../stores/eventBus.js';

type AnyFn = (...args: unknown[]) => unknown;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  (TanStackQuery.useQueryClient as unknown as AnyFn).mockReturnValue({ invalidateQueries });
  return invalidateQueries;
}

function renderWorkflows(wfData: unknown, runsData: unknown) {
  (useEventBusStore as unknown as AnyFn).mockReturnValue([]);
  mockQueryClient();
  (TanStackQuery.useQuery as unknown as AnyFn).mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'workflows') return { data: wfData, isLoading: false };
    if (queryKey[0] === 'workflow-runs') return { data: runsData, isLoading: false };
    return { data: null, isLoading: false };
  });
  const Page = WorkflowsModule.WorkflowsPage;
  return render(React.createElement(Page));
}

// ─── Empty state ───────────────────────────────────────────────────────────────

describe('WorkflowsPage empty state', () => {
  it('shows empty state when no runs', () => {
    const { getByText } = renderWorkflows([], []);
    expect(getByText(/No runs yet/)).toBeTruthy();
  });

  it('shows empty workflows message when no workflows', () => {
    const { getAllByText } = renderWorkflows([], []);
    // EmptyState renders both a title "No workflows" and a description
    expect(getAllByText(/No workflows/).length).toBeGreaterThan(0);
  });
});

// ─── Workflow cards ───────────────────────────────────────────────────────────

describe('WorkflowsPage workflow cards', () => {
  const wfs = [
    { name: 'deploy-prod', description: 'Deploys to production', stepCount: 3 },
    { name: 'nightly-report', description: 'Generates daily report', trigger: 'cron' },
  ];

  it('renders workflow names', () => {
    const { getByText } = renderWorkflows(wfs, []);
    expect(getByText('deploy-prod')).toBeTruthy();
    expect(getByText('nightly-report')).toBeTruthy();
  });

  it('renders trigger badge when present', () => {
    const { getByText } = renderWorkflows(wfs, []);
    expect(getByText('cron')).toBeTruthy();
  });

  it('renders step count', () => {
    const { getByText } = renderWorkflows(wfs, []);
    expect(getByText('3 steps')).toBeTruthy();
  });
});

// ─── Run list ─────────────────────────────────────────────────────────────────

describe('WorkflowsPage run list', () => {
  const now = new Date().toISOString();
  const runs = [
    {
      id: 'run-1',
      workflowName: 'deploy-prod',
      status: 'complete',
      startedAt: now,
      completedAt: now,
      steps: [],
    },
    {
      id: 'run-2',
      workflowName: 'nightly-report',
      status: 'running',
      startedAt: now,
      steps: [],
    },
  ];

  it('renders run workflow names', () => {
    const { getAllByText } = renderWorkflows([], runs);
    // deploy-prod appears in run list
    expect(getAllByText('deploy-prod').length).toBeGreaterThan(0);
  });

  it('expands run on click to show step area', () => {
    const { getAllByText, getByText } = renderWorkflows([], runs);
    const deployRows = getAllByText('deploy-prod');
    fireEvent.click(deployRows[0].closest('button') ?? deployRows[0]);
    expect(getByText('No steps recorded.')).toBeTruthy();
  });
});

// ─── Step rendering with gate highlight ───────────────────────────────────────

describe('WorkflowsPage gate highlight', () => {
  const now = new Date().toISOString();
  const runsWithGate = [
    {
      id: 'run-gate',
      workflowName: 'gated-flow',
      status: 'running',
      startedAt: now,
      steps: [
        {
          id: 'step-1',
          stepId: 'validate',
          status: 'complete',
          gateStatus: null,
        },
        {
          id: 'step-2',
          stepId: 'human-review',
          status: 'pending',
          gateStatus: 'pending',
        },
        {
          id: 'step-3',
          stepId: 'deploy',
          status: 'pending',
          gateStatus: null,
        },
      ],
    },
  ];

  it('shows "gate pending" badge on run with pending gate step', () => {
    const { getByText } = renderWorkflows([], runsWithGate);
    expect(getByText('gate pending')).toBeTruthy();
  });

  it('shows "waiting on gate" pill and inbox link on gate step', () => {
    const { getByText, getAllByText } = renderWorkflows([], runsWithGate);
    // Expand the run
    const runBtn = getByText('gated-flow').closest('button');
    fireEvent.click(runBtn!);
    expect(getByText('waiting on gate')).toBeTruthy();
    expect(getByText('Review in inbox →')).toBeTruthy();
  });
});

// ─── Failed step error expander ───────────────────────────────────────────────

describe('WorkflowsPage failed step error', () => {
  const now = new Date().toISOString();
  const runsWithFailed = [
    {
      id: 'run-fail',
      workflowName: 'fail-flow',
      status: 'failed',
      startedAt: now,
      steps: [
        {
          id: 'step-f1',
          stepId: 'broken-step',
          status: 'failed',
          error: 'Connection refused to database',
          gateStatus: null,
        },
      ],
    },
  ];

  it('shows error expander button for failed step', () => {
    const { getByText } = renderWorkflows([], runsWithFailed);
    // Expand run
    fireEvent.click(getByText('fail-flow').closest('button')!);
    expect(getByText('error ▼')).toBeTruthy();
  });

  it('expands and collapses error on click', () => {
    const { getByText, queryByText } = renderWorkflows([], runsWithFailed);
    fireEvent.click(getByText('fail-flow').closest('button')!);
    const errorBtn = getByText('error ▼');
    fireEvent.click(errorBtn);
    expect(getByText('Connection refused to database')).toBeTruthy();
    fireEvent.click(getByText('hide error ▲'));
    expect(queryByText('Connection refused to database')).toBeNull();
  });
});

// ─── Notice banner ────────────────────────────────────────────────────────────

describe('WorkflowsPage notice banner', () => {
  it('renders parallel-group notice', () => {
    const { getByText } = renderWorkflows([], []);
    expect(getByText(/Parallel-group nesting simplified/)).toBeTruthy();
  });
});
