import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { StatusPill, EmptyState } from '../../components/ui/index.js';
import { formatDuration, formatCost } from './index.js';
import type { StatusType } from '../../components/ui/index.js';

export const Route = createFileRoute('/tasks/$taskId')({
  component: TaskDetail,
});

const STATUS_TO_PILL: Record<string, StatusType> = {
  pending: 'idle',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  needs_review: 'needs_review',
  blocked: 'idle',
};

function fmt(isoDate: string | null): string {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleString();
}

function TaskDetail() {
  const { taskId } = Route.useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetch(`/api/v1/tasks/${taskId}`).then((r) => r.json()),
  });

  const { data: traces } = useQuery({
    queryKey: ['task-traces', taskId],
    queryFn: () => fetch(`/api/v1/traces?taskId=${taskId}&limit=50`).then((r) => r.json()),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading…</div>;
  }

  if (!data || data.error) {
    return (
      <EmptyState
        icon="🔍"
        title="Task not found"
        description={data?.error ?? 'This task does not exist or has been removed.'}
      />
    );
  }

  const task = data;
  const traceList: any[] = Array.isArray(traces) ? traces : [];
  const firstTrace = traceList[0];
  const pillStatus = STATUS_TO_PILL[task.status] ?? 'idle';

  return (
    <div className="p-6 max-w-3xl">
      {/* Back */}
      <Link to="/tasks" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4 inline-flex items-center gap-1">
        ← Tasks
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mt-2 mb-6">
        <h1 className="text-xl font-semibold text-zinc-100 leading-snug">{task.description}</h1>
        <StatusPill status={pillStatus} className="flex-shrink-0 mt-1" />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-zinc-500 mb-6">
        <span>
          Agent:{' '}
          <button
            onClick={() => navigate({ to: '/agents/$agentId', params: { agentId: task.agentId } })}
            className="text-indigo-400 hover:text-indigo-300"
          >
            {task.agentId}
          </button>
        </span>
        <span>Project: <span className="text-zinc-400">{task.projectId}</span></span>
        <span className="font-mono text-zinc-600">{task.id}</span>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Status Timeline */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">Timeline</h2>
          <ol className="relative border-l border-zinc-700 space-y-4 ml-2">
            {[
              { label: 'Created', ts: task.createdAt, active: true },
              { label: 'Started', ts: task.startedAt, active: !!task.startedAt },
              {
                label: task.status === 'failed' ? 'Failed' : 'Completed',
                ts: task.completedAt,
                active: !!task.completedAt,
                error: task.status === 'failed',
              },
            ].map((step) => (
              <li key={step.label} className="pl-4">
                <span
                  className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-zinc-900 ${
                    step.error ? 'bg-red-400' :
                    step.active ? 'bg-emerald-400' : 'bg-zinc-600'
                  }`}
                />
                <p className={`text-xs font-medium ${step.active ? 'text-zinc-200' : 'text-zinc-500'}`}>
                  {step.label}
                </p>
                <time className="text-[11px] text-zinc-500">{fmt(step.ts)}</time>
              </li>
            ))}
          </ol>

          {/* Trace link */}
          {firstTrace && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <Link
                to="/traces/$traceId"
                params={{ traceId: firstTrace.id }}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                View trace {firstTrace.id?.slice(0, 8)} →
              </Link>
            </div>
          )}
        </div>

        {/* Cost box */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">Cost & Tokens</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Cost</span>
              <span className="text-sm font-mono text-zinc-200">{formatCost(task.costEur)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Tokens in</span>
              <span className="text-sm font-mono text-zinc-300">{task.tokensIn?.toLocaleString() ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Tokens out</span>
              <span className="text-sm font-mono text-zinc-300">{task.tokensOut?.toLocaleString() ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Duration</span>
              <span className="text-sm font-mono text-zinc-300">{formatDuration(task.durationMs)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Result */}
      {task.result && (
        <div className="mt-6 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Result</h2>
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{task.result}</pre>
        </div>
      )}

      {/* Reason for needs_review/failed */}
      {task.reason && (
        <div className="mt-4 bg-amber-900/20 border border-amber-700/40 rounded-lg p-4">
          <p className="text-xs text-amber-400 font-medium mb-1">Reason</p>
          <p className="text-sm text-amber-300">{task.reason}</p>
        </div>
      )}
    </div>
  );
}
