import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

// Root
export const rootRoute = createRootRoute({
  component: () => {
    const { Outlet } = require('@tanstack/react-router');
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-bold">pragents</h1>
            <nav className="flex gap-4 text-sm">
              <a href="/" className="hover:text-blue-600">Dashboard</a>
              <a href="/traces" className="hover:text-blue-600">Traces</a>
              <a href="/tasks" className="hover:text-blue-600">Tasks</a>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            connected
          </div>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    );
  },
});

// Dashboard
const DashboardComponent = () => {
  const { useState } = require('react');
  const { useQuery } = require('@tanstack/react-query');
  const API = 'http://localhost:3000';
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: () => fetch(`${API}/api/v1/agents`).then(r => r.json()) });
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => fetch(`${API}/api/v1/tasks`).then(r => r.json()) });
  const { data: events } = useQuery({ queryKey: ['events'], queryFn: () => fetch(`${API}/api/v1/traces?limit=20`).then(r => r.json()), refetchInterval: 3000 });

  const agentList = Array.isArray(agents) ? agents : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const eventList = Array.isArray(events) ? events : [];

  const dispatch = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${API}/api/v1/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject || 'kunde-webshop', agentId: selectedAgent || 'dev@kunde-webshop', description: description.trim() }),
      });
      setDescription('');
      setToast('Task dispatched');
      setTimeout(() => setToast(''), 3000);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      {toast && <div className="fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50">{toast}</div>}
      <div className="flex gap-6">
        <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity</h2>
          {eventList.length === 0 ? <p className="text-gray-400 text-sm">No activity yet</p> : (
            <div className="space-y-2">
              {eventList.slice(0, 15).map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 text-sm border-b border-gray-100 pb-2">
                  <span className="text-xs text-gray-400 w-20">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="font-medium text-gray-700 w-24">{e.agentId || '—'}</span>
                  <span className="text-gray-600">{e.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Agents</h2>
            {agentList.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-sm py-1">
                <span className="font-medium">{a.id}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'busy' ? 'bg-blue-100 text-blue-700' : a.status === 'idle' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{a.status}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Tasks <a href="/tasks" className="text-blue-500 font-normal text-xs ml-2">all →</a></h2>
            {taskList.slice(0, 5).map((t: any) => (
              <div key={t.id} className="text-sm flex items-center justify-between py-1">
                <span className="truncate max-w-40">{t.description}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'complete' ? 'bg-green-100 text-green-700' : t.status === 'running' ? 'bg-blue-100 text-blue-700' : t.status === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex gap-3 items-end">
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} onKeyDown={e => e.key === 'Enter' && dispatch()} placeholder="Describe the task..." className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1" disabled={submitting} />
          <button onClick={dispatch} disabled={submitting || !description.trim()} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{submitting ? '...' : 'Dispatch'}</button>
        </div>
      </div>
    </div>
  );
};

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardComponent,
});

// Traces
const TracesComponent = () => {
  const { useQuery } = require('@tanstack/react-query');
  const API = 'http://localhost:3000';
  const { data } = useQuery({ queryKey: ['traces'], queryFn: () => fetch(`${API}/api/v1/traces`).then(r => r.json()), refetchInterval: 3000 });
  const events = Array.isArray(data) ? data : [];
  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">Traces</h2>
      {events.map((e: any) => (
        <div key={e.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm mb-2">
          <span className="text-xs text-gray-400 w-20">{new Date(e.timestamp).toLocaleTimeString()}</span>
          <span className="font-medium w-24">{e.agentId || '—'}</span>
          <span>{e.type}</span>
        </div>
      ))}
    </div>
  );
};

export const tracesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/traces',
  component: TracesComponent,
});

// Tasks
const TasksComponent = () => {
  const { useQuery } = require('@tanstack/react-query');
  const API = 'http://localhost:3000';
  const { data } = useQuery({ queryKey: ['tasks-list'], queryFn: () => fetch(`${API}/api/v1/tasks`).then(r => r.json()), refetchInterval: 5000 });
  const tasks = Array.isArray(data) ? data : [];
  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">Tasks</h2>
      {tasks.map((t: any) => (
        <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4 mb-2">
          <div className="flex justify-between mb-1">
            <span className="font-medium">{t.description}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'complete' ? 'bg-green-100 text-green-700' : t.status === 'failed' ? 'bg-red-100 text-red-700' : t.status === 'running' ? 'bg-blue-100 text-blue-700' : t.status === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{t.status}</span>
          </div>
          <div className="flex gap-4 text-xs text-gray-400">
            <span>{t.agentId}</span>
            <span>{t.projectId}</span>
            <span>{new Date(t.createdAt).toLocaleString()}</span>
          </div>
          {t.result && <pre className="mt-2 text-xs bg-gray-50 p-2 rounded">{t.result}</pre>}
        </div>
      ))}
    </div>
  );
};

export const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: TasksComponent,
});

export const routeTree = rootRoute.addChildren([indexRoute, tracesRoute, tasksRoute]);
