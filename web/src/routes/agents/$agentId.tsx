import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  MasterDetail,
  StatusPill,
  StatCard,
  EmptyState,
} from '../../components/ui/index.js';
import { useEventBus } from '../../stores/eventBus.js';
import { formatDuration, formatCost, formatAge } from '../tasks/index.js';
import type { StatusType } from '../../components/ui/index.js';

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentDetailPage,
});

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

type AgentStatus = 'busy' | 'idle' | 'offline';

interface AgentSummary {
  id: string;
  type: string;
  projectId: string;
  model: string;
  capabilities: string[];
  status: AgentStatus;
}

interface BudgetStatus {
  used: number;
  budget: number;
  remaining: number;
  percentUsed: number;
  windowStart: string;
  locked: boolean;
}

interface AgentDetail {
  id: string;
  type: string;
  projectId: string;
  model: string;
  capabilities: string[];
  status: AgentStatus;
  session: { id: string; startedAt: string; idleTimeoutMs: number; msUntilIdle: number } | null;
  stats: {
    tasksToday: number;
    tasksTodayComplete: number;
    avgLatencyP50Ms: number | null;
    costToday: number;
  };
  budget: BudgetStatus | null;
  skillsLoaded: { name: string; jit: boolean }[];
}

interface Task {
  id: string;
  agentId: string;
  projectId: string;
  status: string;
  description: string;
  createdAt: string;
  durationMs: number | null;
  costEur: number;
}

// ──────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<AgentStatus, number> = { busy: 0, idle: 1, offline: 2 };

const STATUS_PILL_MAP: Record<AgentStatus, StatusType> = {
  busy: 'busy',
  idle: 'idle',
  offline: 'cold',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-zinc-500',
  running: 'bg-sky-400',
  complete: 'bg-emerald-400',
  failed: 'bg-red-400',
  needs_review: 'bg-amber-400',
  blocked: 'bg-zinc-600',
};

const STATUS_TO_PILL: Record<string, StatusType> = {
  pending: 'idle',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  needs_review: 'needs_review',
  blocked: 'idle',
};

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function agentInitials(id: string): string {
  return id
    .split(/[-_]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(0)}s`;
}

function formatIdleCountdown(ms: number | null): string {
  if (ms === null || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ──────────────────────────────────────────────────────────────────
// Token budget panel
// ──────────────────────────────────────────────────────────────────

function BudgetPanel({
  budget,
  resetting,
  onReset,
}: {
  budget: BudgetStatus;
  resetting: boolean;
  onReset: () => void;
}) {
  const pct = Math.max(0, Math.min(100, budget.percentUsed));
  // Green under 75%, amber approaching the cap, red once locked.
  const barColor = budget.locked
    ? 'bg-red-500'
    : pct >= 75
      ? 'bg-amber-400'
      : 'bg-emerald-500';
  const windowStart = new Date(budget.windowStart);

  return (
    <div className="px-6 py-4 border-b border-zinc-800 flex-shrink-0">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">
            Token budget
          </span>
          {budget.locked && (
            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">
              locked
            </span>
          )}
        </div>
        <button
          onClick={onReset}
          disabled={resetting}
          title="Clear usage counted in the current window and unblock dispatch"
          className="px-3 py-1 text-xs font-medium rounded border border-indigo-600/50 text-indigo-300 hover:bg-indigo-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {resetting ? 'Resetting…' : 'Reset budget'}
        </button>
      </div>

      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className="flex items-center justify-between gap-4 mt-1.5 text-[11px] text-zinc-500">
        <span>
          <span className={budget.locked ? 'text-red-400' : 'text-zinc-300'}>
            {formatTokens(budget.used)}
          </span>{' '}
          / {formatTokens(budget.budget)} tokens ({Math.round(pct)}%)
        </span>
        <span>
          {budget.locked
            ? 'Dispatch blocked'
            : `${formatTokens(budget.remaining)} remaining`}
          {' · window since '}
          {windowStart.toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────────────────────────

function AgentSidebar({
  agents,
  activeId,
}: {
  agents: AgentSummary[];
  activeId: string;
}) {
  const navigate = useNavigate();

  if (agents.length === 0) {
    return (
      <EmptyState
        icon="🤖"
        title="No agents"
        description="No agents are configured."
      />
    );
  }

  const sorted = [...agents].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3),
  );

  return (
    <div className="py-2">
      <div className="px-3 pb-2 pt-1">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">Agents</p>
      </div>
      {sorted.map((agent) => {
        const isActive = agent.id === activeId;
        return (
          <button
            key={agent.id}
            onClick={() => navigate({ to: '/agents/$agentId', params: { agentId: agent.id } })}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2 transition-colors ${
              isActive
                ? 'bg-indigo-600/20 border-l-2 border-indigo-500'
                : 'border-l-2 border-transparent hover:bg-zinc-800/60'
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-zinc-300">{agentInitials(agent.id)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-medium truncate ${isActive ? 'text-indigo-200' : 'text-zinc-200'}`}>
                  {agent.id}
                </span>
                <StatusPill status={STATUS_PILL_MAP[agent.status] ?? 'idle'} />
              </div>
              <p className="text-[11px] text-zinc-500 truncate">{agent.projectId}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Detail tabs
// ──────────────────────────────────────────────────────────────────

type Tab = 'events' | 'tasks' | 'capabilities' | 'sessions';

interface SessionSnapshot {
  id: string;
  sessionId: string;
  messageCount: number;
  createdAt: string;
}

interface SessionMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

/** Flatten a pi message content block into displayable text. */
export function messageText(msg: SessionMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b?.type === 'text' || b?.text)
      .map((b) => b.text ?? '')
      .join('\n');
  }
  return '';
}

function SessionsTab({ agentId }: { agentId: string }) {
  const [openSnapshot, setOpenSnapshot] = useState<string | null>(null);

  const { data: snapshots } = useQuery<SessionSnapshot[]>({
    queryKey: ['session-snapshots', agentId],
    queryFn: () =>
      fetch(`/api/v1/memory/session-messages?sessionId=${encodeURIComponent(agentId)}`).then((r) => r.json()),
    staleTime: 15_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<{
    messages: SessionMessage[];
    createdAt: string;
  }>({
    queryKey: ['session-snapshot', openSnapshot],
    queryFn: () =>
      fetch(`/api/v1/memory/session-messages/${encodeURIComponent(openSnapshot!)}`).then((r) => r.json()),
    enabled: openSnapshot !== null,
  });

  const list = Array.isArray(snapshots) ? snapshots : [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon="🗂"
        title="No persisted sessions"
        description="Message history is snapshotted when a session is disposed (idle timeout or shutdown)."
      />
    );
  }

  return (
    <div className="divide-y divide-zinc-800">
      {list.map((snap) => (
        <div key={snap.id}>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-zinc-800/30 text-left"
            onClick={() => setOpenSnapshot(openSnapshot === snap.id ? null : snap.id)}
          >
            <span className="text-zinc-500">{openSnapshot === snap.id ? '▾' : '▸'}</span>
            <span className="text-zinc-300">{new Date(snap.createdAt).toLocaleString()}</span>
            <span className="text-zinc-500 ml-auto">{snap.messageCount} messages</span>
          </button>
          {openSnapshot === snap.id && (
            <div className="px-4 pb-4 space-y-2">
              {detailLoading ? (
                <div className="text-xs text-zinc-500 py-2">Loading messages…</div>
              ) : (
                (detail?.messages ?? []).map((msg, i) => {
                  const text = messageText(msg);
                  if (!text.trim()) return null;
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={i}
                      className={`rounded-lg px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed border ${
                        isUser
                          ? 'bg-zinc-800/60 border-zinc-700 text-zinc-300'
                          : 'bg-indigo-500/5 border-indigo-500/20 text-zinc-200'
                      }`}
                    >
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                        {msg.role ?? 'message'}
                      </div>
                      {text.length > 2000 ? `${text.slice(0, 2000)}…` : text}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EventsTab({ agentId }: { agentId: string }) {
  const events = useEventBus({ agentId });
  const shown = [...events].reverse().slice(0, 50);

  if (shown.length === 0) {
    return (
      <EmptyState
        icon="📡"
        title="No events"
        description="Events for this agent will appear here in real-time."
      />
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-zinc-900">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-zinc-400 w-32">Type</th>
            <th className="text-left px-4 py-2 font-medium text-zinc-400">Data</th>
            <th className="text-right px-4 py-2 font-medium text-zinc-400 w-20">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {shown.map((e, i) => (
            <tr key={e.id ?? i} className="hover:bg-zinc-800/30">
              <td className="px-4 py-2 font-mono text-indigo-400 align-top">{e.type}</td>
              <td className="px-4 py-2 text-zinc-400 truncate max-w-xs">
                {typeof e.data === 'object' ? JSON.stringify(e.data).slice(0, 120) : String(e.data)}
              </td>
              <td className="px-4 py-2 text-right text-zinc-500 align-top whitespace-nowrap">
                {new Date(e.ts).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TasksTab({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => fetch('/api/v1/tasks?limit=100').then((r) => r.json()),
    staleTime: 5_000,
  });

  const allTasks: Task[] = Array.isArray(data?.tasks) ? data.tasks : [];
  const agentTasks = allTasks.filter((t) => t.agentId === agentId);

  if (agentTasks.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="No tasks"
        description="This agent has not run any tasks yet."
      />
    );
  }

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-zinc-900">
        <tr>
          <th className="text-left px-4 py-2 font-medium text-zinc-400 w-8"></th>
          <th className="text-left px-4 py-2 font-medium text-zinc-400">Description</th>
          <th className="text-left px-4 py-2 font-medium text-zinc-400">Status</th>
          <th className="text-right px-4 py-2 font-medium text-zinc-400">Age</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-800">
        {agentTasks.map((task) => (
          <tr
            key={task.id}
            onClick={() => navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })}
            className="hover:bg-zinc-800/50 cursor-pointer"
          >
            <td className="px-4 py-2.5">
              <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[task.status] ?? 'bg-zinc-500'}`} />
            </td>
            <td className="px-4 py-2.5 max-w-xs">
              <span className="truncate block text-zinc-200">{task.description}</span>
            </td>
            <td className="px-4 py-2.5">
              <StatusPill status={STATUS_TO_PILL[task.status] ?? 'idle'} />
            </td>
            <td className="px-4 py-2.5 text-right text-zinc-500">
              {formatAge(task.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CapabilitiesTab({ agent }: { agent: AgentDetail }) {
  if (agent.capabilities.length === 0) {
    return (
      <EmptyState
        icon="🧠"
        title="No capabilities"
        description="This agent has no capabilities configured."
      />
    );
  }

  return (
    <div className="p-4 space-y-1">
      <p className="text-[11px] text-zinc-500 px-3 pb-2">
        Routing tags used by the SkillRouter. Tags with a matching{' '}
        <Link to="/skills" search={{ name: undefined }} className="text-sky-400 hover:text-sky-300 underline">SKILL.md</Link>{' '}
        link to that skill; the rest are tag-only.
      </p>
      {agent.capabilities.map((cap) => {
        const loaded = agent.skillsLoaded.find((s) => s.name === cap);
        const className = 'flex items-center justify-between px-3 py-2 rounded transition-colors';
        const content = (
          <>
            <span className="text-sm text-zinc-200">{cap}</span>
            {loaded ? (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                skill
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                tag
              </span>
            )}
          </>
        );
        return loaded ? (
          <Link
            key={cap}
            to="/skills"
            search={{ name: cap }}
            className={`${className} hover:bg-zinc-800/60`}
          >
            {content}
          </Link>
        ) : (
          <div key={cap} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Main detail panel
// ──────────────────────────────────────────────────────────────────

function AgentDetail({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('events');

  const { data: agent, isLoading } = useQuery<AgentDetail>({
    queryKey: ['agent', agentId],
    queryFn: () => fetch(`/api/v1/agents/${agentId}`).then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const handleStop = async () => {
    if (!window.confirm(`Stop agent "${agentId}"? Running tasks will be marked failed.`)) return;
    setStopping(true);
    try {
      await fetch(`/api/v1/agents/${agentId}/stop`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } finally {
      setStopping(false);
    }
  };

  const handleResetBudget = async () => {
    if (!window.confirm(`Reset the token budget window for "${agentId}"? Usage counted so far this window is cleared and dispatch is unblocked.`)) return;
    setResetting(true);
    try {
      await fetch(`/api/v1/agents/${agentId}/budget/reset`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } finally {
      setResetting(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading…</div>;
  }

  if (!agent || (agent as any).error) {
    return (
      <EmptyState
        icon="🔍"
        title="Agent not found"
        description={`No agent with id "${agentId}".`}
      />
    );
  }

  const pillStatus = STATUS_PILL_MAP[agent.status] ?? 'idle';
  const hasSession = !!agent.session;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-zinc-300">{agentInitials(agentId)}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-zinc-100">{agentId}</h1>
              <StatusPill status={pillStatus} />
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
              <span>{agent.model}</span>
              <span>{agent.projectId}</span>
              <span className="capitalize">{agent.type}</span>
              {hasSession && (
                <span className="text-zinc-600">
                  idle in {formatIdleCountdown(agent.session!.msUntilIdle)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stop button */}
        <button
          onClick={handleStop}
          disabled={!hasSession || stopping}
          className="px-3 py-1.5 text-xs font-medium rounded border border-red-700/50 text-red-400 hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 px-6 py-4 border-b border-zinc-800 flex-shrink-0 sm:grid-cols-4">
        <StatCard
          label="Cost today"
          value={`€${agent.stats.costToday.toFixed(4)}`}
        />
        <StatCard
          label="Tasks today"
          value={`${agent.stats.tasksTodayComplete} / ${agent.stats.tasksToday}`}
          subline="complete"
        />
        <StatCard
          label="Avg latency P50"
          value={agent.stats.avgLatencyP50Ms !== null ? formatMs(agent.stats.avgLatencyP50Ms) : '—'}
        />
        <StatCard
          label="Skills loaded"
          value={agent.skillsLoaded.length}
        />
      </div>

      {/* Token budget */}
      {agent.budget && (
        <BudgetPanel
          budget={agent.budget}
          resetting={resetting}
          onReset={handleResetBudget}
        />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-zinc-800 flex-shrink-0">
        {(['events', 'tasks', 'capabilities', 'sessions'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'events' && <EventsTab agentId={agentId} />}
        {activeTab === 'tasks' && <TasksTab agentId={agentId} />}
        {activeTab === 'capabilities' && <CapabilitiesTab agent={agent} />}
        {activeTab === 'sessions' && <SessionsTab agentId={agentId} />}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Route component
// ──────────────────────────────────────────────────────────────────

function AgentDetailPage() {
  const { agentId } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/v1/agents').then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const agents: AgentSummary[] = Array.isArray(data) ? data : [];

  return (
    <MasterDetail
      sidebar={
        isLoading ? (
          <div className="p-4 text-xs text-zinc-500">Loading…</div>
        ) : (
          <AgentSidebar agents={agents} activeId={agentId} />
        )
      }
    >
      {agentId ? (
        <AgentDetail agentId={agentId} />
      ) : (
        <EmptyState
          icon="🤖"
          title="Select an agent"
          description="Choose an agent from the list to see its details."
        />
      )}
    </MasterDetail>
  );
}
