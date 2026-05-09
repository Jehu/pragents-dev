import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

const API = '';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'complete', label: 'Complete' },
  { value: 'failed', label: 'Failed' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'pending', label: 'Pending' },
];

export const Route = createFileRoute('/tasks/')({
  component: TasksList,
});

function TasksList() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const { data } = useQuery({
    queryKey: ['tasks-list', statusFilter, page],
    queryFn: () => fetch(`${API}/api/v1/tasks?${params.toString()}`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const taskData = data || {};
  const tasks = Array.isArray(taskData.tasks) ? taskData.tasks : [];
  const total = taskData.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Tasks</h2>
        <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setStatusFilter(opt.value); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="text-gray-400">No tasks found</p>
      ) : (
        <>
          <div className="space-y-2">
            {tasks.map((t: any) => (
              <a
                key={t.id}
                href={`/tasks/${t.id}`}
                className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium truncate flex-1 mr-4">{t.description}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    t.status === 'complete' ? 'bg-green-100 text-green-700' :
                    t.status === 'failed' ? 'bg-red-100 text-red-700' :
                    t.status === 'running' ? 'bg-blue-100 text-blue-700' :
                    t.status === 'needs_review' ? 'bg-amber-100 text-amber-700' :
                    t.status === 'blocked' ? 'bg-purple-100 text-purple-700' :
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

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
              >← Prev</button>
              <span className="text-gray-500">
                Page {page} of {totalPages} ({total} tasks)
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
              >Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
