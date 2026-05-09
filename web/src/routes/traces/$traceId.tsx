import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

export const Route = createFileRoute('/traces/$traceId')({
  component: TraceDetail,
});

function TraceDetail() {
  const { traceId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetch(`/api/v1/traces/${traceId}`).then((r) => r.json()),
  });

  if (!data) return <p className="text-gray-400">Loading trace...</p>;
  if (data.error) return <p className="text-red-500">{data.error}</p>;

  const trace = data as any;

  return (
    <div className="max-w-3xl">
      <Link to="/traces" className="text-blue-600 text-sm mb-4 inline-block">← Back to traces</Link>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mt-2">
        <h2 className="text-lg font-bold mb-4">Trace Detail</h2>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div><span className="text-gray-500">Type:</span> <span className="font-medium">{trace.type}</span></div>
          <div><span className="text-gray-500">ID:</span> <span className="font-mono">{trace.id}</span></div>
          <div><span className="text-gray-500">Agent:</span> <span className="font-medium">{trace.agentId || '—'}</span></div>
          <div><span className="text-gray-500">Project:</span> <span className="font-medium">{trace.projectId || '—'}</span></div>
          {trace.taskId && (
            <div className="col-span-2">
              <span className="text-gray-500">Task:</span>{' '}
              <Link to="/tasks/$taskId" params={{ taskId: trace.taskId }} className="text-blue-600 font-mono hover:underline">
                {trace.taskId}
              </Link>
            </div>
          )}
          <div className="col-span-2"><span className="text-gray-500">Timestamp:</span> <span className="font-medium">{new Date(trace.timestamp).toLocaleString()}</span></div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Data</h3>
          <pre className="text-sm bg-gray-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(trace.data, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
