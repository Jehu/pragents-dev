import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEtagFetch } from '../../hooks/useEtagFetch.js';
import { useConflictDetection } from '../../hooks/useConflictDetection.js';
import { Modal } from '../../components/Modal.js';
import { DiffPreview, type DiffPreviewState } from '../../components/DiffPreview.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';

export const Route = createFileRoute(
  '/projects/$projectId/workflows/$workflowName',
)({
  component: WorkflowEditorPage,
});

// Lazy-loaded so the Monaco bundle (~161 KB minified) stays out of the
// main chunk. ErrorBoundary below catches chunk-load failures (offline
// during deploy / stale hash) and renders a reload affordance.
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

/**
 * Save flow state machine, modelled after `routes/skills/$skillName.tsx`:
 * - `idle` — no save in progress, no preview open.
 * - `preview-loading` — fetching the server's current content to diff
 *   against the operator's draft (R1 DiffPreview-state-coverage).
 * - `preview` — the preview is rendered, operator can Confirm or Cancel.
 * - `conflict` — the PUT returned 412; show ConflictDialog with both sides.
 * - `read-failure` — the comparison read failed; surface the error inline.
 */
type SaveState =
  | { kind: 'idle' }
  | { kind: 'preview-loading' }
  | { kind: 'preview'; current: string }
  | { kind: 'conflict'; current: string }
  | { kind: 'read-failure'; message: string };

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
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set when `useConflictDetection` sees an external edit between mount
  // and tab-refocus. Cleared on refetch.
  const [staleBanner, setStaleBanner] = useState<string | null>(null);

  // R12 — tab-refocus stale-form detection. Fires a HEAD on the workflow
  // URL when the tab regains visibility; mismatching ETag → banner.
  useConflictDetection({
    url: readUrl,
    currentEtag: etag,
    onStale: (newEtag) => setStaleBanner(newEtag),
    enabled: !loading,
  });

  const liveContent = draft ?? data?.content ?? '';
  const baseline = data?.content ?? '';
  // Normalize CRLF before comparing — Windows operators editing in Monaco
  // can otherwise see Save light up on every keystroke even though no
  // semantically meaningful change happened.
  const normalize = (s: string) => s.replace(/\r\n/g, '\n');
  const dirty = draft !== null && normalize(draft) !== normalize(baseline);

  const openSavePreview = useCallback(() => {
    if (!dirty) return;
    setSaveState({ kind: 'preview-loading' });
    fetch(readUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fresh = (await res.json()) as WorkflowFile;
        setSaveState({ kind: 'preview', current: fresh.content });
      })
      .catch((err) =>
        setSaveState({
          kind: 'read-failure',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [dirty, readUrl]);

  const closeSavePreview = useCallback(() => setSaveState({ kind: 'idle' }), []);

  const confirmSave = useCallback(async () => {
    if (draft === null) return;
    setBusy(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (etag) headers['If-Match'] = etag;
      const res = await fetch(readUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ content: draft }),
      });
      if (res.status === 412) {
        const remoteRead = await fetch(readUrl);
        const remote = (await remoteRead.json()) as WorkflowFile;
        setSaveState({ kind: 'conflict', current: remote.content });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as any).error ?? `HTTP ${res.status}`);
      }
      setSaveState({ kind: 'idle' });
      setDraft(null);
      setStaleBanner(null);
      await refetch();
    } catch (err) {
      setSaveState({
        kind: 'read-failure',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [draft, etag, readUrl, refetch]);

  const deleteWorkflow = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(readUrl, {
        method: 'DELETE',
        headers: etag ? { 'If-Match': etag } : {},
      });
      if (res.ok) {
        navigate({
          to: '/projects/$projectId/workflows',
          params: { projectId },
        });
      }
    } finally {
      setBusy(false);
    }
  }, [etag, navigate, projectId, readUrl]);

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

  // Translate the local save-state into the DiffPreview component's
  // discriminator. Read-failure-during-confirm is also surfaced via this
  // state so the operator gets the retry button.
  const diffState: DiffPreviewState =
    saveState.kind === 'preview-loading'
      ? 'loading'
      : saveState.kind === 'preview'
        ? saveState.current === (draft ?? '')
          ? 'empty'
          : 'diff'
        : saveState.kind === 'conflict'
          ? 'conflict'
          : saveState.kind === 'read-failure'
            ? 'read-failure'
            : 'diff';
  const diffBefore =
    saveState.kind === 'preview' || saveState.kind === 'conflict'
      ? saveState.current
      : '';

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
            onClick={openSavePreview}
            disabled={!dirty || busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
          >
            {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
          >
            Delete
          </button>
        </div>
      </div>

      {staleBanner && (
        <div
          role="alert"
          className="mb-3 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-3"
        >
          <span>
            File changed externally since you opened the editor. Your draft
            still applies, but a Save will hit a conflict dialog.
          </span>
          <button
            type="button"
            onClick={async () => {
              setDraft(null);
              setStaleBanner(null);
              await refetch();
            }}
            className="text-[11px] px-2 py-1 rounded bg-amber-900/40 hover:bg-amber-800/40 text-amber-100"
          >
            Reload
          </button>
        </div>
      )}

      <Suspense
        fallback={
          <div className="border border-zinc-800 rounded-lg p-12 text-center text-xs text-zinc-500">
            Loading editor…
          </div>
        }
      >
        <EditorErrorBoundary onReload={() => location.reload()}>
          <WorkflowEditor
            value={liveContent}
            onChange={(next) => setDraft(next)}
            knownAgents={knownAgents}
          />
        </EditorErrorBoundary>
      </Suspense>

      <p className="mt-3 text-[11px] text-zinc-500">
        Trigger snippets with{' '}
        <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Ctrl+Space</kbd>{' '}
        (Win/Linux) or{' '}
        <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">⌃Space</kbd>{' '}
        (macOS). Agents that don't exist in pragents.yaml show a yellow warning marker.
      </p>

      {/* Diff preview modal — opens when the operator clicks Save. */}
      {(saveState.kind === 'preview-loading' ||
        saveState.kind === 'preview' ||
        saveState.kind === 'read-failure') && (
        <Modal
          open
          onClose={closeSavePreview}
          ariaLabel="Save preview"
          containerClassName="w-[900px] max-w-[95vw] max-h-[80vh] bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Save preview</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Diff against the current on-disk content.
            </p>
          </div>
          <DiffPreview
            state={diffState}
            before={diffBefore}
            after={draft ?? ''}
            onConfirm={confirmSave}
            onCancel={closeSavePreview}
            onRetry={openSavePreview}
            message={
              saveState.kind === 'read-failure' ? saveState.message : undefined
            }
          />
        </Modal>
      )}

      {/* Conflict dialog — opens when the PUT returned 412. */}
      {saveState.kind === 'conflict' && (
        <ConflictDialog
          open
          localContent={draft ?? ''}
          remoteContent={saveState.current}
          onDiscard={() => {
            // Keep the operator's edits but dismiss the dialog — they can
            // copy from the side-by-side view and re-save manually.
            setSaveState({ kind: 'idle' });
          }}
          onReload={async () => {
            setSaveState({ kind: 'idle' });
            setDraft(null);
            setStaleBanner(null);
            await refetch();
          }}
          onClose={() => setSaveState({ kind: 'idle' })}
        />
      )}

      {/* Styled delete-confirm modal (replaces window.confirm — R22 a11y). */}
      {deleting && (
        <Modal open onClose={() => setDeleting(false)} ariaLabel="Delete workflow">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Delete workflow</h3>
          </div>
          <div className="p-5 text-sm text-zinc-300">
            Delete <span className="font-mono">{workflowName}</span>? The YAML
            file on disk is removed; this cannot be undone from the UI.
          </div>
          <div className="border-t border-zinc-800 px-5 py-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setDeleting(false)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteWorkflow}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium disabled:opacity-40"
            >
              {busy ? 'Deleting…' : 'Delete workflow'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Tiny class component used only for catching `React.lazy` chunk-load
 * failures around the Monaco editor. Re-rendering the boundary after
 * the operator clicks Reload either picks up the new chunk (if the
 * deploy completed) or surfaces the error again — both are better than
 * a blank Suspense fallback.
 */
class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode; onReload: () => void },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown) {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.error('WorkflowEditor failed to load:', err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="border border-red-900 bg-red-950/40 rounded-lg p-6 text-sm text-red-200"
        >
          <p className="font-medium mb-2">Editor failed to load.</p>
          <p className="text-xs text-red-300/80 mb-3 font-mono">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={this.props.onReload}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white font-medium"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
