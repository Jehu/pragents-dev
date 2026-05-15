import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { MasterDetail, StatusPill, EmptyState } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';

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

  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/v1/agents').then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const agents: AgentSummary[] = Array.isArray(data) ? data : [];

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
        isLoading ? (
          <div className="p-4 text-xs text-zinc-500">Loading…</div>
        ) : (
          <AgentSidebar agents={agents} />
        )
      }
    >
      <EmptyState
        icon="🤖"
        title="Select an agent"
        description="Choose an agent from the list to see its details."
      />
    </MasterDetail>
  );
}
