import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

export const Route = createFileRoute('/traces/')({
  component: TracesList,
});

const EVENT_LABELS: Record<string, string> = {
  'agent_start': 'Agent started',
  'agent_end': 'Completed task',
  'task_created': 'Task dispatched',
  'task_completed': 'Task completed',
  'task_failed': 'Task failed',
  'task_blocked': 'Task blocked',
  'task_needs_review': 'Task interrupted',
  'gate_approved': 'Gate approved',
  'gate_rejected': 'Gate rejected',
  'skill_proposed': 'Skill proposal',
  'skill_approved': 'Skill activated',
  'skill_rejected': 'Skill rejected',
  'workflow_started': 'Workflow started',
  'workflow_completed': 'Workflow completed',
  'workflow_failed': 'Workflow failed',
};

function labelFor(type: string): string {
  return EVENT_LABELS[type] || type;
}

function TracesList() {
  const navigate = useNavigate();
  const [taskFilter, setTaskFilter] = useState('');

  const params = new URLSearchParams();
  if (taskFilter) params.set('taskId', taskFilter);
  params.set('limit', '50');

  const { data } = useQuery({
    queryKey: ['traces', taskFilter],
    queryFn: () => fetch(`/api/v1/traces?${params.toString()}`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const events = Array.isArray(data) ? data : [];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Traces</h2>
        <input
          type="text"
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          placeholder="Filter by task ID..."
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        />
      </div>
      {events.length === 0 ? (
        <p className="text-gray-400">No traces recorded yet</p>
      ) : (
        <div className="space-y-1">
          {events.map((e: any) => (
            <div
              key={e.id}
              onClick={() => navigate({ to: `/traces/${e.id}` })}
              className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm cursor-pointer hover:border-blue-300 transition-colors"
            >
              <span className="text-xs text-gray-400 w-20 flex-shrink-0">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className="font-medium w-24 flex-shrink-0">{e.agentId || '—'}</span>
              <span className="text-gray-600 flex-1">{labelFor(e.type)}</span>
              {e.taskId && <span className="text-xs text-gray-400 font-mono">{e.taskId.slice(0, 8)}</span>}
              {e.data?.tool && <span className="text-blue-600 text-xs">{e.data.tool}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
