import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useScopeStore } from '../stores/scope';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

const API = '';

const EVENT_LABELS: Record<string, string> = {
  'task.running': 'Task started',
  'task.complete': 'Task completed',
  'task.failed': 'Task failed',
  'task.retried': 'Task retried',
  'task.manual_complete': 'Manually completed',
  'task.deleted': 'Task deleted',
  'task.unblocked': 'Task unblocked',
  'gate.approved': 'Gate approved',
  'gate.rejected': 'Gate rejected',
  'skill.proposed': 'Skill proposal created',
  'skill.approved': 'Skill activated',
  'skill.rejected': 'Skill rejected',
};

function labelFor(type: string): string {
  return EVENT_LABELS[type] || type;
}

function Dashboard() {
  const { selectedProject, selectedAgent, setProject, setAgent } = useScopeStore();
  const queryClient = useQueryClient();

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetch(`${API}/api/v1/projects`).then((r) => r.json()),
  });

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetch(`${API}/api/v1/agents`).then((r) => r.json()),
  });

  // Recent traces for activity stream
  const { data: traces } = useQuery({
    queryKey: ['dashboard-traces'],
    queryFn: () => fetch(`${API}/api/v1/traces?limit=30`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  // Recent tasks for task summary
  const { data: taskData } = useQuery({
    queryKey: ['tasks-list', ''],
    queryFn: () => fetch(`${API}/api/v1/tasks?limit=10`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/v1/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject || undefined,
          agentId: selectedAgent || undefined,
          description: description.trim(),
        }),
      });
      if (res.ok) {
        setDescription('');
        const target = selectedAgent || 'default agent';
        setToast(`Task dispatched to ${target}`);
        setTimeout(() => setToast(''), 3000);
        queryClient.invalidateQueries({ queryKey: ['tasks-list'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-traces'] });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const projectList = Array.isArray(projects) ? projects : [];
  const agentList = Array.isArray(agents) ? agents : [];
  const traceList = Array.isArray(traces) ? traces : [];
  const tasks = Array.isArray(taskData?.tasks) ? taskData.tasks : [];
  const totalTasks = taskData?.total || 0;

  return (
    <div className="flex flex-col gap-6">
      {toast && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}

      <div className="flex gap-6">
        {/* Recent Activity */}
        <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Recent Activity</h2>
          {traceList.length === 0 ? (
            <p className="text-gray-400 text-sm">No activity yet</p>
          ) : (
            <div className="space-y-2">
              {traceList.slice(0, 15).map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 text-sm border-b border-gray-100 dark:border-gray-700 pb-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 w-24 flex-shrink-0 truncate">{e.agentId || '—'}</span>
                  <span className="text-gray-600 dark:text-gray-400 flex-1">{labelFor(e.type)}</span>
                  {e.taskId && (
                    <Link to="/tasks/$taskId" params={{ taskId: e.taskId }} className="text-blue-500 text-xs font-mono hover:underline flex-shrink-0">
                      {e.taskId.slice(0, 8)}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Grid + Task Summary */}
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Agents</h2>
            {agentList.length === 0 ? (
              <p className="text-gray-400 text-sm">No agents configured</p>
            ) : (
              <div className="space-y-2">
                {agentList.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium dark:text-gray-200 truncate">{a.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      a.status === 'busy' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                      a.status === 'idle' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                      'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}>{a.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Tasks
              <Link to="/tasks" className="text-blue-500 font-normal normal-case text-xs ml-2">view all ({totalTasks}) →</Link>
            </h2>
            {tasks.length === 0 ? (
              <p className="text-gray-400 text-sm">No tasks yet</p>
            ) : (
              <div className="space-y-1">
                {tasks.map((t: any) => (
                  <Link key={t.id} to="/tasks/$taskId" params={{ taskId: t.id }} className="text-sm flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 py-0.5">
                    <span className="truncate max-w-40 dark:text-gray-300">{t.description}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      t.status === 'complete' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                      t.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      t.status === 'running' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                      t.status === 'needs_review' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' :
                      'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    }`}>{t.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task Input Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">Project</label>
            <select
              value={selectedProject}
              onChange={(e) => setProject(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">Any</option>
              {projectList.map((p: any) => (
                <option key={p.id || p.name} value={p.id || p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">Agent</label>
            <select
              value={selectedAgent || ''}
              onChange={(e) => setAgent(e.target.value || '')}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">Any agent</option>
              {agentList.map((a: any) => (
                <option key={a.id} value={a.id}>{a.id}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">Task description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Describe the task..."
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm flex-1 bg-white dark:bg-gray-700 dark:text-gray-200"
              disabled={submitting}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !description.trim() || !selectedAgent}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Dispatching...' : 'Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}
