import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// The page wraps `<WorkflowEditor>` in React.lazy + Suspense. We mock the
// module so jsdom never tries to instantiate Monaco (Web Workers + canvas
// breakage). The mock exposes a textarea that mirrors the editor's
// value/onChange contract, which is enough to drive Save/Diff/412 flows.

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({
    data: [{ id: 'dev@alpha', projectId: 'alpha', type: 'dev' }],
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    React.createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../hooks/useEtagFetch.js', () => ({
  useEtagFetch: vi.fn(),
}));

vi.mock('../../../hooks/useConflictDetection.js', () => ({
  useConflictDetection: vi.fn(),
}));

vi.mock('../../../components/WorkflowEditor.js', () => ({
  WorkflowEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) =>
    React.createElement('textarea', {
      'data-testid': 'mock-editor',
      'aria-label': 'Workflow content',
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));

import { useEtagFetch } from '../../../hooks/useEtagFetch.js';
import { useConflictDetection } from '../../../hooks/useConflictDetection.js';

const ORIGINAL = `name: publish-post\nsteps:\n  - id: draft\n    agent: dev@alpha\n    prompt: write\n`;

function mockFetch(impls: Record<string, (init?: any) => Response>) {
  return vi.spyOn(global, 'fetch' as any).mockImplementation(((url: any, init: any) => {
    const key = String(url);
    for (const pattern of Object.keys(impls)) {
      if (key.includes(pattern)) return Promise.resolve(impls[pattern](init));
    }
    return Promise.resolve(
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as any);
}

beforeEach(() => {
  (useEtagFetch as any).mockReturnValue({
    data: { name: 'publish-post', content: ORIGINAL, etag: 'W/"abc"' },
    etag: 'W/"abc"',
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  (useConflictDetection as any).mockReset();
});

async function renderEditorRoute(
  params = { projectId: 'alpha', workflowName: 'publish-post' },
) {
  const mod = await import('../$projectId.workflows.$workflowName.js');
  const route: any = mod.Route;
  (route as any).useParams = () => params;
  const Comp = (route.options?.component ?? route.component) as React.FC;
  render(<Comp />);
}

describe('Workflow editor route', () => {
  it('hydrates the editor with the on-disk content', async () => {
    await renderEditorRoute();
    const editor = await screen.findByTestId('mock-editor');
    expect((editor as HTMLTextAreaElement).value).toBe(ORIGINAL);
  });

  it('keeps Save disabled until the operator edits the draft (R1 dirty)', async () => {
    await renderEditorRoute();
    const save = screen.getByRole('button', { name: /save/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    const editor = await screen.findByTestId('mock-editor');
    fireEvent.change(editor, {
      target: { value: ORIGINAL + '  # edit\n' },
    });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  });

  it('opens a DiffPreview modal on Save click (R1 / R20)', async () => {
    mockFetch({
      '/api/v1/projects/alpha/workflows/publish-post': () =>
        new Response(
          JSON.stringify({ name: 'publish-post', content: ORIGINAL, etag: 'W/"abc"' }),
          { status: 200, headers: { 'content-type': 'application/json', ETag: 'W/"abc"' } },
        ),
    });
    await renderEditorRoute();
    const editor = await screen.findByTestId('mock-editor');
    fireEvent.change(editor, {
      target: { value: ORIGINAL + '  # edit\n' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByTestId('diff-preview')).toBeTruthy(),
    );
  });

  it('renders a ConflictDialog on 412 (R12 save-time)', async () => {
    mockFetch({
      '/api/v1/projects/alpha/workflows/publish-post': (init) => {
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({ error: 'stale' }), { status: 412 });
        }
        return new Response(
          JSON.stringify({ name: 'publish-post', content: ORIGINAL + '# remote\n', etag: 'W/"new"' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    await renderEditorRoute();
    const editor = await screen.findByTestId('mock-editor');
    fireEvent.change(editor, {
      target: { value: ORIGINAL + '# local\n' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    // Confirm the diff preview to trigger the PUT.
    const confirm = await screen.findByRole('button', { name: /speichern/i });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(screen.getByText(/Externe Änderung erkannt/)).toBeTruthy(),
    );
  });

  it('mounts useConflictDetection against the workflow URL (R12 tab-refocus)', async () => {
    await renderEditorRoute();
    expect(useConflictDetection).toHaveBeenCalled();
    const call = (useConflictDetection as any).mock.calls.at(-1)[0];
    expect(call.url).toMatch(/\/api\/v1\/projects\/alpha\/workflows\/publish-post$/);
    expect(call.currentEtag).toBe('W/"abc"');
    expect(typeof call.onStale).toBe('function');
  });

  it('uses a styled Modal (not window.confirm) for the delete confirmation (R22)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    await renderEditorRoute();
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    // The modal heading should appear; window.confirm must not have been called.
    expect(screen.getByRole('heading', { name: /Delete workflow/i })).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
