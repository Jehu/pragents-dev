import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export const Route = createFileRoute('/tasks/$taskId')({
  component: TaskDetail,
});

const API = '';

function TaskDetail() {
  const { taskId } = Route.useParams();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetch(`${API}/api/v1/tasks/${taskId}`).then((r) => r.json()),
  });

  // Task timeline
  const { data: traces } = useQuery({
    queryKey: ['task-traces', taskId],
    queryFn: () => fetch(`${API}/api/v1/traces?taskId=${taskId}&limit=50`).then((r) => r.json()),
  });

  const handleAction = async (action: string) => {
    setActing(action);
    try {
      const method = action === 'delete' ? 'DELETE' : 'POST';
      const url = action === 'delete'
        ? `${API}/api/v1/tasks/${taskId}`
        : `${API}/api/v1/tasks/${taskId}/${action}`;
      await fetch(url, { method });
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks-list'] });
      queryClient.invalidateQueries({ queryKey: ['task-traces', taskId] });
    } finally {
      setActing(null);
    }
  };

  if (!data) return <p className="text-gray-400">Loading task...</p>;
  if (data.error) return <p className="text-red-500">{data.error}</p>;

  const task = data as any;
  const traceList = Array.isArray(traces) ? traces : [];

  return (
    <div className="max-w-3xl">
      <Link to="/tasks" className="text-blue-600 text-sm mb-4 inline-block">← Back to tasks</Link>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mt-2">
        {task.status === 'needs_review' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <div className="text-sm font-medium text-amber-800 mb-2">
              ⚠️ This task was interrupted and needs review.
            </div>
            {task.reason && (
              <div className="text-sm text-amber-700 mb-3">
                <span className="font-medium">Reason:</span> {task.reason}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleAction('retry')}
                disabled={acting !== null}
                className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
              >{acting === 'retry' ? 'Retrying...' : 'Retry Task'}</button>
              <button
                onClick={() => handleAction('complete')}
                disabled={acting !== null}
                className="bg-green-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-40"
              >{acting === 'complete' ? '...' : 'Mark Complete'}</button>
              <button
                onClick={() => handleAction('delete')}
                disabled={acting !== null}
                className="bg-red-100 text-red-700 px-4 py-1.5 rounded text-sm font-medium hover:bg-red-200 disabled:opacity-40"
              >{acting === 'delete' ? '...' : 'Delete'}</button>
            </div>
          </div>
        )}

        <h2 className="text-lg font-bold mb-4">{task.description}</h2>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <span className="text-gray-500">Status:</span>{' '}
            <span className={`font-medium ${
              task.status === 'complete' ? 'text-green-700' :
              task.status === 'failed' ? 'text-red-700' :
              task.status === 'needs_review' ? 'text-amber-700' :
              'text-blue-700'
            }`}>{task.status}</span>
          </div>
          <div><span className="text-gray-500">Agent:</span> <span className="font-medium">{task.agentId}</span></div>
          <div><span className="text-gray-500">Project:</span> <span className="font-medium">{task.projectId}</span></div>
          <div><span className="text-gray-500">Created:</span> <span className="font-medium">{new Date(task.createdAt).toLocaleString()}</span></div>
        </div>

        {task.result && (
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Result</h3>
            <pre className="text-sm bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{task.result}</pre>
          </div>
        )}

        {/* Task Timeline */}
        {traceList.length > 0 && (
          <div className="border-t border-gray-200 pt-4 mt-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Event Timeline</h3>
            <div className="space-y-1">
              {traceList.map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-xs text-gray-400 w-16 flex-shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-gray-600">{e.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 pt-4 mt-4">
          <Link
            to="/traces"
            search={{ taskId }}
            className="text-blue-600 text-sm hover:underline"
          >
            View all traces for this task →
          </Link>
        </div>
      </div>
    </div>
  );
}
