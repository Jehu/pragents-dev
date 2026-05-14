import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ApprovalCard, EmptyState, KbdHint } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';

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
  stepId?: string;
  description?: string;
  createdAt: string;
}

interface Plan {
  id: string;
  prompt: string;
  status: string;
  steps?: { id?: string; description: string }[];
  createdAt: string;
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
  const res = await fetch(`${API}/api/v1/gates?status=pending`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.gates ?? data ?? [];
}

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch(`${API}/api/v1/plans?status=draft`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.plans ?? data ?? [];
}

async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch(`${API}/api/v1/skills?status=proposed`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.skills ?? data ?? [];
}

// ─── Body renderers ───────────────────────────────────────────────────────────

function gateBody(g: Gate): React.ReactNode {
  return (
    <span>
      {g.workflowName && <>{g.workflowName} · </>}
      {g.stepId && <>step {g.stepId}{g.description ? ' · ' : ''}</>}
      {g.description}
    </span>
  );
}

function planBody(p: Plan): React.ReactNode {
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
      const res = await fetch(`${API}/api/v1/gates/${gateId}/revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: text }),
      });
      if (!res.ok) throw new Error('Revision failed');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="revision-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-md shadow-2xl">
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
        <div className="flex justify-end gap-2 mt-3">
          <button
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-approve text-xs px-3 py-1.5 rounded font-medium disabled:opacity-40"
            disabled={!feedback.trim() || mutation.isPending}
            onClick={() => mutation.mutate(feedback.trim())}
            data-testid="revision-send"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Help modal ───────────────────────────────────────────────────────────────

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="help-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-sm shadow-2xl">
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
          <button
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function InboxPage() {
  const queryClient = useQueryClient();

  const { data: gates = [] } = useQuery<Gate[]>({
    queryKey: ['inbox-gates'],
    queryFn: fetchGates,
    staleTime: 15_000,
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['inbox-plans'],
    queryFn: fetchPlans,
    staleTime: 15_000,
  });

  const { data: skills = [] } = useQuery<Skill[]>({
    queryKey: ['inbox-skills'],
    queryFn: fetchSkills,
    staleTime: 15_000,
  });

  // SSE: invalidate on relevant events
  const events = useEventBusStore((s) => s.events);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    const relevant = ['gate.opened', 'gate.approved', 'gate.rejected', 'skill.proposed', 'skill.approved', 'skill.rejected', 'plan.draft', 'plan.approved', 'plan.cancelled'];
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

  const visibleEntries = tabEntries.filter((e) => !removedKeys.has(e.key));

  // ── Approve / Reject mutations ──

  const approveMutation = useMutation({
    mutationFn: async (entry: InboxEntry) => {
      if (entry._kind === 'gate') {
        const g = entry.raw as Gate;
        await fetch(`${API}/api/v1/gates/${g.id}/approve`, { method: 'POST' });
      } else if (entry._kind === 'plan') {
        const p = entry.raw as Plan;
        await fetch(`${API}/api/v1/plans/${p.id}/approve`, { method: 'POST' });
      } else {
        const s = entry.raw as Skill;
        await fetch(`${API}/api/v1/skills/${s.name}/approve`, { method: 'POST' });
      }
    },
    onMutate: (entry) => {
      setRemovedKeys((prev) => new Set([...prev, entry.key]));
      setSavedForRollback((prev) => new Map([...prev, [entry.key, entry]]));
    },
    onError: (_err, entry) => {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
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
        await fetch(`${API}/api/v1/gates/${g.id}/reject`, { method: 'POST' });
      } else if (entry._kind === 'plan') {
        const p = entry.raw as Plan;
        await fetch(`${API}/api/v1/plans/${p.id}/cancel`, { method: 'POST' });
      } else {
        const s = entry.raw as Skill;
        await fetch(`${API}/api/v1/skills/${s.name}/reject`, { method: 'POST' });
      }
    },
    onMutate: (entry) => {
      setRemovedKeys((prev) => new Set([...prev, entry.key]));
      setSavedForRollback((prev) => new Map([...prev, [entry.key, entry]]));
    },
    onError: (_err, entry) => {
      setRemovedKeys((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
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
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Inbox</h1>
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
      {visibleEntries.length === 0 ? (
        <EmptyState
          icon="✓"
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
