import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

const API = 'http://localhost:3000';

export const Route = createFileRoute('/tasks/')({
  component: TasksList,
});

function TasksList() {
  const { data } = useQuery({
    queryKey: ['tasks-list'],
    queryFn: () => fetch(`${API}/api/v1/tasks`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const tasks = Array.isArray(data) ? data : [];

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">Tasks</h2>
      {tasks.length === 0 ? (
        <p className="text-gray-400">No tasks yet</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t: any) => (
            <a
              key={t.id}
              href={`/tasks/${t.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{t.description}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  t.status === 'complete' ? 'bg-green-100 text-green-700' :
                  t.status === 'failed' ? 'bg-red-100 text-red-700' :
                  t.status === 'running' ? 'bg-blue-100 text-blue-700' :
                  t.status === 'needs_review' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-500'
                }`}>{t.status}</span>
              </div>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>{t.agentId}</span>
                <span>{t.projectId}</span>
                <span>{new Date(t.createdAt).toLocaleString()}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
