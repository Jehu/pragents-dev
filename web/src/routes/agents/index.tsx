import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { MasterDetail, StatusPill, EmptyState, ErrorState, LoadingState } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';
import { fetchJson } from '../../lib/api.js';
import { useScopeStore } from '../../stores/scope.js';
import { agentsInScope } from '../../lib/scope.js';

export const Route = createFileRoute('/agents/')({
  component: AgentsPage,
});

type AgentStatus = 'busy' | 'idle' | 'offline';

interface AgentSummary {
  id: string;
  type: string;
  projectId: string;
  model: string;
  capabilities: string[];
  status: AgentStatus;
}

const STATUS_ORDER: Record<AgentStatus, number> = { busy: 0, idle: 1, offline: 2 };

const STATUS_PILL_MAP: Record<AgentStatus, StatusType> = {
  busy: 'busy',
  idle: 'idle',
  offline: 'cold',
};

function agentInitials(id: string): string {
  return id
    .split(/[-_]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function AgentSidebar({ agents }: { agents: AgentSummary[] }) {
  const navigate = useNavigate();

  // Model health from the health endpoint: agents whose configured model is
  // unusable (unknown id / missing provider key) get a warning marker —
  // previously they looked perfectly fine while every run failed silently.
  const { data: health } = useQuery<{ models?: Array<{ model: string; ok: boolean; resolvable: boolean; keyPresent: boolean; provider: string }> }>({
    queryKey: ['health'],
    queryFn: () => fetchJson('/api/v1/health'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const brokenModels = new Map(
    (health?.models ?? []).filter((m) => !m.ok).map((m) => [m.model, m]),
  );

  if (agents.length === 0) {
    return (
      <EmptyState
        icon="Agents"
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
      {sorted.map((agent) => (
        <Link
          key={agent.id}
          to="/agents/$agentId"
          params={{ agentId: agent.id }}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-800/60 transition-colors cursor-pointer"
          activeProps={{ className: 'flex items-center gap-2.5 px-3 py-2 bg-indigo-600/20 border-l-2 border-indigo-500 cursor-pointer' }}
          inactiveProps={{ className: 'flex items-center gap-2.5 px-3 py-2 border-l-2 border-transparent hover:bg-zinc-800/60 transition-colors cursor-pointer' }}
        >
          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-zinc-300">{agentInitials(agent.id)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-zinc-200 truncate">{agent.id}</span>
              <StatusPill status={STATUS_PILL_MAP[agent.status] ?? 'idle'} />
              {brokenModels.has(agent.model) && (
                <span
                  title={`Model "${agent.model}" is unusable — ${
                    !brokenModels.get(agent.model)!.resolvable
                      ? 'unknown model id'
                      : `no API key for "${brokenModels.get(agent.model)!.provider}"`
                  }`}
                  className="text-amber-400 text-[11px]"
                  role="img"
                  aria-label="Model unusable"
                >
                  ⚠
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 truncate">{agent.projectId}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function AgentsPage() {
  const navigate = useNavigate();
  const selectedProject = useScopeStore((s) => s.selectedProject);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetchJson<AgentSummary[]>('/api/v1/agents'),
    refetchInterval: 30_000,
  });

  const allAgents: AgentSummary[] = Array.isArray(data) ? data : [];
  const agents = agentsInScope(allAgents, selectedProject);

  // Auto-navigate to first agent on load
  useEffect(() => {
    if (agents.length > 0) {
      const sorted = [...agents].sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3),
      );
      navigate({ to: '/agents/$agentId', params: { agentId: sorted[0].id }, replace: true });
    }
  }, [agents, navigate]);

  return (
    <MasterDetail
      sidebar={
        error ? (
          <div className="p-3">
            <ErrorState title="Agents failed to load" error={error} onRetry={() => void refetch()} />
          </div>
        ) : isLoading ? (
          <LoadingState label="Loading agents" />
        ) : (
          <AgentSidebar agents={agents} />
        )
      }
    >
      <EmptyState
        icon="Agents"
        title="Select an agent"
        description="Choose an agent from the list to see its details."
      />
    </MasterDetail>
  );
}
