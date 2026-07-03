import React, { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { StatusPill, ApprovalCard, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { useScopeStore } from '../../stores/scope.js';
import { agentsInScope, eventsInScope } from '../../lib/scope.js';
import { useCommandPaletteStore } from '../../stores/commandPalette.js';
import { useShallow } from 'zustand/react/shallow';
import type { StatusType } from '../../components/ui/StatusPill.js';
import { fetchJson, postJson } from '../../lib/api.js';

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
  capabilities?: string[];
  status?: string;
}

export interface Gate {
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

interface TaskSummary {
  id: string;
  status: string;
  description: string;
  agentId?: string;
  createdAt: string;
}

interface WorkflowRunSummary {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
}

interface GoalRunSummary {
  id: string;
  goalId: string;
  status: string;
  triggeredAt: string;
}

interface CostRow {
  cost?: number;
  project_id?: string;
}

export interface LiveWorkflowActivity {
  agentId: string;
  workflow?: string;
  runId?: string;
  stepId?: string;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  state: 'active' | 'recent';
}

type LiveWorkflowActivityMap = Record<string, LiveWorkflowActivity>;

export const LIVE_WORKFLOW_MIN_VISIBLE_MS = 2_500;
export const LIVE_WORKFLOW_STALE_MS = 2 * 60_000;
export const AGENT_ACTIVITY_EVENT_TYPES = [
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'workflow.step_started',
  'workflow.step_completed',
  'workflow.step_failed',
];

export function shouldInvalidateAgentsForEvent(type: string): boolean {
  return AGENT_ACTIVITY_EVENT_TYPES.includes(type);
}

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
  'plan.done':      '✓',
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
  'plan.done':      'Plan completed',
  'plan.cancelled': 'Plan cancelled',
};

function labelFor(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function eventDataObject(event: { data?: unknown }): Record<string, any> {
  return event.data && typeof event.data === 'object' ? event.data as Record<string, any> : {};
}

function workflowPayload(event: { data?: unknown }): Record<string, any> {
  const raw = eventDataObject(event);
  return raw.data && typeof raw.data === 'object' ? raw.data as Record<string, any> : raw;
}

function eventAgentId(event: { agentId?: string; data?: unknown }): string | undefined {
  const raw = eventDataObject(event);
  const payload = workflowPayload(event);
  return event.agentId ?? raw.agentId ?? raw.agent_id ?? payload.agentId ?? payload.agent_id;
}

function eventTimestamp(event: { ts?: number }, fallback: number): number {
  return typeof event.ts === 'number' ? event.ts : fallback;
}

function sameWorkflowActivity(activity: LiveWorkflowActivity | undefined, payload: Record<string, any>): boolean {
  if (!activity) return false;
  const runId = payload.runId ?? payload.run_id;
  const stepId = payload.stepId ?? payload.step_id;
  if (runId && activity.runId && runId !== activity.runId) return false;
  if (stepId && activity.stepId && stepId !== activity.stepId) return false;
  return true;
}

export function pruneLiveWorkflowActivities(
  activities: LiveWorkflowActivityMap,
  now: number = Date.now(),
): LiveWorkflowActivityMap {
  const next: LiveWorkflowActivityMap = {};
  for (const [agentId, activity] of Object.entries(activities)) {
    if (activity.expiresAt > now) next[agentId] = activity;
  }
  return next;
}

export function reduceLiveWorkflowActivities(
  activities: LiveWorkflowActivityMap,
  event: { type: string; agentId?: string; ts?: number; data?: unknown },
  now: number = Date.now(),
): LiveWorkflowActivityMap {
  const pruned = pruneLiveWorkflowActivities(activities, now);
  const payload = workflowPayload(event);
  const agentId = eventAgentId(event);
  if (!agentId) return pruned;

  if (event.type === 'workflow.step_started') {
    const startedAt = eventTimestamp(event, now);
    return {
      ...pruned,
      [agentId]: {
        agentId,
        workflow: payload.workflow,
        runId: payload.runId ?? payload.run_id,
        stepId: payload.stepId ?? payload.step_id,
        startedAt,
        updatedAt: now,
        expiresAt: now + LIVE_WORKFLOW_STALE_MS,
        state: 'active',
      },
    };
  }

  if (event.type === 'workflow.step_completed' || event.type === 'workflow.step_failed' || event.type === 'agent_end') {
    const activity = pruned[agentId];
    if (!sameWorkflowActivity(activity, payload)) return pruned;

    const minVisibleUntil = Math.max(activity.startedAt + LIVE_WORKFLOW_MIN_VISIBLE_MS, now);
    return {
      ...pruned,
      [agentId]: {
        ...activity,
        updatedAt: now,
        expiresAt: minVisibleUntil,
        state: 'recent',
      },
    };
  }

  return pruned;
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

export function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Loader (exported for testing) ───────────────────────────────────────────

export async function fetchInboxItems(): Promise<InboxItem[]> {
  const [gatesData, plansData, skillsData] = await Promise.all([
    fetchJson<{ gates?: GateRow[] } | GateRow[]>(`${API}/api/v1/gates/pending`),
    fetchJson<{ plans?: Plan[] } | Plan[]>(`${API}/api/v1/plans?status=draft`),
    fetchJson<{ skills?: Skill[] } | Skill[]>(`${API}/api/v1/skills?status=proposed`),
  ]);

  const gateItems = (Array.isArray(gatesData) ? gatesData : gatesData.gates ?? []).map(normalizeGate);
  const planItems = Array.isArray(plansData) ? plansData : plansData.plans ?? [];
  const skillItems = Array.isArray(skillsData) ? skillsData : skillsData.skills ?? [];

  const gates: InboxItem[] = gateItems.map((g) => ({
    _kind: 'gate' as const,
    item: g,
    createdAt: g.createdAt,
  }));
  const plans: InboxItem[] = planItems.map((p) => ({
    _kind: 'plan' as const,
    item: p,
    createdAt: p.createdAt,
  }));
  const skills: InboxItem[] = skillItems.map((s) => ({
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
    await postJson(`${API}/api/v1/gates/${item.item.id}/approve`);
  } else if (item._kind === 'plan') {
    await postJson(`${API}/api/v1/plans/${item.item.id}/approve`);
  } else {
    await postJson(`${API}/api/v1/skills/${(item.item as Skill).name}/approve`);
  }
}

export async function rejectItem(item: InboxItem): Promise<void> {
  if (item._kind === 'gate') {
    await postJson(`${API}/api/v1/gates/${item.item.id}/reject`);
  } else if (item._kind === 'plan') {
    await postJson(`${API}/api/v1/plans/${item.item.id}/cancel`);
  } else {
    await postJson(`${API}/api/v1/skills/${(item.item as Skill).name}/reject`);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentCard({ agent, activity }: { agent: Agent; activity?: LiveWorkflowActivity }) {
  const status = (activity?.state === 'active' ? 'busy' : (agent.status ?? 'idle')) as StatusType;
  const capabilityCount = agent.capabilities?.length ?? 0;
  const displayName = agent.name ?? agent.id;
  const activityLabel = activity?.workflow || activity?.stepId
    ? [activity.workflow, activity.stepId ? `step ${activity.stepId}` : undefined].filter(Boolean).join(' · ')
    : undefined;

  return (
    <Link
      to="/agents/$agentId"
      params={{ agentId: agent.id }}
      className="flex-shrink-0 w-52 min-h-[6.75rem] bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col gap-1.5 cursor-pointer transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-100 truncate">{displayName}</span>
        <StatusPill status={status} />
      </div>
      <div className="text-[11px] text-zinc-400 truncate">{agent.model ?? 'unknown model'}</div>
      {activityLabel && (
        <div className="text-[11px] text-amber-300 truncate" title={activityLabel}>
          {activityLabel}
        </div>
      )}
      <div className="flex items-center gap-2">
        {agent.projectId && (
          <span className="text-[11px] bg-indigo-500/15 text-indigo-300 px-1.5 py-0.5 rounded truncate max-w-[7rem]">
            {agent.projectId}
          </span>
        )}
        <span className="text-[11px] text-zinc-500">
          {capabilityCount} capabilit{capabilityCount !== 1 ? 'ies' : 'y'}
        </span>
      </div>
    </Link>
  );
}

function PriorityCard({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: string | number;
  tone: 'amber' | 'sky' | 'red' | 'emerald' | 'zinc';
  to: string;
}) {
  const tones = {
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
    red: 'border-red-500/30 bg-red-500/10 text-red-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    zinc: 'border-zinc-800 bg-zinc-900 text-zinc-200',
  };

  return (
    <Link to={to} className={`rounded-lg border px-4 py-3 no-underline ${tones[tone]}`}>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs opacity-80">{label}</div>
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
        {(g.workflowName ?? g.workflowRunId) && <>{g.workflowName ?? g.workflowRunId} · </>}
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
  const [liveActivities, setLiveActivities] = useState<LiveWorkflowActivityMap>({});
  const selectedProject = useScopeStore((s) => s.selectedProject);

  const { data: agentsData, error: agentsError, isLoading: agentsLoading, refetch: refetchAgents } = useQuery<{ agents?: Agent[] } | Agent[]>({
    queryKey: ['agents'],
    queryFn: () => fetchJson(`${API}/api/v1/agents`),
    staleTime: 30_000,
  });

  const allAgents: Agent[] = Array.isArray(agentsData)
    ? agentsData
    : ((agentsData as { agents?: Agent[] })?.agents ?? []);
  const agents = agentsInScope(allAgents, selectedProject);

  const { data: inboxItems = [], error: inboxError, isLoading: inboxLoading, refetch: refetchInbox } = useQuery<InboxItem[]>({
    queryKey: ['overview-inbox'],
    queryFn: fetchInboxItems,
    staleTime: 15_000,
  });

  const { data: tasksData, error: tasksError } = useQuery<{ tasks?: TaskSummary[] } | TaskSummary[]>({
    queryKey: ['overview-tasks', selectedProject],
    queryFn: () =>
      fetchJson(
        `/api/v1/tasks?limit=50${selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : ''}`,
      ),
    staleTime: 10_000,
  });

  const { data: workflowRunsData } = useQuery<{ runs?: WorkflowRunSummary[] } | WorkflowRunSummary[]>({
    queryKey: ['overview-workflow-runs'],
    queryFn: () => fetchJson('/api/v1/workflows/runs?includeSteps=false'),
    staleTime: 10_000,
  });

  const { data: goalRunsData } = useQuery<{ runs?: GoalRunSummary[] } | GoalRunSummary[]>({
    queryKey: ['overview-goal-runs'],
    queryFn: () => fetchJson('/api/v1/goals/runs'),
    staleTime: 15_000,
  });

  const { data: costData } = useQuery<CostRow[]>({
    queryKey: ['cost-monthly'],
    queryFn: () => fetchJson('/api/v1/cost/summary'),
    staleTime: 300_000,
  });

  // SSE: invalidate queries and update live agent workflow activity.
  const events = useEventBusStore((s) => s.events);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    const relevant = [
      'gate.opened', 'gate.approved', 'gate.rejected',
      'skill.proposed', 'skill.approved', 'skill.rejected',
      'plan.draft', 'plan.approved', 'plan.done', 'plan.cancelled',
    ];
    if (relevant.includes(last.type)) {
      void queryClient.invalidateQueries({ queryKey: ['overview-inbox'] });
    }
    if (shouldInvalidateAgentsForEvent(last.type)) {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
    if (last.type === 'workflow.step_started' || last.type === 'workflow.step_completed' || last.type === 'workflow.step_failed' || last.type === 'agent_end') {
      setLiveActivities((current) => reduceLiveWorkflowActivities(current, last));
    } else {
      setLiveActivities((current) => pruneLiveWorkflowActivities(current));
    }
    if (last.type.startsWith('task.')) void queryClient.invalidateQueries({ queryKey: ['overview-tasks'] });
    if (last.type.startsWith('workflow.')) void queryClient.invalidateQueries({ queryKey: ['overview-workflow-runs'] });
    if (last.type.startsWith('goal.')) void queryClient.invalidateQueries({ queryKey: ['overview-goal-runs'] });
  }, [events, queryClient]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveActivities((current) => pruneLiveWorkflowActivities(current));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Recent events (last 6 from store, no API call, live) — scoped to the
  // selected project when one is active (company-level events stay visible).
  const allRecentEvents = useEventBusStore(useShallow((s) => s.events.slice(-30)));
  const recentEvents = eventsInScope(allRecentEvents, selectedProject).slice(-6).reverse();

  const approveMutation = useMutation({
    mutationFn: approveItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['overview-inbox'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['overview-inbox'] }),
  });

  const tasks = Array.isArray(tasksData) ? tasksData : tasksData?.tasks ?? [];
  const workflowRuns = Array.isArray(workflowRunsData) ? workflowRunsData : workflowRunsData?.runs ?? [];
  const goalRuns = Array.isArray(goalRunsData) ? goalRunsData : goalRunsData?.runs ?? [];
  const runningTasks = tasks.filter((task) => task.status === 'running' || task.status === 'pending');
  const failedTasks = tasks.filter((task) => task.status === 'failed');
  const runningWorkflows = workflowRuns.filter((run) => run.status === 'running');
  const escalatedGoals = goalRuns.filter((run) => run.status === 'failed' || run.status === 'escalated');
  const monthlyCost = (costData ?? [])
    .filter((row) => !selectedProject || row.project_id === selectedProject)
    .reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const loadError = inboxError ?? tasksError;

  return (
    <div className="p-6 space-y-8 min-w-0">
      <PageHeader
        title="Overview"
        description="Operator priorities across work, decisions, failures, and spend."
        actions={
        <button
          className="btn-approve text-xs px-3 py-1.5 rounded font-medium"
          onClick={() => useCommandPaletteStore.getState().openDispatch()}
        >
          + New task
        </button>
        }
      />

      {loadError && (
        <ErrorState
          title="Overview failed to load"
          error={loadError}
          onRetry={() => {
            void refetchInbox();
            void queryClient.invalidateQueries({ queryKey: ['overview-tasks'] });
          }}
        />
      )}

      <section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <PriorityCard label="pending approvals" value={inboxItems.length} tone={inboxItems.length > 0 ? 'amber' : 'emerald'} to="/inbox" />
          <PriorityCard label="running tasks" value={runningTasks.length} tone={runningTasks.length > 0 ? 'sky' : 'zinc'} to="/tasks" />
          <PriorityCard label="running workflows" value={runningWorkflows.length} tone={runningWorkflows.length > 0 ? 'sky' : 'zinc'} to="/workflows" />
          <PriorityCard label="failed tasks" value={failedTasks.length} tone={failedTasks.length > 0 ? 'red' : 'emerald'} to="/tasks" />
          <PriorityCard label="goal escalations" value={escalatedGoals.length} tone={escalatedGoals.length > 0 ? 'red' : 'emerald'} to="/goals" />
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          Month cost: <span className="font-mono text-zinc-300">€{monthlyCost.toFixed(2)}</span>
        </div>
      </section>

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
        {agentsError ? (
          <ErrorState title="Agents failed to load" error={agentsError} onRetry={() => void refetchAgents()} />
        ) : agentsLoading ? (
          <LoadingState label="Loading agents" />
        ) : agents.length === 0 ? (
          <EmptyState
            icon="Agents"
            title="No agents configured"
            description="Add agents to pragents.yaml to see them here."
          />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} activity={liveActivities[agent.id]} />
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
        {inboxError ? (
          <ErrorState title="Attention items failed to load" error={inboxError} onRetry={() => void refetchInbox()} />
        ) : inboxLoading ? (
          <LoadingState label="Loading attention items" />
        ) : inboxItems.length === 0 ? (
          <EmptyState
            icon="Clear"
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
            icon="Events"
            title="No events yet"
            description="Events will appear here as agents run tasks."
          />
        ) : (
          <Panel className="divide-y divide-zinc-800 overflow-hidden">
            {recentEvents.map((evt, idx) => (
              <div
                key={evt.id ?? idx}
                className="flex items-center gap-3 px-3 py-1.5 text-xs"
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
          </Panel>
        )}
      </section>
    </div>
  );
}
