import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Modal } from '../../components/Modal.js';
import { ApprovalCard, Button, EmptyState, ErrorState, KbdHint, LoadingState, CompanyWideBadge } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { fetchJson, postJson } from '../../lib/api.js';

export const Route = createFileRoute('/inbox/')({
  component: InboxPage,
});

const API = '';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Gate {
  id: string;
  label: string;
  status: string;
  workflowName?: string;
  workflowRunId?: string;
  stepId?: string;
  description?: string;
  createdAt: string;
}

interface GateRow {
  id: string;
  label: string;
  status: string;
  workflowName?: string;
  workflow_name?: string;
  workflowRunId?: string;
  workflow_run_id?: string;
  stepId?: string;
  step_id?: string;
  description?: string;
  createdAt?: string;
  created_at?: string;
}

interface Plan {
  id: string;
  prompt: string;
  status: string;
  steps?: { id?: string; description: string }[];
  createdAt: string;
  endedAt?: string;
  result?: { runId?: string } | null;
}

interface Skill {
  name: string;
  status: string;
  sourceAgent?: string;
  tags?: string[];
  scope?: string;
  createdAt: string;
}

export type TabKey = 'all' | 'gates' | 'plans' | 'skills';

export interface InboxEntry {
  _kind: 'gate' | 'plan' | 'skill';
  key: string;
  title: string;
  body: React.ReactNode;
  raw: Gate | Plan | Skill;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchGates(): Promise<Gate[]> {
  const data = await fetchJson<{ gates?: GateRow[] } | GateRow[]>(`${API}/api/v1/gates/pending`);
  const rows = Array.isArray(data) ? data : data.gates ?? [];
  return rows.map(normalizeGate);
}

async function fetchPlans(): Promise<Plan[]> {
  const [draftData, doneData] = await Promise.all([
    fetchJson<{ plans?: Plan[] } | Plan[]>(`${API}/api/v1/plans?status=draft`),
    fetchJson<{ plans?: Plan[] } | Plan[]>(`${API}/api/v1/plans?status=done&origin=chat&limit=10`),
  ]);
  const drafts = Array.isArray(draftData) ? draftData : draftData.plans ?? [];
  const done = Array.isArray(doneData) ? doneData : doneData.plans ?? [];
  return [...drafts, ...done].sort((a, b) => {
    const aTime = new Date(a.endedAt ?? a.createdAt).getTime();
    const bTime = new Date(b.endedAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

async function fetchSkills(): Promise<Skill[]> {
  const data = await fetchJson<{ skills?: Skill[] } | Skill[]>(`${API}/api/v1/skills?status=proposed`);
  return Array.isArray(data) ? data : data.skills ?? [];
}

// ─── Body renderers ───────────────────────────────────────────────────────────

function gateBody(g: Gate): React.ReactNode {
  return (
    <span>
      {(g.workflowName ?? g.workflowRunId) && <>{g.workflowName ?? g.workflowRunId} · </>}
      {g.stepId && <>step {g.stepId}{g.description ? ' · ' : ''}</>}
      {g.description}
    </span>
  );
}

function normalizeGate(g: GateRow): Gate {
  return {
    id: g.id,
    label: g.label,
    status: g.status,
    workflowName: g.workflowName ?? g.workflow_name,
    workflowRunId: g.workflowRunId ?? g.workflow_run_id,
    stepId: g.stepId ?? g.step_id,
    description: g.description,
    createdAt: g.createdAt ?? g.created_at ?? new Date(0).toISOString(),
  };
}

function planBody(p: Plan): React.ReactNode {
  if (p.status === 'done') {
    return (
      <span>
        completed{p.result?.runId ? <> · run {p.result.runId.slice(0, 8)}</> : null}
      </span>
    );
  }
  const steps = p.steps?.slice(0, 7) ?? [];
  if (steps.length === 0) return <span>No steps defined.</span>;
  return (
    <ul className="list-disc list-inside space-y-0.5">
      {steps.map((s, i) => (
        <li key={s.id ?? i}>{s.description}</li>
      ))}
    </ul>
  );
}

function skillBody(s: Skill): React.ReactNode {
  return (
    <span>
      {s.sourceAgent && <>{s.sourceAgent} · </>}
      {s.scope && <>{s.scope} · </>}
      {s.tags?.join(', ')}
    </span>
  );
}

// ─── Revision modal ───────────────────────────────────────────────────────────

interface RevisionModalProps {
  gateId: string;
  onClose: () => void;
}

function RevisionModal({ gateId, onClose }: RevisionModalProps) {
  const [feedback, setFeedback] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (text: string) => {
      await postJson(`${API}/api/v1/gates/${gateId}/revision`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: text }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Request revision"
      containerClassName="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden mx-4"
    >
      <div className="p-5" data-testid="revision-modal">
        <h3 className="text-sm font-semibold text-zinc-100 mb-3">Request revision</h3>
        <textarea
          className="w-full bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 p-2.5 resize-none focus:outline-none focus:border-indigo-400"
          rows={5}
          placeholder="Describe what needs to change…"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          data-testid="revision-textarea"
          autoFocus
        />
        {mutation.error && (
          <p className="mt-2 text-xs text-red-400" role="alert">
            {mutation.error instanceof Error ? mutation.error.message : 'Revision failed'}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="approve"
            disabled={!feedback.trim()}
            loading={mutation.isPending}
            onClick={() => mutation.mutate(feedback.trim())}
            data-testid="revision-send"
          >
            Send
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Help modal ───────────────────────────────────────────────────────────────

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Keyboard shortcuts"
      containerClassName="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden mx-4"
    >
      <div className="p-5" data-testid="help-modal">
        <h3 className="text-sm font-semibold text-zinc-100 mb-4">Keyboard shortcuts</h3>
        <table className="w-full text-xs text-zinc-300 border-separate border-spacing-y-1.5">
          <tbody>
            <tr>
              <td className="pr-4"><KbdHint keys={['J']} /></td>
              <td>Next item</td>
            </tr>
            <tr>
              <td className="pr-4"><KbdHint keys={['K']} /></td>
              <td>Previous item</td>
            </tr>
            <tr>
              <td className="pr-4"><KbdHint keys={['A']} /></td>
              <td>Approve focused item</td>
            </tr>
            <tr>
              <td className="pr-4"><KbdHint keys={['R']} /></td>
              <td>Reject focused item</td>
            </tr>
            <tr>
              <td className="pr-4"><KbdHint keys={['?']} /></td>
              <td>Toggle this help</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function InboxPage() {
  const queryClient = useQueryClient();

  const gatesQuery = useQuery<Gate[]>({
    queryKey: ['inbox-gates'],
    queryFn: fetchGates,
    staleTime: 15_000,
  });

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['inbox-plans'],
    queryFn: fetchPlans,
    staleTime: 15_000,
  });

  const skillsQuery = useQuery<Skill[]>({
    queryKey: ['inbox-skills'],
    queryFn: fetchSkills,
    staleTime: 15_000,
  });

  const gates = gatesQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const skills = skillsQuery.data ?? [];
  const loadError = gatesQuery.error ?? plansQuery.error ?? skillsQuery.error;
  const isLoading = gatesQuery.isLoading || plansQuery.isLoading || skillsQuery.isLoading;
  const retry = () => {
    void gatesQuery.refetch();
    void plansQuery.refetch();
    void skillsQuery.refetch();
  };

  // SSE: invalidate on relevant events
  const events = useEventBusStore((s) => s.events);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    const relevant = ['gate.opened', 'gate.approved', 'gate.rejected', 'skill.proposed', 'skill.approved', 'skill.rejected', 'plan.draft', 'plan.approved', 'plan.done', 'plan.cancelled'];
    if (relevant.includes(last.type)) {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-gates'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-skills'] });
    }
  }, [events, queryClient]);

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [revisionGateId, setRevisionGateId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build all entries
  const allEntries: InboxEntry[] = [
    ...gates.map((g): InboxEntry => ({
      _kind: 'gate',
      key: `gate-${g.id}`,
      title: g.label,
      body: gateBody(g),
      raw: g,
    })),
    ...plans.map((p): InboxEntry => ({
      _kind: 'plan',
      key: `plan-${p.id}`,
      title: p.prompt.length > 60 ? p.prompt.slice(0, 57) + '…' : p.prompt,
      body: planBody(p),
      raw: p,
    })),
    ...skills.map((s): InboxEntry => ({
      _kind: 'skill',
      key: `skill-${s.name}`,
      title: s.name,
      body: skillBody(s),
      raw: s,
    })),
  ];

  const tabEntries: InboxEntry[] =
    activeTab === 'all'
      ? allEntries
      : allEntries.filter((e) => {
          if (activeTab === 'gates') return e._kind === 'gate';
          if (activeTab === 'plans') return e._kind === 'plan';
          if (activeTab === 'skills') return e._kind === 'skill';
          return true;
        });

  // Clamp focus index when list changes
  useEffect(() => {
    setFocusedIdx((prev) => Math.min(prev, Math.max(0, tabEntries.length - 1)));
  }, [tabEntries.length]);

  // Optimistic state: track removed keys
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [savedForRollback, setSavedForRollback] = useState<Map<string, InboxEntry>>(new Map());
  const [actionError, setActionError] = useState<string | null>(null);

  const visibleEntries = tabEntries.filter((e) => !removedKeys.has(e.key));

  // ── Approve / Reject mutations ──

  const approveMutation = useMutation({
    mutationFn: async (entry: InboxEntry) => {
      if (entry._kind === 'gate') {
        const g = entry.raw as Gate;
        await postJson(`${API}/api/v1/gates/${g.id}/approve`);
      } else if (entry._kind === 'plan') {
        const p = entry.raw as Plan;
        await postJson(`${API}/api/v1/plans/${p.id}/approve`);
      } else {
        const s = entry.raw as Skill;
        await postJson(`${API}/api/v1/skills/${s.name}/approve`);
      }
    },
    onMutate: (entry) => {
      setActionError(null);
      setRemovedKeys((prev) => new Set([...prev, entry.key]));
      setSavedForRollback((prev) => new Map([...prev, [entry.key, entry]]));
    },
    onError: (err, entry) => {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
      setActionError(err instanceof Error ? err.message : 'Approval failed');
    },
    onSuccess: (_data, _entry) => {
      void queryClient.invalidateQueries({ queryKey: ['inbox-gates'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-skills'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (entry: InboxEntry) => {
      if (entry._kind === 'gate') {
        const g = entry.raw as Gate;
        await postJson(`${API}/api/v1/gates/${g.id}/reject`);
      } else if (entry._kind === 'plan') {
        const p = entry.raw as Plan;
        await postJson(`${API}/api/v1/plans/${p.id}/cancel`);
      } else {
        const s = entry.raw as Skill;
        await postJson(`${API}/api/v1/skills/${s.name}/reject`);
      }
    },
    onMutate: (entry) => {
      setActionError(null);
      setRemovedKeys((prev) => new Set([...prev, entry.key]));
      setSavedForRollback((prev) => new Map([...prev, [entry.key, entry]]));
    },
    onError: (err, entry) => {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
      setActionError(err instanceof Error ? err.message : 'Rejection failed');
    },
    onSuccess: (_data, _entry) => {
      void queryClient.invalidateQueries({ queryKey: ['inbox-gates'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox-skills'] });
    },
  });

  // ── Keyboard shortcuts ──

  const handleApprove = useCallback((entry: InboxEntry) => {
    approveMutation.mutate(entry);
  }, [approveMutation]);

  const handleReject = useCallback((entry: InboxEntry) => {
    rejectMutation.mutate(entry);
  }, [rejectMutation]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          setFocusedIdx((prev) => Math.min(prev + 1, visibleEntries.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusedIdx((prev) => Math.max(prev - 1, 0));
          break;
        case 'a':
          e.preventDefault();
          if (visibleEntries[focusedIdx]) handleApprove(visibleEntries[focusedIdx]);
          break;
        case 'r':
          e.preventDefault();
          if (visibleEntries[focusedIdx]) handleReject(visibleEntries[focusedIdx]);
          break;
        case '?':
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;
      }
    }

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [visibleEntries, focusedIdx, handleApprove, handleReject]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'all',    label: 'All',    count: allEntries.length },
    { key: 'gates',  label: 'Gates',  count: gates.length },
    { key: 'plans',  label: 'Plans',  count: plans.length },
    { key: 'skills', label: 'Skills', count: skills.length },
  ];

  return (
    <div
      className="p-6 min-w-0 outline-none"
      tabIndex={0}
      ref={containerRef}
      data-testid="inbox-container"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          Inbox
          {/* Approvals are deliberately never project-filtered — a hidden pending gate is a footgun. */}
          <CompanyWideBadge />
        </h1>
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
          onClick={() => setShowHelp(true)}
          data-testid="help-trigger"
        >
          <KbdHint keys={['?']} />
          <span className="ml-1">shortcuts</span>
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-zinc-800 pb-0" data-testid="tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            data-testid={`tab-${tab.key}`}
            onClick={() => { setActiveTab(tab.key); setFocusedIdx(0); }}
            className={`text-xs px-3 py-2 flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-400 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="inline-flex items-center justify-center text-[10px] font-semibold bg-zinc-800 text-zinc-400 rounded-full px-1.5 min-w-[1.1rem] h-4"
                data-testid={`tab-count-${tab.key}`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loadError ? (
        <ErrorState title="Inbox failed to load" error={loadError} onRetry={retry} />
      ) : isLoading ? (
        <LoadingState label="Loading inbox" />
      ) : (
        <>
      {actionError && (
        <div className="mb-3">
          <ErrorState title="Action failed" error={actionError} />
        </div>
      )}
      {visibleEntries.length === 0 ? (
        <EmptyState
          icon="Clear"
          title="All clear"
          description="No pending gates, draft plans, or proposed skills."
        />
      ) : (
        <div className="space-y-2" data-testid="inbox-list">
          {visibleEntries.map((entry, idx) => {
            const isFocused = idx === focusedIdx;
            const isGate = entry._kind === 'gate';
            return (
              <div
                key={entry.key}
                data-testid={`inbox-item-${entry.key}`}
                className={`rounded-lg transition-shadow ${isFocused ? 'ring-1 ring-indigo-400/50' : ''}`}
                onClick={() => setFocusedIdx(idx)}
              >
                <ApprovalCard
                  variant={entry._kind}
                  title={entry.title}
                  body={entry.body}
                  status={entry._kind === 'plan' && (entry.raw as Plan).status === 'done' ? 'approved' : undefined}
                  onApprove={() => handleApprove(entry)}
                  onReject={() => handleReject(entry)}
                  {...(isGate
                    ? {
                        onTertiary: () => setRevisionGateId((entry.raw as Gate).id),
                        tertiaryLabel: 'Revise',
                      }
                    : {})}
                />
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Modals */}
      {revisionGateId && (
        <RevisionModal
          gateId={revisionGateId}
          onClose={() => setRevisionGateId(null)}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* Keep compiler happy — savedForRollback used for rollback tracking */}
      {savedForRollback.size > 0 && null}
    </div>
  );
}
