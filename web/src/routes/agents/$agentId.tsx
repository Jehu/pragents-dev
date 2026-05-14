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
  skills: string[];
  status: AgentStatus;
}

interface AgentDetail {
  id: string;
  type: string;
  projectId: string;
  model: string;
  skills: string[];
  status: AgentStatus;
  session: { id: string; startedAt: string; idleTimeoutMs: number; msUntilIdle: number } | null;
  stats: {
    tasksToday: number;
    tasksTodayComplete: number;
    avgLatencyP50Ms: number | null;
    costToday: number;
  };
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

type Tab = 'events' | 'tasks' | 'skills';

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

function SkillsTab({ agent }: { agent: AgentDetail }) {
  if (agent.skills.length === 0) {
    return (
      <EmptyState
        icon="🧠"
        title="No skills"
        description="This agent has no skills configured."
      />
    );
  }

  return (
    <div className="p-4 space-y-1">
      {agent.skills.map((skill) => {
        const loaded = agent.skillsLoaded.find((s) => s.name === skill);
        return (
          <Link
            key={skill}
            to="/skills"
            search={{ name: skill }}
            className="flex items-center justify-between px-3 py-2 rounded hover:bg-zinc-800/60 transition-colors"
          >
            <span className="text-sm text-zinc-200">{skill}</span>
            {loaded?.jit && (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                jit
              </span>
            )}
          </Link>
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

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-zinc-800 flex-shrink-0">
        {(['events', 'tasks', 'skills'] as Tab[]).map((tab) => (
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
        {activeTab === 'skills' && <SkillsTab agent={agent} />}
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
