import React, { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/Modal.js';

export const Route = createFileRoute('/projects/$projectId/workflows')({
  component: WorkflowsListPage,
});

interface WorkflowSummary {
  name: string;
  description?: string;
  mtime: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

const STARTER_YAML = (name: string) =>
  `name: ${name}\ndescription: ""\nsteps:\n  - id: first-step\n    agent: dev@project\n    prompt: "What should the agent do?"\n    output: result\n`;

function WorkflowsListPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/workflows`;

  const { data, isLoading, error, refetch } = useQuery<WorkflowSummary[]>({
    queryKey: ['workflows', projectId],
    queryFn: async () => {
      const res = await fetch(listUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as WorkflowSummary[];
    },
  });

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Styled delete-confirm replaces window.confirm so the dialog respects
  // R22 a11y (focus trap, Esc-dismiss, return-focus-on-close).
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function createWorkflow() {
    if (!NAME_RE.test(newName)) {
      setCreateError('Name must be lowercase kebab-case (a-z0-9-_).');
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const res = await fetch(listUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, content: STARTER_YAML(newName) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      setCreating(false);
      setNewName('');
      await queryClient.invalidateQueries({ queryKey: ['workflows', projectId] });
      navigate({
        to: '/projects/$projectId/workflows/$workflowName',
        params: { projectId, workflowName: newName },
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkflow(name: string) {
    const res = await fetch(`${listUrl}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setDeleteTarget(null);
      await refetch();
    }
  }

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium"
        >
          New workflow
        </button>
      </div>

      {isLoading ? (
        <div className="text-xs text-zinc-500 py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 py-12 text-center" role="alert">
          Failed to load workflows: {String(error)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
          <p className="text-sm text-zinc-300">No workflows yet</p>
          <p className="text-xs text-zinc-500 mt-1">
            Create the first one — files land in{' '}
            <span className="font-mono">&lt;projectDir&gt;/workflows/</span>.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="workflows-list">
          {data.map((w) => (
            <li
              key={w.name}
              className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-4 flex items-start justify-between gap-3"
              data-testid={`workflow-row-${w.name}`}
            >
              <div className="min-w-0">
                <Link
                  to="/projects/$projectId/workflows/$workflowName"
                  params={{ projectId, workflowName: w.name }}
                  className="block text-sm font-semibold text-zinc-100 hover:text-indigo-300 no-underline font-mono truncate"
                >
                  {w.name}
                </Link>
                {w.description && (
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                    {w.description}
                  </p>
                )}
                <p className="text-[11px] text-zinc-600 mt-1">
                  last modified {new Date(w.mtime).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(w.name)}
                className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-400 hover:text-red-200 flex-shrink-0"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <Modal open onClose={() => setCreating(false)} ariaLabel="New workflow">
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">New workflow</h3>
          </div>
          <div className="p-5 space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-zinc-300 mb-1">
                Workflow name
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="publish-post"
                disabled={busy}
                aria-label="Workflow name"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
              />
              <span className="block text-[11px] text-zinc-500 mt-1">
                Lowercase kebab-case. File will be written as{' '}
                <span className="font-mono">{newName || 'name'}.yaml</span>.
              </span>
            </label>
            {createError && (
              <p role="alert" className="text-[11px] text-red-400">
                {createError}
              </p>
            )}
          </div>
          <div className="border-t border-zinc-800 px-5 py-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createWorkflow}
              disabled={busy || !newName}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create + open editor'}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          ariaLabel={`Delete workflow ${deleteTarget}`}
        >
          <div className="px-5 py-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Delete workflow</h3>
          </div>
          <div className="p-5 text-sm text-zinc-300">
            Delete <span className="font-mono">{deleteTarget}</span>? The YAML
            file on disk is removed; this cannot be undone from the UI.
          </div>
          <div className="border-t border-zinc-800 px-5 py-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteWorkflow(deleteTarget)}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium"
            >
              Delete workflow
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
