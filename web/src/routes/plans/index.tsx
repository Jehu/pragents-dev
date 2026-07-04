import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { StatusPill, EmptyState } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { useScopeStore } from '../../stores/scope.js';

export const Route = createFileRoute('/plans/')({
  component: PlansPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanStep {
  id?: string;
  description: string;
  status?: string;
}

export interface Plan {
  id: string;
  prompt: string;
  status: string;
  origin?: 'nl' | 'chat' | string;
  steps?: PlanStep[];
  stepCount?: number;
  conversationId?: string;
  createdAt: string;
  updatedAt?: string;
}

export type PlanStatusTab = 'all' | 'draft' | 'running' | 'done' | 'failed' | 'cancelled';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function relativeTimeMs(tsMs: number): string {
  const s = Math.floor((Date.now() - tsMs) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_MAP: Record<string, StatusType> = {
  draft: 'proposed',
  running: 'running',
  done: 'complete',
  failed: 'failed',
  cancelled: 'cold',
};

export function toPlanStatusPill(status: string): StatusType {
  return STATUS_MAP[status] ?? 'idle';
}

export function countByPlanStatus(plans: Plan[], tab: PlanStatusTab): number {
  if (tab === 'all') return plans.length;
  return plans.filter((p) => p.status === tab).length;
}

export function filterByPlanStatus(plans: Plan[], tab: PlanStatusTab, origin: string): Plan[] {
  return plans.filter((p) => {
    if (tab !== 'all' && p.status !== tab) return false;
    if (origin && origin !== 'all' && p.origin !== origin) return false;
    return true;
  });
}

const PAGE_SIZE = 20;

// ─── Plan Card ────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  onRerun: (plan: Plan) => void;
  actionPending: string | null;
}

function PlanCard({ plan, onApprove, onCancel, onRerun, actionPending }: PlanCardProps) {
  const isDraft = plan.status === 'draft';
  const isRunning = plan.status === 'running';
  const isDoneOrFailed = plan.status === 'done' || plan.status === 'failed';
  const busy = actionPending === plan.id;

  const stepCount = plan.stepCount ?? plan.steps?.length ?? 0;
  const truncatedPrompt = plan.prompt.length > 72 ? plan.prompt.slice(0, 72) + '…' : plan.prompt;

  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to="/plans/$planId"
              params={{ planId: plan.id }}
              className="text-sm text-zinc-100 hover:text-white font-medium truncate"
            >
              {truncatedPrompt}
            </Link>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusPill status={toPlanStatusPill(plan.status)} />
            {plan.origin && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-wider">
                {plan.origin}
              </span>
            )}
            {stepCount > 0 && (
              <span className="text-[11px] text-zinc-500">{stepCount} step{stepCount !== 1 ? 's' : ''}</span>
            )}
            <span className="text-[11px] text-zinc-600">
              {relativeTimeMs(new Date(plan.createdAt).getTime())}
            </span>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {isDraft && (
            <button
              onClick={() => onApprove(plan.id)}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium disabled:opacity-40"
            >
              {busy ? '…' : 'Approve'}
            </button>
          )}
          {(isDraft || isRunning) && (
            <button
              onClick={() => onCancel(plan.id)}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Cancel
            </button>
          )}
          {isDoneOrFailed && (
            <button
              onClick={() => onRerun(plan)}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Re-run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PlansPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PlanStatusTab>('all');
  const [originFilter, setOriginFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [actionPending, setActionPending] = useState<string | null>(null);

  // SSE invalidation
  const busEvents = useEventBusStore((s) => s.events);
  useEffect(() => {
    const latest = busEvents[busEvents.length - 1];
    if (latest && typeof latest.type === 'string' && latest.type.startsWith('plan.')) {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
    }
  }, [busEvents, queryClient]);

  // Global project scope — plans carry a projectId; unscoped plans (e.g.
  // chat drafts) remain visible in every scope (server-side semantics).
  const selectedProject = useScopeStore((s) => s.selectedProject);
  useEffect(() => {
    setOffset(0);
  }, [selectedProject]);

  const { data, isLoading } = useQuery({
    queryKey: ['plans', activeTab, originFilter, offset, selectedProject],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeTab !== 'all') params.set('status', activeTab);
      if (originFilter !== 'all') params.set('origin', originFilter);
      if (selectedProject) params.set('project', selectedProject);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      return fetch(`/api/v1/plans?${params.toString()}`).then((r) => r.json());
    },
    staleTime: 10_000,
  });

  // Fetch all for tab counts (without status filter)
  const { data: allData } = useQuery({
    queryKey: ['plans-all-counts', selectedProject],
    queryFn: () =>
      fetch(
        `/api/v1/plans?limit=500${selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : ''}`,
      ).then((r) => r.json()),
    staleTime: 20_000,
  });

  const allPlans: Plan[] = Array.isArray(allData?.plans)
    ? allData.plans
    : Array.isArray(allData)
    ? allData
    : [];

  const plans: Plan[] = Array.isArray(data?.plans)
    ? data.plans
    : Array.isArray(data)
    ? data
    : [];

  const hasMore = plans.length === PAGE_SIZE;

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/v1/plans/${id}/approve`, { method: 'POST' }),
    onMutate: (id) => setActionPending(id),
    onSettled: () => {
      setActionPending(null);
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['plans-all-counts'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/v1/plans/${id}/cancel`, { method: 'POST' }),
    onMutate: (id) => setActionPending(id),
    onSettled: () => {
      setActionPending(null);
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['plans-all-counts'] });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: (plan: Plan) =>
      fetch('/api/v1/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: plan.prompt, origin: plan.origin }),
      }),
    onMutate: (plan) => setActionPending(plan.id),
    onSettled: () => {
      setActionPending(null);
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['plans-all-counts'] });
    },
  });

  const STATUS_TABS: PlanStatusTab[] = ['all', 'draft', 'running', 'done', 'failed', 'cancelled'];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Plans</h1>
        <p className="text-sm text-zinc-500 mt-1">Plan list and approval workflow.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        {/* Status tabs */}
        <div className="flex gap-1 border-b border-zinc-800 pb-0 -mb-px">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setOffset(0); }}
              className={`px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-zinc-300 text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              <span className={`ml-1 text-[11px] ${activeTab === tab ? 'text-zinc-400' : 'text-zinc-600'}`}>
                {countByPlanStatus(allPlans, tab)}
              </span>
            </button>
          ))}
        </div>

        {/* Origin dropdown */}
        <select
          value={originFilter}
          onChange={(e) => { setOriginFilter(e.target.value); setOffset(0); }}
          className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 focus:outline-none"
        >
          <option value="all">All origins</option>
          <option value="nl">NL</option>
          <option value="chat">Chat</option>
        </select>
      </div>

      {/* Plan list */}
      {isLoading ? (
        <div className="text-xs text-zinc-500 py-12 text-center">Loading…</div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No plans"
          description="No plans match the current filter."
        />
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onApprove={(id) => approveMutation.mutate(id)}
              onCancel={(id) => cancelMutation.mutate(id)}
              onRerun={(p) => rerunMutation.mutate(p)}
              actionPending={actionPending}
            />
          ))}

          {/* Pagination */}
          {hasMore && (
            <div className="pt-2 text-center">
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className="text-xs px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
