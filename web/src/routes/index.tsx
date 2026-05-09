import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

const API = '';

function Dashboard() {
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetch(`${API}/api/v1/agents`).then((r) => r.json()),
  });

  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => fetch(`${API}/api/v1/tasks`).then((r) => r.json()),
  });

  const { data: events } = useQuery({
    queryKey: ['events'],
    queryFn: () => fetch(`${API}/api/v1/traces?limit=20`).then((r) => r.json()),
    refetchInterval: 3000,
  });

  const [selectedProject, setSelectedProject] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
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
          projectId: selectedProject || 'kunde-webshop',
          agentId: selectedAgent || 'dev@kunde-webshop',
          description: description.trim(),
        }),
      });
      if (res.ok) {
        setDescription('');
        setToast(`Task dispatched to ${selectedAgent || 'dev@kunde-webshop'}`);
        setTimeout(() => setToast(''), 3000);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const agentList = Array.isArray(agents) ? agents : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const eventList = Array.isArray(events) ? events : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}

      <div className="flex gap-6">
        {/* Activity Stream — Primary */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.activity-stream">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity</h2>
          {eventList.length === 0 ? (
            <p className="text-gray-400 text-sm">No activity yet</p>
          ) : (
            <div className="space-y-2">
              {eventList.slice(0, 15).map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 text-sm border-b border-gray-100 pb-2">
                  <span className="text-xs text-gray-400 w-20 flex-shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-medium text-gray-700 w-24 flex-shrink-0">{e.agentId || '—'}</span>
                  <span className="text-gray-600">{e.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Grid + Task List — Secondary */}
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.agent-grid">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Agents</h2>
            {agentList.length === 0 ? (
              <p className="text-gray-400 text-sm">No agents configured</p>
            ) : (
              <div className="space-y-2">
                {agentList.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{a.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      a.status === 'busy' ? 'bg-blue-100 text-blue-700' :
                      a.status === 'idle' ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>{a.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.task-list">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Tasks <a href="/tasks" className="text-blue-500 font-normal normal-case text-xs ml-2">view all →</a>
            </h2>
            {taskList.length === 0 ? (
              <p className="text-gray-400 text-sm">No tasks yet</p>
            ) : (
              <div className="space-y-1">
                {taskList.slice(0, 5).map((t: any) => (
                  <div key={t.id} className="text-sm flex items-center justify-between">
                    <span className="truncate max-w-40">{t.description}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      t.status === 'complete' ? 'bg-green-100 text-green-700' :
                      t.status === 'failed' ? 'bg-red-100 text-red-700' :
                      t.status === 'running' ? 'bg-blue-100 text-blue-700' :
                      t.status === 'needs_review' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task Input Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.task-input-bar">
        <div className="flex gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Project</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">All projects</option>
              <option value="kunde-webshop">kunde-webshop</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Any agent</option>
              {agentList.map((a: any) => (
                <option key={a.id} value={a.id}>{a.id}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-gray-500">Task description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Describe the task..."
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
              disabled={submitting}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !description.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Dispatching...' : 'Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}
