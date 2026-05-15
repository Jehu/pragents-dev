import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { Modal } from '../../components/Modal.js';
import { DiffPreview } from '../../components/DiffPreview.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { useEtagFetch } from '../../hooks/useEtagFetch.js';
import { useConflictDetection } from '../../hooks/useConflictDetection.js';

/**
 * Slice-1 skill detail view: inline-edit frontmatter + body for a single
 * skill (R10), plus Approve/Reject for quarantined entries (R9 + AE4 + AE9).
 *
 * Reads from the new quarantine read endpoints (U5) when `bucket=quarantine`,
 * falls back to active when no bucket is provided. ETag is tracked across
 * fetch / refocus / save so the operator gets a stale-banner before they
 * lose work to a 412.
 */

export const Route = createFileRoute('/skills/$skillName')({
  validateSearch: (search: Record<string, unknown>) => ({
    bucket: search.bucket === 'quarantine' ? ('quarantine' as const) : ('active' as const),
  }),
  component: SkillDetailPage,
});

interface SkillDetailResponse {
  name?: string;
  frontmatter: Record<string, unknown>;
  body: string;
  etag?: string;
}

function SkillDetailPage() {
  const { skillName } = Route.useParams();
  const { bucket } = Route.useSearch();
  const navigate = useNavigate();

  const readUrl =
    bucket === 'quarantine'
      ? `/api/v1/skills/quarantine/${encodeURIComponent(skillName)}`
      : `/api/v1/skills/${encodeURIComponent(skillName)}`;
  const writeUrl = readUrl;

  const { data, etag, loading, error, refetch } =
    useEtagFetch<SkillDetailResponse>(readUrl);

  const [bodyDraft, setBodyDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [allowedToolsDraft, setAllowedToolsDraft] = useState('');
  const [staleBanner, setStaleBanner] = useState<string | null>(null);

  // Hydrate drafts from server response
  useEffect(() => {
    if (!data) return;
    setBodyDraft(data.body);
    setDescriptionDraft((data.frontmatter.description as string) ?? '');
    setAllowedToolsDraft((data.frontmatter['allowed-tools'] as string) ?? '');
    setStaleBanner(null);
  }, [data]);

  useConflictDetection({
    url: readUrl,
    currentEtag: etag,
    onStale: (newEtag) => setStaleBanner(newEtag),
    enabled: !loading,
  });

  // ----- Diff preview state machine ---------------------------------------
  type SaveState =
    | { kind: 'idle' }
    | { kind: 'preview-loading' }
    | { kind: 'preview'; current: string }
    | { kind: 'conflict'; current: string }
    | { kind: 'read-failure'; message: string };
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const proposedFrontmatter = useMemo(() => {
    if (!data) return null;
    return {
      ...data.frontmatter,
      name: skillName,
      description: descriptionDraft,
      'allowed-tools': allowedToolsDraft || undefined,
    };
  }, [data, skillName, descriptionDraft, allowedToolsDraft]);

  const openSavePreview = useCallback(() => {
    setSaveState({ kind: 'preview-loading' });
    fetch(readUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fresh = (await res.json()) as SkillDetailResponse;
        setSaveState({ kind: 'preview', current: serializeForDiff(fresh.frontmatter, fresh.body) });
      })
      .catch((err) =>
        setSaveState({
          kind: 'read-failure',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, [readUrl]);

  const closeSavePreview = useCallback(() => setSaveState({ kind: 'idle' }), []);

  const confirmSave = useCallback(async () => {
    if (!proposedFrontmatter) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (etag) headers['If-Match'] = etag;
      const res = await fetch(writeUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ frontmatter: proposedFrontmatter, body: bodyDraft }),
      });
      if (res.status === 412) {
        const remoteRead = await fetch(readUrl);
        const remoteJson = (await remoteRead.json()) as SkillDetailResponse;
        setSaveState({
          kind: 'conflict',
          current: serializeForDiff(remoteJson.frontmatter, remoteJson.body),
        });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setSaveState({ kind: 'idle' });
      refetch();
    } catch (err) {
      setSaveState({
        kind: 'read-failure',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [proposedFrontmatter, etag, writeUrl, readUrl, bodyDraft, refetch]);

  const handleApprove = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(
      `/api/v1/skills/quarantine/${encodeURIComponent(skillName)}/approve`,
      { method: 'POST', headers },
    );
    setShowApproveConfirm(false);
    if (res.ok) {
      void navigate({ to: '/skills', search: { name: undefined } });
    }
  }, [etag, skillName, navigate]);

  const handleReject = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(
      `/api/v1/skills/quarantine/${encodeURIComponent(skillName)}/reject`,
      { method: 'POST', headers },
    );
    setShowRejectConfirm(false);
    if (res.ok) {
      void navigate({ to: '/skills', search: { name: undefined } });
    }
  }, [etag, skillName, navigate]);

  const proposedSerialized = useMemo(() => {
    if (!proposedFrontmatter) return '';
    return serializeForDiff(proposedFrontmatter, bodyDraft);
  }, [proposedFrontmatter, bodyDraft]);

  if (loading) return <div className="p-6 text-sm text-zinc-500">Lade Skill…</div>;
  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        Skill konnte nicht geladen werden: {error.message}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 font-mono">{skillName}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Bucket: <span className="font-mono">{bucket}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {bucket === 'quarantine' && (
            <>
              <button
                onClick={() => setShowRejectConfirm(true)}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              >
                Reject
              </button>
              <button
                onClick={() => setShowApproveConfirm(true)}
                className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium"
              >
                Approve
              </button>
            </>
          )}
          <button
            onClick={openSavePreview}
            className="text-xs px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-medium"
          >
            Speichern…
          </button>
        </div>
      </div>

      {staleBanner && (
        <div
          role="alert"
          className="px-3 py-2 bg-amber-950/40 border border-amber-900 text-amber-200 text-xs flex items-center justify-between gap-3 rounded"
        >
          <span>Datei wurde extern geändert.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setStaleBanner(null)}
              className="text-xs px-2 py-1 rounded bg-amber-900 hover:bg-amber-800"
            >
              Weiter editieren
            </button>
            <button
              onClick={() => {
                setStaleBanner(null);
                refetch();
              }}
              className="text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-600"
            >
              Neu laden
            </button>
          </div>
        </div>
      )}

      <label className="block">
        <span className="text-xs text-zinc-400 mb-1 block">Description</span>
        <textarea
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          rows={2}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100"
        />
      </label>

      <label className="block">
        <span className="text-xs text-zinc-400 mb-1 block">Allowed tools</span>
        <input
          type="text"
          value={allowedToolsDraft}
          onChange={(e) => setAllowedToolsDraft(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 font-mono"
        />
      </label>

      <label className="block">
        <span className="text-xs text-zinc-400 mb-1 block">Body (Markdown)</span>
        <textarea
          value={bodyDraft}
          onChange={(e) => setBodyDraft(e.target.value)}
          rows={20}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 font-mono"
        />
      </label>

      {/* Save preview modal */}
      <Modal
        open={saveState.kind !== 'idle'}
        onClose={closeSavePreview}
        ariaLabel="Speichern-Vorschau"
        containerClassName="w-[800px] max-w-[95vw] bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden flex flex-col"
      >
        {saveState.kind === 'conflict' ? (
          <ConflictDialog
            open
            localContent={proposedSerialized}
            remoteContent={saveState.current}
            onDiscard={() => {
              closeSavePreview();
              navigate({ to: '/skills', search: { name: undefined } });
            }}
            onReload={() => {
              closeSavePreview();
              refetch();
            }}
            onClose={closeSavePreview}
          />
        ) : (
          <DiffPreview
            state={diffStateFor(saveState, proposedSerialized)}
            before={saveState.kind === 'preview' ? saveState.current : ''}
            after={proposedSerialized}
            onConfirm={confirmSave}
            onCancel={closeSavePreview}
            message={saveState.kind === 'read-failure' ? saveState.message : undefined}
          />
        )}
      </Modal>

      {/* Approve confirm */}
      <Modal
        open={showApproveConfirm}
        onClose={() => setShowApproveConfirm(false)}
        ariaLabel="Skill aktivieren"
        containerClassName="w-[420px] bg-zinc-900 rounded-xl shadow-2xl border border-emerald-900 overflow-hidden"
      >
        <div className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-100">Skill aktivieren?</h3>
          <p className="text-xs text-zinc-400">
            <span className="font-mono">{skillName}</span> wird aus dem Quarantine-Verzeichnis
            in den aktiven Skills-Pfad verschoben und Agents zur Discovery freigegeben.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowApproveConfirm(false)}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Abbrechen
            </button>
            <button
              onClick={handleApprove}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium"
            >
              Approve
            </button>
          </div>
        </div>
      </Modal>

      {/* Reject confirm — mustConfirm so Esc/backdrop don't dismiss */}
      <Modal
        open={showRejectConfirm}
        onClose={() => setShowRejectConfirm(false)}
        mustConfirm
        ariaLabel="Skill ablehnen"
        containerClassName="w-[420px] bg-zinc-900 rounded-xl shadow-2xl border border-red-900 overflow-hidden"
      >
        <div className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-100">Skill ablehnen?</h3>
          <p className="text-xs text-zinc-400">
            <span className="font-mono">{skillName}</span> bleibt im Quarantine-Verzeichnis
            erhalten, Status wird auf <span className="font-mono">rejected</span> gesetzt.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowRejectConfirm(false)}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Abbrechen
            </button>
            <button
              onClick={handleReject}
              className="text-xs px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium"
            >
              Reject
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function serializeForDiff(frontmatter: Record<string, unknown>, body: string): string {
  // Tiny stable serializer — sorts keys so the diff is deterministic even
  // when the server returns frontmatter in a different order.
  const keys = Object.keys(frontmatter).sort();
  const lines = ['---'];
  for (const k of keys) {
    const v = frontmatter[k];
    if (v === undefined) continue;
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('---', '', body);
  return lines.join('\n');
}

type SaveStateLocal =
  | { kind: 'idle' }
  | { kind: 'preview-loading' }
  | { kind: 'preview'; current: string }
  | { kind: 'conflict'; current: string }
  | { kind: 'read-failure'; message: string };

function diffStateFor(state: SaveStateLocal, proposed: string) {
  switch (state.kind) {
    case 'preview-loading':
      return 'loading' as const;
    case 'preview':
      return state.current === proposed ? 'empty' : 'diff';
    case 'conflict':
      return 'conflict' as const;
    case 'read-failure':
      return 'read-failure' as const;
    default:
      return 'loading' as const;
  }
}
