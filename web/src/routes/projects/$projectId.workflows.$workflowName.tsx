import React, { Suspense, lazy, useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEtagFetch } from '../../hooks/useEtagFetch.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';

export const Route = createFileRoute(
  '/projects/$projectId/workflows/$workflowName',
)({
  component: WorkflowEditorPage,
});

// Lazy-loaded so the ~3 MB Monaco bundle stays out of the main chunk.
// `default` import via the module's named export comes after a default
// re-export shim — see WorkflowEditor.tsx end.
const WorkflowEditor = lazy(async () => {
  const mod = await import('../../components/WorkflowEditor.js');
  return { default: mod.WorkflowEditor };
});

interface WorkflowFile {
  name: string;
  content: string;
  etag: string;
}

interface AgentSummary {
  id: string;
  projectId: string;
  type: string;
}

function WorkflowEditorPage() {
  const { projectId, workflowName } = Route.useParams();
  const navigate = useNavigate();
  const readUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowName)}`;
  const { data, etag, refetch, loading, error } = useEtagFetch<WorkflowFile>(readUrl);

  const agentsQuery = useQuery<AgentSummary[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch('/api/v1/agents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AgentSummary[];
    },
    staleTime: 30_000,
  });

  const knownAgents = useMemo(
    () => (agentsQuery.data ?? []).map((a) => a.id),
    [agentsQuery.data],
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    localContent: string;
    remoteContent: string;
  } | null>(null);

  const liveContent = draft ?? data?.content ?? '';
  const dirty = draft !== null && draft !== (data?.content ?? '');

  async function save() {
    if (draft === null) return;
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch(readUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: JSON.stringify({ content: draft }),
      });
      if (res.status === 412) {
        // Pull the on-disk version so the operator can compare.
        let remoteContent = '(failed to load current server state)';
        try {
          const fresh = await fetch(readUrl);
          if (fresh.ok) {
            const j = (await fresh.json()) as WorkflowFile;
            remoteContent = j.content;
          }
        } catch {
          /* leave placeholder */
        }
        setConflict({ localContent: draft, remoteContent });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      setDraft(null);
      await refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkflow() {
    if (!confirm(`Delete workflow "${workflowName}"?`)) return;
    const res = await fetch(readUrl, {
      method: 'DELETE',
      headers: etag ? { 'If-Match': etag } : {},
    });
    if (res.ok) navigate({ to: '/projects/$projectId/workflows', params: { projectId } });
  }

  if (loading && !data) {
    return <div className="p-6 text-xs text-zinc-500">Loading workflow…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-6 text-xs text-red-400" role="alert">
        Failed to load workflow: {error ? String(error.message) : 'not found'}{' '}
        <Link
          to="/projects/$projectId/workflows"
          params={{ projectId }}
          className="underline"
        >
          back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="workflow-editor-page">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <Link
            to="/projects/$projectId/workflows"
            params={{ projectId }}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 no-underline"
          >
            ← Workflows
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100 mt-1 font-mono">
            {workflowName}
          </h1>
          <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">{projectId}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button
            type="button"
            onClick={deleteWorkflow}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
          >
            Delete
          </button>
        </div>
      </div>

      {saveError && (
        <div
          role="alert"
          className="mb-3 bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
        >
          {saveError}
        </div>
      )}

      <Suspense
        fallback={
          <div className="border border-zinc-800 rounded-lg p-12 text-center text-xs text-zinc-500">
            Loading editor…
          </div>
        }
      >
        <WorkflowEditor
          value={liveContent}
          onChange={(next) => setDraft(next)}
          knownAgents={knownAgents}
        />
      </Suspense>

      <p className="mt-3 text-[11px] text-zinc-500">
        Trigger snippets with{' '}
        <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Ctrl+Space</kbd>{' '}
        (Win/Linux) or{' '}
        <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">⌃Space</kbd>{' '}
        (macOS). Agents that don't exist in pragents.yaml show a yellow warning marker.
      </p>

      {conflict && (
        <ConflictDialog
          open
          localContent={conflict.localContent}
          remoteContent={conflict.remoteContent}
          onDiscard={async () => {
            // Keep the operator's edits but dismiss the dialog — they can
            // copy fragments out of the side-by-side and re-save manually.
            setConflict(null);
          }}
          onReload={async () => {
            setConflict(null);
            setDraft(null);
            await refetch();
          }}
          onClose={() => setConflict(null)}
        />
      )}
    </div>
  );
}
