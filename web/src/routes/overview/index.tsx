import React, { useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { StatusPill, ApprovalCard, EmptyState } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { useShallow } from 'zustand/react/shallow';
import type { StatusType } from '../../components/ui/StatusPill.js';

export const Route = createFileRoute('/overview/')({
  component: OverviewPage,
});

const API = '';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name?: string;
  type?: string;
  projectId?: string;
  model?: string;
  skills?: string[];
  status?: string;
}

export interface Gate {
  id: string;
  label: string;
  status: string;
  workflowName?: string;
  stepId?: string;
  description?: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  prompt: string;
  status: string;
  steps?: { id?: string; description: string }[];
  createdAt: string;
}

export interface Skill {
  name: string;
  status: string;
  sourceAgent?: string;
  tags?: string[];
  scope?: string;
  createdAt: string;
  usageCount?: number;
  lastUsedAt?: string;
}

export type InboxItem =
  | { _kind: 'gate'; item: Gate; createdAt: string }
  | { _kind: 'plan'; item: Plan; createdAt: string }
  | { _kind: 'skill'; item: Skill; createdAt: string };

// ─── Event helpers ────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  'task.running':   '▶',
  'task.complete':  '✓',
  'task.failed':    '✗',
  'task.retried':   '↺',
  'task.deleted':   '✕',
  'gate.opened':    '⛩',
  'gate.approved':  '✓',
  'gate.rejected':  '✗',
  'skill.proposed': '★',
  'skill.approved': '✓',
  'skill.rejected': '✗',
  'plan.draft':     '✏',
  'plan.approved':  '✓',
  'plan.cancelled': '✗',
};

function iconFor(type: string): string {
  return EVENT_ICONS[type] ?? '•';
}

const EVENT_LABELS: Record<string, string> = {
  'task.running':   'Task started',
  'task.complete':  'Task completed',
  'task.failed':    'Task failed',
  'task.retried':   'Task retried',
  'task.deleted':   'Task deleted',
  'gate.opened':    'Gate opened',
  'gate.approved':  'Gate approved',
  'gate.rejected':  'Gate rejected',
  'skill.proposed': 'Skill proposed',
  'skill.approved': 'Skill approved',
  'skill.rejected': 'Skill rejected',
  'plan.draft':     'Plan drafted',
  'plan.approved':  'Plan approved',
  'plan.cancelled': 'Plan cancelled',
};

function labelFor(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Loader (exported for testing) ───────────────────────────────────────────

export async function fetchInboxItems(): Promise<InboxItem[]> {
  const [gatesRes, plansRes, skillsRes] = await Promise.all([
    fetch(`${API}/api/v1/gates?status=pending`),
    fetch(`${API}/api/v1/plans?status=draft`),
    fetch(`${API}/api/v1/skills?status=proposed`),
  ]);

  const [gatesData, plansData, skillsData] = await Promise.all([
    gatesRes.ok ? gatesRes.json() : { gates: [] },
    plansRes.ok ? plansRes.json() : { plans: [] },
    skillsRes.ok ? skillsRes.json() : { skills: [] },
  ]);

  const gates: InboxItem[] = ((gatesData.gates ?? gatesData) as Gate[]).map((g) => ({
    _kind: 'gate' as const,
    item: g,
    createdAt: g.createdAt,
  }));
  const plans: InboxItem[] = ((plansData.plans ?? plansData) as Plan[]).map((p) => ({
    _kind: 'plan' as const,
    item: p,
    createdAt: p.createdAt,
  }));
  const skills: InboxItem[] = ((skillsData.skills ?? skillsData) as Skill[]).map((s) => ({
    _kind: 'skill' as const,
    item: s,
    createdAt: s.createdAt,
  }));

  return [...gates, ...plans, ...skills]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
}

// ─── Approve/Reject API helpers ───────────────────────────────────────────────

export async function approveItem(item: InboxItem): Promise<void> {
  if (item._kind === 'gate') {
    await fetch(`${API}/api/v1/gates/${item.item.id}/approve`, { method: 'POST' });
  } else if (item._kind === 'plan') {
    await fetch(`${API}/api/v1/plans/${item.item.id}/approve`, { method: 'POST' });
  } else {
    await fetch(`${API}/api/v1/skills/${(item.item as Skill).name}/approve`, { method: 'POST' });
  }
}

export async function rejectItem(item: InboxItem): Promise<void> {
  if (item._kind === 'gate') {
    await fetch(`${API}/api/v1/gates/${item.item.id}/reject`, { method: 'POST' });
  } else if (item._kind === 'plan') {
    await fetch(`${API}/api/v1/plans/${item.item.id}/cancel`, { method: 'POST' });
  } else {
    await fetch(`${API}/api/v1/skills/${(item.item as Skill).name}/reject`, { method: 'POST' });
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: Agent }) {
  const status = (agent.status ?? 'idle') as StatusType;
  const skillCount = agent.skills?.length ?? 0;
  const displayName = agent.name ?? agent.id;

  return (
    <Link
      to="/agents/$agentId"
      params={{ agentId: agent.id }}
      className="flex-shrink-0 w-52 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col gap-1.5 cursor-pointer transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-100 truncate">{displayName}</span>
        <StatusPill status={status} />
      </div>
      <div className="text-[11px] text-zinc-400 truncate">{agent.model ?? 'unknown model'}</div>
      <div className="flex items-center gap-2">
        {agent.projectId && (
          <span className="text-[11px] bg-indigo-500/15 text-indigo-300 px-1.5 py-0.5 rounded truncate max-w-[7rem]">
            {agent.projectId}
          </span>
        )}
        <span className="text-[11px] text-zinc-500">
          {skillCount} skill{skillCount !== 1 ? 's' : ''}
        </span>
      </div>
    </Link>
  );
}

export function inboxItemTitle(item: InboxItem): string {
  if (item._kind === 'gate') return item.item.label;
  if (item._kind === 'plan') {
    const p = item.item as Plan;
    return p.prompt.length > 60 ? p.prompt.slice(0, 57) + '…' : p.prompt;
  }
  return (item.item as Skill).name;
}

export function inboxItemBody(item: InboxItem): React.ReactNode {
  if (item._kind === 'gate') {
    const g = item.item as Gate;
    return (
      <span>
        {g.workflowName && <>{g.workflowName} · </>}
        {g.stepId && <>step {g.stepId}{g.description ? ' · ' : ''}</>}
        {g.description}
      </span>
    );
  }
  if (item._kind === 'plan') {
    const p = item.item as Plan;
    const steps = p.steps?.slice(0, 7) ?? [];
    if (steps.length === 0) return <span>No steps</span>;
    return (
      <ul className="list-disc list-inside space-y-0.5">
        {steps.map((s, i) => (
          <li key={s.id ?? i}>{s.description}</li>
        ))}
      </ul>
    );
  }
  const s = item.item as Skill;
  return (
    <span>
      {s.sourceAgent && <>{s.sourceAgent} · </>}
      {s.scope && <>{s.scope} · </>}
      {s.tags?.join(', ')}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function OverviewPage() {
  const queryClient = useQueryClient();

  const { data: agentsData } = useQuery<{ agents?: Agent[] } | Agent[]>({
    queryKey: ['agents'],
    queryFn: () => fetch(`${API}/api/v1/agents`).then((r) => r.json()),
    staleTime: 30_000,
  });

  const agents: Agent[] = Array.isArray(agentsData)
    ? agentsData
    : ((agentsData as { agents?: Agent[] })?.agents ?? []);

  const { data: inboxItems = [] } = useQuery<InboxItem[]>({
    queryKey: ['overview-inbox'],
    queryFn: fetchInboxItems,
    staleTime: 15_000,
  });

  // SSE: invalidate inbox on relevant events
  const events = useEventBusStore((s) => s.events);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    const relevant = [
      'gate.opened', 'gate.approved', 'gate.rejected',
      'skill.proposed', 'skill.approved', 'skill.rejected',
      'plan.draft', 'plan.approved', 'plan.cancelled',
    ];
    if (relevant.includes(last.type)) {
      void queryClient.invalidateQueries({ queryKey: ['overview-inbox'] });
    }
  }, [events, queryClient]);

  // Recent events (last 6 from store, no API call, live)
  const recentEvents = useEventBusStore(useShallow((s) => s.events.slice(-6).reverse()));

  const approveMutation = useMutation({
    mutationFn: approveItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['overview-inbox'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['overview-inbox'] }),
  });

  return (
    <div className="p-6 space-y-8 min-w-0">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Overview</h1>
        <button
          className="btn-approve text-xs px-3 py-1.5 rounded font-medium"
          onClick={() => alert('⌘K palette coming in M5')}
        >
          + New task
        </button>
      </div>

      {/* ── Agents strip ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
            Agents
          </h2>
          <Link to="/agents" className="text-xs text-zinc-500 hover:text-zinc-300">
            View all →
          </Link>
        </div>
        {agents.length === 0 ? (
          <EmptyState
            icon="🤖"
            title="No agents configured"
            description="Add agents to pragents.yaml to see them here."
          />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </section>

      {/* ── Needs-you strip ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
            Needs your attention
          </h2>
          <Link to="/inbox" className="text-xs text-zinc-500 hover:text-zinc-300">
            View all →
          </Link>
        </div>
        {inboxItems.length === 0 ? (
          <EmptyState
            icon="✓"
            title="All clear"
            description="Nothing needs your attention right now."
          />
        ) : (
          <div className="space-y-2">
            {inboxItems.map((item, idx) => {
              const key =
                item._kind === 'skill'
                  ? `skill-${(item.item as Skill).name}`
                  : `${item._kind}-${'id' in item.item ? item.item.id : idx}`;
              return (
                <ApprovalCard
                  key={key}
                  variant={item._kind}
                  title={inboxItemTitle(item)}
                  body={inboxItemBody(item)}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onApprove={() => approveMutation.mutate(item)}
                  onReject={() => rejectMutation.mutate(item)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recent events strip ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
            Recent events
          </h2>
        </div>
        {recentEvents.length === 0 ? (
          <EmptyState
            icon="📡"
            title="No events yet"
            description="Events will appear here as agents run tasks."
          />
        ) : (
          <div className="space-y-1">
            {recentEvents.map((evt, idx) => (
              <div
                key={evt.id ?? idx}
                className="flex items-center gap-3 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs"
              >
                <span className="text-zinc-400 w-4 text-center flex-shrink-0">
                  {iconFor(evt.type)}
                </span>
                <span className="flex-1 text-zinc-300 truncate">{labelFor(evt.type)}</span>
                {evt.agentId && (
                  <span className="text-zinc-500 truncate max-w-[8rem]">{evt.agentId}</span>
                )}
                <span className="text-zinc-600 flex-shrink-0">{relativeTime(evt.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
