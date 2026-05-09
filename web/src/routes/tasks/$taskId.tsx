import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

const API = '';

export const Route = createFileRoute('/tasks/$taskId')({
  component: TaskDetail,
});

function TaskDetail() {
  const { taskId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetch(`${API}/api/v1/tasks/${taskId}`).then((r) => r.json()),
  });

  if (!data) return <p className="text-gray-400">Loading task...</p>;
  if (data.error) return <p className="text-red-500">{data.error}</p>;

  const task = data as any;

  return (
    <div className="max-w-3xl">
      <a href="/tasks" className="text-blue-600 text-sm mb-4 inline-block">← Back to tasks</a>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mt-2">
        {task.status === 'needs_review' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
            This task was interrupted. Review the partial results or re-dispatch.
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

        <div className="border-t border-gray-200 pt-4 mt-4 flex gap-3">
          <a href="/traces" className="text-blue-600 text-sm hover:underline">View related traces →</a>
        </div>
      </div>
    </div>
  );
}
