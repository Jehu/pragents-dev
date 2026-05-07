import React, { useState } from 'react';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReactDOM from 'react-dom/client';

const API = 'http://localhost:3000';
const queryClient = new QueryClient();

function App() {
  const [view, setView] = useState<'dashboard' | 'traces' | 'tasks'>('dashboard');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { data: workflows } = useQuery({ queryKey: ['workflows'], queryFn: () => fetch(`${API}/api/v1/workflows`).then(r => r.json()), refetchInterval: 5000 });
  const { data: wfRuns } = useQuery({ queryKey: ['wf-runs'], queryFn: () => fetch(`${API}/api/v1/workflows/runs`).then(r => r.json()), refetchInterval: 3000, enabled: view === 'workflows' });
  const [wfRunResult, setWfRunResult] = useState('');

  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: () => fetch(`${API}/api/v1/agents`).then(r => r.json()) });
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => fetch(`${API}/api/v1/tasks`).then(r => r.json()), refetchInterval: 3000 });
  const { data: events } = useQuery({ queryKey: ['events'], queryFn: () => fetch(`${API}/api/v1/traces?limit=50`).then(r => r.json()), refetchInterval: 2000 });

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
        body: JSON.stringify({ projectId: 'kunde-webshop', agentId: 'dev@kunde-webshop', description: description.trim() }),
      });
      setDescription('');
      setToast('Task dispatched');
      setTimeout(() => setToast(''), 3000);
    } finally { setSubmitting(false); }
  };

  const runWorkflow = async (name: string) => {
    setWfRunResult('Starting...');
    try {
      const res = await fetch(`${API}/api/v1/workflows/${name}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (res.ok) setWfRunResult(`Run ${data.runId} started`);
      else setWfRunResult(`Error: ${data.error}`);
    } catch (err: any) {
      setWfRunResult(`Error: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Toast */}
      {toast && <div className="fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">{toast}</div>}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold tracking-tight">pragents</h1>
          <nav className="flex gap-1">
            {(['dashboard', 'workflows', 'traces', 'tasks'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                  view === v ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >{v}</button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          connected
        </div>
      </header>

      {/* Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {view === 'dashboard' && (
          <div className="flex flex-col gap-6">
            <div className="flex gap-6">
              {/* Activity Stream */}
              <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.activity-stream">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Activity</h2>
                {eventList.length === 0 ? (
                  <p className="text-gray-300 text-sm py-8 text-center">No activity yet — dispatch a task to get started</p>
                ) : (
                  <div className="space-y-1">
                    {eventList.slice(0, 20).map((e: any, i: number) => (
                      <div key={e.id || i} className="flex items-center gap-3 text-sm border-b border-gray-50 pb-1.5">
                        <span className="text-xs text-gray-300 w-16 flex-shrink-0 font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                        <span className="font-medium text-gray-600 w-28 flex-shrink-0 truncate">{e.agentId || '—'}</span>
                        <span className="text-gray-500">{e.type}</span>
                        {e.data?.tool && <span className="text-blue-500 font-mono text-xs">{e.data.tool}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div className="w-72 flex flex-col gap-4 flex-shrink-0">
                {/* Agents */}
                <div className="bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.agent-grid">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Agents</h2>
                  {agentList.length === 0 ? (
                    <p className="text-gray-300 text-sm">No agents configured</p>
                  ) : (
                    <div className="space-y-2">
                      {agentList.map((a: any) => (
                        <div key={a.id} className="flex items-center justify-between text-sm py-1">
                          <span className="font-medium text-gray-700 truncate">{a.id}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            a.status === 'busy' ? 'bg-blue-50 text-blue-600' :
                            a.status === 'idle' ? 'bg-green-50 text-green-600' :
                            'bg-gray-100 text-gray-400'
                          }`}>{a.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tasks */}
                <div className="bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.task-list">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Recent Tasks</h2>
                  {taskList.length === 0 ? (
                    <p className="text-gray-300 text-sm">No tasks yet</p>
                  ) : (
                    <div className="space-y-2">
                      {taskList.slice(0, 8).map((t: any) => (
                        <div key={t.id} className="text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-700 truncate max-w-44">{t.description}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                              t.status === 'complete' ? 'bg-green-50 text-green-600' :
                              t.status === 'failed' ? 'bg-red-50 text-red-600' :
                              t.status === 'running' ? 'bg-blue-50 text-blue-600' :
                              t.status === 'needs_review' ? 'bg-amber-50 text-amber-600' :
                              'bg-gray-100 text-gray-400'
                            }`}>{t.status}</span>
                          </div>
                          <span className="text-xs text-gray-400">{t.agentId}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Task Input */}
            <div className="bg-white rounded-xl border border-gray-200 p-4" data-block="dashboard.task-input-bar">
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && dispatch()}
                  placeholder="Describe what the agent should do..."
                  className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                  disabled={submitting}
                />
                <button
                  onClick={dispatch}
                  disabled={submitting || !description.trim()}
                  className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >{submitting ? 'Dispatching...' : 'Dispatch →'}</button>
              </div>
            </div>
          </div>
        )}

        {view === 'traces' && (
          <div>
            <h2 className="text-xl font-bold mb-4">Traces</h2>
            {eventList.length === 0 ? (
              <p className="text-gray-400 text-sm">No traces yet</p>
            ) : (
              <div className="space-y-1">
                {eventList.map((e: any, i: number) => (
                  <div key={e.id || i} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm">
                    <span className="text-xs text-gray-300 w-16 font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                    <span className="font-medium text-gray-600 w-28 truncate">{e.agentId || '—'}</span>
                    <span className="text-gray-500">{e.type}</span>
                    {e.data?.tool && <span className="text-blue-500 font-mono text-xs">{e.data.tool}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'tasks' && (
          <div>
            <h2 className="text-xl font-bold mb-4">Tasks</h2>
            {taskList.length === 0 ? (
              <p className="text-gray-400 text-sm">No tasks yet</p>
            ) : (
              <div className="space-y-2">
                {taskList.map((t: any) => (
                  <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-800">{t.description}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.status === 'complete' ? 'bg-green-50 text-green-600' :
                        t.status === 'failed' ? 'bg-red-50 text-red-600' :
                        t.status === 'running' ? 'bg-blue-50 text-blue-600' :
                        t.status === 'needs_review' ? 'bg-amber-50 text-amber-600' :
                        'bg-gray-100 text-gray-400'
                      }`}>{t.status}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      <span>{t.agentId}</span>
                      <span>{t.projectId}</span>
                      <span>{new Date(t.createdAt).toLocaleString()}</span>
                    </div>
                    {t.status === 'needs_review' && (
                      <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">Task was interrupted — may be incomplete</div>
                    )}
                    {t.result && t.status !== 'needs_review' && (
                      <pre className="mt-2 text-xs bg-gray-50 p-2 rounded-lg whitespace-pre-wrap max-h-32 overflow-y-auto">{t.result}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {view === 'workflows' && (
          <div>
            <h2 className="text-xl font-bold mb-4">Workflows</h2>
            {wfRunResult && <div className="mb-4 p-2 bg-gray-100 rounded-lg text-sm text-gray-700">{wfRunResult}</div>}
            {!workflows || !Array.isArray(workflows) || workflows.length === 0 ? (
              <p className="text-gray-400 text-sm">No workflows defined. Add YAML files to workflows/</p>
            ) : (
              <div className="space-y-4">
                {workflows.map((w: any) => (
                  <div key={w.name} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-gray-800">{w.name}</span>
                        {w.description && <span className="text-sm text-gray-400 ml-2">— {w.description}</span>}
                      </div>
                      <button onClick={() => runWorkflow(w.name)} className="bg-gray-900 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">Run →</button>
                    </div>
                    <div className="text-xs text-gray-400">{w.steps} steps{w.trigger ? ` · trigger: ${w.trigger}` : ''}</div>
                  </div>
                ))}
                {/* Run history */}
                {Array.isArray(wfRuns) && wfRuns.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Run History</h3>
                    <div className="space-y-1">
                      {wfRuns.slice(0, 10).map((r: any) => (
                        <div key={r.id} className="flex items-center gap-4 text-sm py-1 border-b border-gray-50">
                          <span className="font-medium text-gray-700">{r.workflowName}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            r.status === 'complete' ? 'bg-green-50 text-green-600' :
                            r.status === 'failed' ? 'bg-red-50 text-red-600' :
                            r.status === 'interrupted' ? 'bg-amber-50 text-amber-600' :
                            'bg-blue-50 text-blue-600'
                          }`}>{r.status}</span>
                          <span className="text-xs text-gray-400 ml-auto">{new Date(r.startedAt).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

