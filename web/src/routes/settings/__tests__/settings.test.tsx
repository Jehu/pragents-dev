import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Router mock (file-based route helper resolves to plain options object) ──

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));

// ─── Tiny ETag-fetch double the route uses to hydrate sections ──────────────

const useEtagFetch = vi.fn();
vi.mock('../../../hooks/useEtagFetch.js', () => ({
  useEtagFetch: (...args: unknown[]) => useEtagFetch(...args),
}));

const SAMPLE_DATA = {
  costs: { 'anthropic/claude-sonnet': { in: 3, out: 15 } },
  pool: { maxWarmSessions: 10 },
  chat: { classifierThreshold: 0.7 },
  interfaces: { web: { port: 3000, host: 'localhost' } },
  company: {
    name: 'Acme',
    autoApproveSkills: false,
    similarityThreshold: 0.8,
    skillApproval: { confidenceThreshold: 0.9, blockedTools: ['bash'] },
    agents: {
      office: { type: 'office', model: 'deepseek/v4', personality: 'helper' },
    },
  },
};

function mockHappy() {
  useEtagFetch.mockReturnValue({
    data: SAMPLE_DATA,
    etag: 'W/"abc"',
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  useEtagFetch.mockReset();
  vi.spyOn(global, 'fetch' as any).mockImplementation(((_url: any, init: any) => {
    const method = init?.method ?? 'GET';
    if (method === 'PUT' || method === 'POST' || method === 'DELETE') {
      return Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json', ETag: 'W/"new"' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(SAMPLE_DATA), {
        status: 200,
        headers: { 'content-type': 'application/json', ETag: 'W/"abc"' },
      }),
    );
  }) as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderRoute() {
  const mod = await import('../index.js');
  const route: any = mod.Route;
  const Comp = (route.options?.component ?? route.component) as React.FC;
  render(<Comp />);
}

describe('Settings page', () => {
  it('renders a loading state until data arrives', async () => {
    useEtagFetch.mockReturnValue({
      data: null,
      etag: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    await renderRoute();
    expect(screen.getByText(/Loading settings/i)).toBeTruthy();
  });

  it('renders every section once the snapshot is hydrated', async () => {
    mockHappy();
    await renderRoute();

    expect(screen.getByTestId('section-company')).toBeTruthy();
    expect(screen.getByTestId('section-company-agent-office')).toBeTruthy();
    expect(screen.getByTestId('section-company-agent-pm')).toBeTruthy();
    expect(screen.getByTestId('section-skill-approval')).toBeTruthy();
    expect(screen.getByTestId('section-pool')).toBeTruthy();
    expect(screen.getByTestId('section-chat')).toBeTruthy();
    expect(screen.getByTestId('section-interfaces')).toBeTruthy();
    expect(screen.getByTestId('section-costs')).toBeTruthy();
  });

  it('hydrates the pool field with the snapshot value', async () => {
    mockHappy();
    await renderRoute();
    const pool = screen.getByLabelText('Max warm sessions') as HTMLInputElement;
    expect(pool.value).toBe('10');
  });

  it('lights up Save only when a field actually changes', async () => {
    mockHappy();
    await renderRoute();
    // PoolForm is the most compact section to drive.
    const section = screen.getByTestId('section-pool');
    const save = section.querySelector('button[type="button"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const pool = screen.getByLabelText('Max warm sessions') as HTMLInputElement;
    fireEvent.change(pool, { target: { value: '12' } });
    await waitFor(() => expect(save.disabled).toBe(false));
  });

  it('PUTs the pool section on save', async () => {
    mockHappy();
    await renderRoute();
    const pool = screen.getByLabelText('Max warm sessions') as HTMLInputElement;
    fireEvent.change(pool, { target: { value: '12' } });

    const section = screen.getByTestId('section-pool');
    const save = section.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls as any[][];
      const put = calls.find(
        (c) => c[1]?.method === 'PUT' && String(c[0]).endsWith('/settings/pool'),
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1].body);
      expect(body).toEqual({ maxWarmSessions: 12 });
      expect(put![1].headers['If-Match']).toBe('W/"abc"');
    });
  });

  it('shows an error banner when the server responds non-OK', async () => {
    mockHappy();
    (global.fetch as any).mockImplementationOnce(((_url: any, init: any) => {
      if (init?.method === 'GET' || !init) {
        return Promise.resolve(
          new Response(JSON.stringify(SAMPLE_DATA), {
            status: 200,
            headers: { 'content-type': 'application/json', ETag: 'W/"abc"' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'boom' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any);
    // Force the next PUT specifically to fail.
    (global.fetch as any).mockImplementation(((_url: any, init: any) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'boom' }), { status: 400 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(SAMPLE_DATA), {
          status: 200,
          headers: { ETag: 'W/"abc"' },
        }),
      );
    }) as any);

    await renderRoute();
    const pool = screen.getByLabelText('Max warm sessions') as HTMLInputElement;
    fireEvent.change(pool, { target: { value: '12' } });
    const section = screen.getByTestId('section-pool');
    const save = section.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() => {
      expect(section.textContent).toMatch(/boom/);
    });
  });

  it('opens a ConflictDialog on 412', async () => {
    mockHappy();
    (global.fetch as any).mockImplementation(((_url: any, init: any) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'stale' }), { status: 412 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(SAMPLE_DATA), {
          status: 200,
          headers: { ETag: 'W/"abc"' },
        }),
      );
    }) as any);

    await renderRoute();
    const pool = screen.getByLabelText('Max warm sessions') as HTMLInputElement;
    fireEvent.change(pool, { target: { value: '12' } });
    const section = screen.getByTestId('section-pool');
    const save = section.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(save);

    await waitFor(() => {
      expect(screen.getByText(/Externe Änderung erkannt/)).toBeTruthy();
    });
  });

  it('hydrates the company stammdaten field from the snapshot', async () => {
    mockHappy();
    await renderRoute();
    const name = screen.getByLabelText('Company name') as HTMLInputElement;
    expect(name.value).toBe('Acme');
  });

  it('targets the right endpoint when saving the company agent office section', async () => {
    mockHappy();
    await renderRoute();
    const personality = screen.getByLabelText('office personality') as HTMLTextAreaElement;
    fireEvent.change(personality, { target: { value: 'Refined office helper' } });
    const section = screen.getByTestId('section-company-agent-office');
    const save = section.querySelector('button[type="button"]') as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls as any[][];
      const put = calls.find(
        (c) =>
          c[1]?.method === 'PUT' &&
          String(c[0]).endsWith('/settings/company/agents/office'),
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(put![1].body);
      expect(body.type).toBe('office');
      expect(body.personality).toBe('Refined office helper');
    });
  });

  it('keeps the company-agent Save disabled on mount (no spurious dirty)', async () => {
    // Review fix Critical #1: the form must not flag dirty before the user
    // edits anything. Both office (configured) and pm (missing) must stay
    // un-savable until the operator changes a field.
    mockHappy();
    await renderRoute();
    const officeSection = screen.getByTestId('section-company-agent-office');
    const officeSave = officeSection.querySelector('button[type="button"]') as HTMLButtonElement;
    expect(officeSave.disabled).toBe(true);

    const pmSection = screen.getByTestId('section-company-agent-pm');
    const pmSave = pmSection.querySelector('button[type="button"]') as HTMLButtonElement;
    expect(pmSave.disabled).toBe(true);
  });

  it('refuses to save an empty pm-agent slot when none exists yet (Critical #2)', async () => {
    // Even after the user wiggles a UI control that does not add substantive
    // content (e.g. flipping memory access), Save must stay disabled — the
    // form must not silently materialise a brand-new agent block.
    mockHappy();
    await renderRoute();

    // Section status banner should announce the empty slot.
    const pmSection = screen.getByTestId('section-company-agent-pm');
    expect(pmSection.textContent).toMatch(/No agent configured yet/);

    const pmSave = pmSection.querySelector('button[type="button"]') as HTMLButtonElement;
    // Toggle a non-substantive memory radio — Save must still be disabled.
    const memoryReadOnly = pmSection.querySelectorAll(
      'input[type="radio"][value="read"]',
    )[0] as HTMLInputElement;
    if (memoryReadOnly) fireEvent.click(memoryReadOnly);
    await waitFor(() => expect(pmSave.disabled).toBe(true));

    // Now type a model — that's substantive, Save should unlock.
    const modelInput = screen.getByLabelText('pm model') as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: 'anthropic/x' } });
    await waitFor(() => expect(pmSave.disabled).toBe(false));
  });

  it('keeps CompanyForm Save disabled when the name is cleared', async () => {
    mockHappy();
    await renderRoute();
    const name = screen.getByLabelText('Company name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '' } });

    const section = screen.getByTestId('section-company');
    const save = section.querySelector('button[type="button"]') as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(true));
    // Inline validation surfaces the error.
    expect(section.textContent).toMatch(/Company name is required/);
  });

  it('CostsForm: + Add model creates a new editable row', async () => {
    mockHappy();
    await renderRoute();
    const section = screen.getByTestId('section-costs');
    const before = section.querySelectorAll('[data-testid^="cost-row-"]').length;
    const add = Array.from(section.querySelectorAll('button')).find((b) =>
      /Add model/.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    fireEvent.click(add);
    await waitFor(() => {
      const after = section.querySelectorAll('[data-testid^="cost-row-"]').length;
      expect(after).toBe(before + 1);
    });
  });

  it('CostsForm: removing the last row leaves the section saveable as dirty', async () => {
    mockHappy();
    await renderRoute();
    const section = screen.getByTestId('section-costs');
    const removeButton = section.querySelector(
      'button[aria-label^="Remove row"]',
    ) as HTMLButtonElement;
    expect(removeButton).toBeTruthy();
    fireEvent.click(removeButton);
    const save = Array.from(section.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save' || b.textContent === 'Saving…',
    ) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
  });
});
