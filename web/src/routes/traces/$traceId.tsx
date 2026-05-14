import React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

export const Route = createFileRoute('/traces/$traceId')({
  component: TraceDetail,
});

function TraceDetail() {
  const { traceId } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetch(`/api/v1/traces/${traceId}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-6 text-zinc-400 text-sm">Loading trace…</div>;
  if (!data || (data as any).error) {
    return <div className="p-6 text-red-400 text-sm">{(data as any)?.error ?? 'Trace not found.'}</div>;
  }

  const trace = data as any;

  return (
    <div className="p-6 max-w-3xl">
      <Link to="/traces" search={{} as never} className="text-indigo-400 text-xs mb-4 inline-block hover:underline">
        ← Back to traces
      </Link>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mt-2">
        <h2 className="text-lg font-bold text-zinc-100 mb-4">Trace Detail</h2>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <span className="text-zinc-500">Type: </span>
            <span className="font-medium text-zinc-200">{trace.type}</span>
          </div>
          <div>
            <span className="text-zinc-500">ID: </span>
            <span className="font-mono text-zinc-300">{trace.id}</span>
          </div>
          <div>
            <span className="text-zinc-500">Agent: </span>
            {trace.agentId ? (
              <Link
                to="/agents/$agentId"
                params={{ agentId: trace.agentId }}
                className="text-indigo-400 hover:underline"
              >
                {trace.agentId}
              </Link>
            ) : (
              <span className="text-zinc-600">—</span>
            )}
          </div>
          <div>
            <span className="text-zinc-500">Project: </span>
            <span className="text-zinc-200">{trace.projectId || '—'}</span>
          </div>
          {trace.taskId && (
            <div className="col-span-2">
              <span className="text-zinc-500">Task: </span>
              <Link
                to="/tasks/$taskId"
                params={{ taskId: trace.taskId }}
                className="text-indigo-400 font-mono hover:underline"
              >
                {trace.taskId}
              </Link>
            </div>
          )}
          <div className="col-span-2">
            <span className="text-zinc-500">Timestamp: </span>
            <span className="text-zinc-200">{new Date(trace.timestamp).toLocaleString()}</span>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Data</h3>
          <pre className="text-xs bg-zinc-950 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap text-zinc-300 font-mono">
            {JSON.stringify(trace.data, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
