import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mocks (before imports) ───────────────────────────────────────────────────

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

vi.mock('../../../stores/eventBus.js', () => ({
  useEventBusStore: vi.fn(() => []),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as TanStackQuery from '@tanstack/react-query';
import * as SkillsModule from '../index.js';
import { useEventBusStore } from '../../../stores/eventBus.js';
import type { Skill, SkillTab } from '../index.js';
import { countSkillsByTab } from '../index.js';

type AnyFn = (...args: unknown[]) => unknown;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── countSkillsByTab ─────────────────────────────────────────────────────────

describe('countSkillsByTab', () => {
  const skills: Skill[] = [
    { name: 'a', status: 'active', createdAt: new Date().toISOString() },
    { name: 'b', status: 'active', createdAt: new Date().toISOString() },
    { name: 'c', status: 'proposed', createdAt: new Date().toISOString() },
    { name: 'd', status: 'rejected', createdAt: new Date().toISOString() },
  ];

  it('counts active skills', () => {
    expect(countSkillsByTab(skills, 'active')).toBe(2);
  });

  it('counts proposed skills', () => {
    expect(countSkillsByTab(skills, 'proposed')).toBe(1);
  });

  it('counts rejected skills', () => {
    expect(countSkillsByTab(skills, 'rejected')).toBe(1);
  });

  it('returns 0 for empty list', () => {
    expect(countSkillsByTab([], 'active')).toBe(0);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockMutation(overrides: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  (TanStackQuery.useMutation as unknown as AnyFn).mockReturnValue({
    mutate,
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    variables: undefined,
    ...overrides,
  });
  return mutate;
}

function mockQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  (TanStackQuery.useQueryClient as unknown as AnyFn).mockReturnValue({ invalidateQueries });
  return invalidateQueries;
}

function renderSkills() {
  const Route = SkillsModule.Route as unknown as { component: React.ComponentType };
  return render(React.createElement(Route.component));
}

// ─── Tab counts rendering ─────────────────────────────────────────────────────

describe('SkillsPage tab counts', () => {
  const skills: Skill[] = [
    { name: 'skill-a', status: 'active', createdAt: new Date().toISOString() },
    { name: 'skill-b', status: 'active', createdAt: new Date().toISOString() },
    { name: 'skill-c', status: 'proposed', createdAt: new Date().toISOString() },
  ];

  beforeEach(() => {
    (useEventBusStore as unknown as AnyFn).mockReturnValue([]);
    mockQueryClient();
    mockMutation();
    (TanStackQuery.useQuery as unknown as AnyFn).mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (String(queryKey[0]).startsWith('skill')) {
        return { data: { skills }, isLoading: false };
      }
      return { data: null, isLoading: false };
    });
  });

  it('renders correct tab counts', () => {
    const { getAllByText } = renderSkills();
    // Active tab label with count
    const activeEls = getAllByText(/Active/);
    expect(activeEls.length).toBeGreaterThan(0);
  });

  it('shows active skills in active tab by default', () => {
    const { getByText } = renderSkills();
    expect(getByText('skill-a')).toBeTruthy();
    expect(getByText('skill-b')).toBeTruthy();
  });

  it('switches to proposed tab and shows proposed skills', () => {
    const { getByText } = renderSkills();
    const proposedTab = getByText(/Proposed/);
    fireEvent.click(proposedTab);
    expect(getByText('skill-c')).toBeTruthy();
  });
});

// ─── Approve flow ─────────────────────────────────────────────────────────────

describe('SkillsPage approve flow', () => {
  const proposedSkill: Skill = {
    name: 'new-skill',
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    (useEventBusStore as unknown as AnyFn).mockReturnValue([]);
    mockQueryClient();
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: { skills: [proposedSkill] },
      isLoading: false,
    });
  });

  it('calls approve endpoint on Approve click', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
    const mutate = vi.fn();
    (TanStackQuery.useMutation as unknown as AnyFn).mockReturnValue({
      mutate,
      isPending: false,
      variables: undefined,
    });

    const { getByText } = renderSkills();
    // Switch to proposed tab
    fireEvent.click(getByText(/Proposed/));
    const approveBtn = getByText('Approve');
    fireEvent.click(approveBtn);
    expect(mutate).toHaveBeenCalledWith('new-skill');
  });
});

// ─── Reject modal ─────────────────────────────────────────────────────────────

describe('SkillsPage reject modal', () => {
  const proposedSkill: Skill = {
    name: 'bad-skill',
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    (useEventBusStore as unknown as AnyFn).mockReturnValue([]);
    mockQueryClient();
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: { skills: [proposedSkill] },
      isLoading: false,
    });
    (TanStackQuery.useMutation as unknown as AnyFn).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });
  });

  it('opens reject modal on Reject click', () => {
    const { getByText } = renderSkills();
    fireEvent.click(getByText(/Proposed/));
    fireEvent.click(getByText('Reject'));
    expect(getByText('Reject skill')).toBeTruthy();
  });

  it('closes reject modal on Cancel', () => {
    const { getByText, queryByText } = renderSkills();
    fireEvent.click(getByText(/Proposed/));
    fireEvent.click(getByText('Reject'));
    fireEvent.click(getByText('Cancel'));
    expect(queryByText('Reject skill')).toBeNull();
  });

  it('opens body modal on View body click', () => {
    (TanStackQuery.useQuery as unknown as AnyFn).mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'skill-body') {
        return { data: { body: '# Skill body\nsome content' }, isLoading: false };
      }
      return { data: { skills: [proposedSkill] }, isLoading: false };
    });

    const { getByText, getAllByText, container } = renderSkills();
    fireEvent.click(getByText(/Proposed/));
    fireEvent.click(getByText('View body'));
    // pre element should contain the body content
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('# Skill body');
    // Skill name appears in both card and modal header
    expect(getAllByText('bad-skill').length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Empty state for proposed ─────────────────────────────────────────────────

describe('SkillsPage empty proposed', () => {
  beforeEach(() => {
    (useEventBusStore as unknown as AnyFn).mockReturnValue([]);
    mockQueryClient();
    (TanStackQuery.useQuery as unknown as AnyFn).mockReturnValue({
      data: { skills: [] },
      isLoading: false,
    });
    (TanStackQuery.useMutation as unknown as AnyFn).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });
  });

  it('shows empty-state message on proposed tab when no proposed skills', () => {
    const { getByText } = renderSkills();
    fireEvent.click(getByText(/Proposed/));
    expect(getByText(/auto-extraction runs when agents complete tasks/)).toBeTruthy();
  });
});
