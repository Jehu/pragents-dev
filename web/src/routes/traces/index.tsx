import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

const API = 'http://localhost:3000';

export const Route = createFileRoute('/traces/')({
  component: TracesList,
});

function TracesList() {
  const { data } = useQuery({
    queryKey: ['traces'],
    queryFn: () => fetch(`${API}/api/v1/traces`).then((r) => r.json()),
    refetchInterval: 3000,
  });

  const events = Array.isArray(data) ? data : [];

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">Traces</h2>
      {events.length === 0 ? (
        <p className="text-gray-400">No traces recorded yet</p>
      ) : (
        <div className="space-y-2">
          {events.map((e: any) => (
            <div key={e.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm">
              <span className="text-xs text-gray-400 w-20">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className="font-medium w-24">{e.agentId || '—'}</span>
              <span className="text-gray-600">{e.type}</span>
              {e.data?.tool && <span className="text-blue-600">{e.data.tool}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
