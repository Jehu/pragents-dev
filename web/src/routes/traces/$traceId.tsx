import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

const API = 'http://localhost:3000';

export const Route = createFileRoute('/traces/$traceId')({
  component: TraceDetail,
});

function TraceDetail() {
  const { traceId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetch(`${API}/api/v1/traces/${traceId}`).then((r) => r.json()),
  });

  if (!data) return <p className="text-gray-400">Loading trace...</p>;

  const trace = data as any;

  return (
    <div className="max-w-4xl">
      <a href="/traces" className="text-blue-600 text-sm mb-4 inline-block">← Back to traces</a>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mt-2">
        <h2 className="text-lg font-bold mb-4">Trace #{trace.id}</h2>
        <div className="space-y-4 text-sm">
          <div className="flex gap-4">
            <span className="text-gray-500">Type:</span>
            <span className="font-medium">{trace.type}</span>
          </div>
          <div className="flex gap-4">
            <span className="text-gray-500">Agent:</span>
            <span className="font-medium">{trace.agentId || '—'}</span>
          </div>
          <div className="flex gap-4">
            <span className="text-gray-500">Project:</span>
            <span className="font-medium">{trace.projectId}</span>
          </div>
          <div className="flex gap-4">
            <span className="text-gray-500">Timestamp:</span>
            <span className="font-medium">{trace.timestamp}</span>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Raw event data</summary>
            <pre className="mt-2 p-3 bg-gray-50 rounded-lg text-xs overflow-x-auto">
              {JSON.stringify(trace.data, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
