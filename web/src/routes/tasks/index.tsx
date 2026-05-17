import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { fetchJson } from '../../lib/api.js';

export const Route = createFileRoute('/tasks/')({
  component: TasksList,
});

type TaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'needs_review' | 'blocked';

export interface Task {
  id: string;
  projectId: string;
  agentId: string;
  status: TaskStatus;
  type: string;
  description: string;
  result: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  costEur: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number | null;
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'failed', label: 'Failed' },
  { value: 'complete', label: 'Complete' },
];

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-zinc-500',
  running: 'bg-sky-400',
  complete: 'bg-emerald-400',
  failed: 'bg-red-400',
  needs_review: 'bg-amber-400',
  blocked: 'bg-zinc-600',
};

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatCost(eur: number): string {
  if (!eur) return '—';
  return `€${eur.toFixed(4)}`;
}

export function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function filterTasks(tasks: Task[], activeTab: string, agentFilter: string): Task[] {
  return tasks.filter((t) => {
    if (activeTab !== 'all' && t.status !== activeTab) return false;
    if (agentFilter && t.agentId !== agentFilter) return false;
    return true;
  });
}

export function countByStatus(tasks: Task[], status: string): number {
  if (status === 'all') return tasks.length;
  return tasks.filter((t) => t.status === status).length;
}

function TasksList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');

  // SSE: invalidate on task.* events
  const busEvents = useEventBusStore((s) => s.events);
  useEffect(() => {
    const latest = busEvents[busEvents.length - 1];
    if (latest && typeof latest.type === 'string' && latest.type.startsWith('task.')) {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  }, [busEvents, queryClient]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => fetchJson<{ tasks?: Task[] }>('/api/v1/tasks?limit=100'),
    staleTime: 5_000,
  });

  const allTasks: Task[] = Array.isArray(data?.tasks) ? data.tasks : [];
  const agentIds = [...new Set(allTasks.map((t) => t.agentId))].filter(Boolean);
  const filtered = filterTasks(allTasks, activeTab, agentFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <PageHeader title="Tasks" />
        {agentIds.length > 0 && (
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1.5 outline-none hover:border-zinc-600"
          >
            <option value="">All agents</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-zinc-800 flex-shrink-0">
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={STATUS_TABS.map((tab) => ({
            ...tab,
            count: countByStatus(allTasks, tab.value),
          }))}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="p-6">
            <ErrorState title="Tasks failed to load" error={error} onRetry={() => void refetch()} />
          </div>
        ) : isLoading ? (
          <LoadingState label="Loading tasks" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="Tasks"
            title="No tasks"
            description={activeTab === 'all' ? 'No tasks have been created yet.' : `No ${activeTab} tasks.`}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-800 z-10">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-xs text-zinc-400 w-8"></th>
                <th className="text-left px-4 py-2 font-medium text-xs text-zinc-400">Description</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-zinc-400">Agent</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-zinc-400">Project</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-zinc-400">Duration</th>
                <th className="text-left px-4 py-2 font-medium text-xs text-zinc-400">Cost</th>
                <th className="text-right px-4 py-2 font-medium text-xs text-zinc-400">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => navigate({ to: '/tasks/$taskId', params: { taskId: task.id } })}
                  className="hover:bg-zinc-800/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[task.status] ?? 'bg-zinc-500'}`} />
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <span className="text-sm text-zinc-200 truncate block">{task.description}</span>
                    <span className="text-[11px] text-zinc-500 font-mono">{task.id.slice(0, 8)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-400 font-mono">{task.agentId}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-500">{task.projectId}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-400 font-mono">{formatDuration(task.durationMs)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-400 font-mono">{formatCost(task.costEur)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-zinc-500">{formatAge(task.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
