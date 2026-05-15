import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import { DeleteProjectModal } from '../DeleteProjectModal.js';

afterEach(() => {
  cleanup();
});

describe('DeleteProjectModal', () => {
  it('lists configured agents on open', () => {
    render(
      <DeleteProjectModal
        open
        projectId="blog"
        projectName="Blog"
        configuredAgents={['dev', 'seo']}
        onDelete={async () => ({ ok: true, status: 200 })}
        onClose={() => {}}
      />,
    );
    const list = screen.getByTestId('configured-agents');
    expect(list.textContent).toContain('dev');
    expect(list.textContent).toContain('seo');
  });

  it('blocks confirm with banner when server returns 409 with active agents', async () => {
    const onDelete = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      activeAgents: ['blog-dev', 'blog-seo'],
      error: 'active sessions',
    });
    render(
      <DeleteProjectModal
        open
        projectId="blog"
        projectName="Blog"
        configuredAgents={['dev', 'seo']}
        onDelete={onDelete}
        onClose={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: /confirm delete/i });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => screen.getByTestId('active-session-block'));
    expect(screen.getByText(/Cannot delete:/i)).toBeTruthy();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows retry from blocked → succeeds on second attempt (I3)', async () => {
    const onSuccess = vi.fn();
    const onDelete = vi
      .fn()
      // First call: blocked.
      .mockResolvedValueOnce({ ok: false, status: 409, activeAgents: ['blog-dev'] })
      // Second call: success.
      .mockResolvedValueOnce({ ok: true, status: 200 });

    render(
      <DeleteProjectModal
        open
        projectId="blog"
        projectName="Blog"
        configuredAgents={['dev']}
        onDelete={onDelete}
        onClose={() => {}}
        onSuccess={onSuccess}
      />,
    );
    const confirm = screen.getByRole('button', { name: /confirm delete/i });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => screen.getByTestId('active-session-block'));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // User stops sessions externally, clicks "Try again".
    const retry = screen.getByTestId('retry-delete');
    await act(async () => {
      fireEvent.click(retry);
    });
    // Banner cleared, confirm re-enabled.
    expect(screen.queryByTestId('active-session-block')).toBeNull();
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('shows retry button after generic error and clears it on click', async () => {
    const onDelete = vi.fn().mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    render(
      <DeleteProjectModal
        open
        projectId="blog"
        projectName="Blog"
        configuredAgents={[]}
        onDelete={onDelete}
        onClose={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    });
    await waitFor(() => screen.getByText(/boom/));
    const retry = screen.getByTestId('retry-delete');
    expect(retry).toBeTruthy();
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(screen.queryByText(/boom/)).toBeNull();
  });

  it('calls onSuccess on a successful delete', async () => {
    const onSuccess = vi.fn();
    render(
      <DeleteProjectModal
        open
        projectId="blog"
        projectName="Blog"
        configuredAgents={[]}
        onDelete={async () => ({ ok: true, status: 200 })}
        onClose={() => {}}
        onSuccess={onSuccess}
      />,
    );
    const confirm = screen.getByRole('button', { name: /confirm delete/i });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
