import React, { useState, useEffect } from 'react';
import { useQuery, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import ReactDOM from 'react-dom/client';
import { useConnectionStore } from './stores/connection';

const API = '';
const queryClient = new QueryClient();

function App() {
  const queryClient = useQueryClient();

  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);

  // Real-time updates via SSE (primary) or WebSocket (fallback)
  useEffect(() => {
    connect((event: any) => {
      if (event.type === 'ws_connected' || event.type === 'ws_disconnected') return;
      // Invalidate relevant queries on any agent/task/workflow event
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['wf-runs'] });
      queryClient.invalidateQueries({ queryKey: ['cost'] });
    });
    return () => { disconnect(); };
  }, [queryClient]);

  const [view, setView] = useState<'dashboard' | 'traces' | 'tasks' | 'workflows' | 'goals' | 'memory'>('dashboard');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [nlMode, setNlMode] = useState(false);
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlDecomposing, setNlDecomposing] = useState(false);
  const [nlPlan, setNlPlan] = useState<any>(null);
  const [nlError, setNlError] = useState('');
  const [wfRunResult, setWfRunResult] = useState('');
  const [expandedTrace, setExpandedTrace] = useState<number | null>(null);
  const { data: goals } = useQuery({ queryKey: ['goals'], queryFn: () => fetch(`${API}/api/v1/goals`).then(r => r.json()), refetchInterval: 10000 });
  const { data: goalRuns } = useQuery({ queryKey: ['goal-runs'], queryFn: () => fetch(`${API}/api/v1/goals/runs`).then(r => r.json()), refetchInterval: 10000, enabled: view === 'goals' });
  const { data: pendingGates } = useQuery({ queryKey: ['gates'], queryFn: () => fetch(`${API}/api/v1/gates/pending`).then(r => r.json()), refetchInterval: 5000 });
  const { data: memoryStats } = useQuery({ queryKey: ['memory-stats'], queryFn: () => fetch(`${API}/api/v1/memory/stats`).then(r => r.json()), refetchInterval: 15000, enabled: view === 'memory' });
  const [memorySearch, setMemorySearch] = useState('');
  const { data: memoryFacts } = useQuery({ queryKey: ['memory-facts', memorySearch], queryFn: () => fetch(`${API}/api/v1/memory/facts?search=${encodeURIComponent(memorySearch)}&limit=30`).then(r => r.json()), refetchInterval: 10000, enabled: view === 'memory' });
  const { data: workflows } = useQuery({ queryKey: ['workflows'], queryFn: () => fetch(`${API}/api/v1/workflows`).then(r => r.json()), refetchInterval: 5000 });
  const { data: costSummary } = useQuery({ queryKey: ['cost'], queryFn: () => fetch(`${API}/api/v1/cost/summary`).then(r => r.json()), refetchInterval: 10000 });
  const { data: wfRuns } = useQuery({ queryKey: ['wf-runs'], queryFn: () => fetch(`${API}/api/v1/workflows/runs`).then(r => r.json()), refetchInterval: 3000, enabled: view === 'workflows' });

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

  const decomposeNL = async () => {
    if (!nlPrompt.trim()) return;
    setNlDecomposing(true);
    setNlError('');
    try {
      const res = await fetch(`${API}/api/v1/nl/decompose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: nlPrompt.trim() }),
      });
      const data = await res.json();
      if (res.ok) { setNlPlan(data); setNlPrompt(''); }
      else setNlError(data.error);
    } catch (err: any) { setNlError(err.message); }
    finally { setNlDecomposing(false); }
  };

  const executePlan = async (plan: any) => {
    setNlDecomposing(true);
    try {
      const res = await fetch(`${API}/api/v1/nl/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: nlPrompt, plan }),
      });
      const data = await res.json();
      if (res.ok) { setToast(`Plan dispatched — run ${data.runId}`); setNlPlan(null); }
      else setNlError(data.error);
    } catch (err: any) { setNlError(err.message); }
    finally { setNlDecomposing(false); }
  };

  const handleGate = async (gateId: string, action: 'approve' | 'reject') => {
    await fetch(`${API}/api/v1/gates/${gateId}/${action}`, { method: 'POST' });
    setToast(`Gate ${action}d`);
    setTimeout(() => setToast(''), 2000);
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
            {(['dashboard', 'workflows', 'goals', 'traces', 'tasks', 'memory'] as const).map(v => (
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
          {Array.isArray(pendingGates) && pendingGates.length > 0 && (
            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{pendingGates.length} pending</span>
          )}
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

                {/* Cost */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Cost (est.)</h2>
                  {Array.isArray(costSummary) && costSummary.length > 0 ? (
                    <div className="space-y-1 text-sm">
                      {costSummary.slice(0, 3).map((r: any) => (
                        <div key={r.project_id + r.month} className="flex justify-between">
                          <span className="text-gray-600">{r.project_id} {r.month}</span>
                          <span className="font-medium text-gray-700">${r.cost.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-300 text-sm">No cost data yet</p>
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
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => setNlMode(false)} className={`text-xs px-3 py-1 rounded-full ${!nlMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>Direct Task</button>
                <button onClick={() => setNlMode(true)} className={`text-xs px-3 py-1 rounded-full ${nlMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>NL Delegate</button>
              </div>
              {nlMode ? (
                <div className="flex flex-col gap-2">
                  <textarea value={nlPrompt} onChange={e => setNlPrompt(e.target.value)}
                    placeholder="Describe what you want in natural language...&#10;e.g. Create a landing page with SEO optimization and deploy it"
                    className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                    disabled={nlDecomposing}
                    onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) decomposeNL(); }}
                  />
                  {nlError && <p className="text-red-500 text-xs">{nlError}</p>}
                  <button onClick={decomposeNL} disabled={nlDecomposing || !nlPrompt.trim()}
                    className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30 self-end"
                  >{nlDecomposing ? 'Decomposing...' : 'Decompose →'}</button>
                </div>
              ) : (
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
              )}
            </div>
            {/* Pending Human Gates */}
            {Array.isArray(pendingGates) && pendingGates.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3">⚠ Pending Approvals</h2>
                <div className="space-y-2">
                  {pendingGates.map((g: any) => (
                    <div key={g.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-100">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{g.label}</span>
                        <span className="text-xs text-gray-400 ml-2">Step: {g.step_id}</span>
                        {g.timeout_at && <span className="text-xs text-amber-500 ml-2">⏰ {new Date(g.timeout_at).toLocaleTimeString()}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleGate(g.id, 'approve')} className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-green-700">Approve</button>
                        <button onClick={() => handleGate(g.id, 'reject')} className="bg-red-100 text-red-700 px-3 py-1 rounded-lg text-xs font-medium hover:bg-red-200">Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                  <div key={e.id || i}>
                    <div
                      onClick={() => setExpandedTrace(expandedTrace === i ? null : i)}
                      className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-4 text-sm cursor-pointer hover:border-blue-300 transition-colors"
                    >
                      <span className="text-xs text-gray-300 w-16 font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      <span className="font-medium text-gray-600 w-28 truncate">{e.agentId || '—'}</span>
                      <span className="text-gray-500 flex-1">{e.type}</span>
                      {e.data?.tool && <span className="text-blue-500 font-mono text-xs">{e.data.tool}</span>}
                      <span className="text-gray-300 text-xs">{expandedTrace === i ? '▲' : '▼'}</span>
                    </div>
                    {expandedTrace === i && (
                      <div className="bg-gray-50 border border-t-0 border-gray-200 rounded-b-lg p-4 ml-4 mr-0">
                        <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                          <div><span className="text-gray-400">Project:</span> <span className="font-mono">{e.projectId}</span></div>
                          <div><span className="text-gray-400">Agent:</span> <span className="font-mono">{e.agentId || '—'}</span></div>
                          <div><span className="text-gray-400">Type:</span> <span className="font-mono">{e.type}</span></div>
                          <div><span className="text-gray-400">Timestamp:</span> <span className="font-mono">{e.timestamp}</span></div>
                        </div>
                        {e.data?.tool && (
                          <details className="mb-2">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Tool Call: {e.data.tool}</summary>
                            <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-40">{JSON.stringify(e.data, null, 2)}</pre>
                          </details>
                        )}
                        {e.data?.result && (
                          <details className="mb-2">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Result</summary>
                            <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-40 whitespace-pre-wrap">{typeof e.data.result === 'string' ? e.data.result.substring(0, 1000) : JSON.stringify(e.data.result, null, 2).substring(0, 1000)}</pre>
                          </details>
                        )}
                        <details>
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Raw Event Data</summary>
                          <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-60">{JSON.stringify(e, null, 2)}</pre>
                        </details>
                      </div>
                    )}
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
        {/* Plan Review Modal */}
        {nlPlan && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setNlPlan(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-1">Review Plan</h2>
              <p className="text-sm text-gray-500 mb-4">Review and edit the decomposed plan before execution.</p>
              <div className="space-y-3 mb-6">
                {nlPlan.steps.map((s: any, i: number) => (
                  <div key={i} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-gray-400">Step {i + 1}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{s.agentId}</span>
                    </div>
                    <textarea
                      value={s.description}
                      onChange={e => {
                        const updated = { ...nlPlan, steps: nlPlan.steps.map((st: any, j: number) => j === i ? { ...st, description: e.target.value } : st) };
                        setNlPlan(updated);
                      }}
                      className="text-sm w-full border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-blue-400"
                      rows={2}
                    />
                  </div>
                ))}
              </div>
              {nlError && <p className="text-red-500 text-sm mb-3">{nlError}</p>}
              <div className="flex gap-3 justify-end">
                <button onClick={() => setNlPlan(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                <button onClick={() => executePlan(nlPlan)} disabled={nlDecomposing}
                  className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30"
                >{nlDecomposing ? 'Executing...' : 'Approve & Execute →'}</button>
              </div>
            </div>
          </div>
        )}
        {view === 'goals' && (
          <div>
            <h2 className="text-xl font-bold mb-4">Goals</h2>
            {!goals || !Array.isArray(goals) || goals.length === 0 ? (
              <p className="text-gray-400 text-sm">No goals defined. Add YAML files to goals/</p>
            ) : (
              <div className="space-y-4">
                {goals.map((g: any) => {
                  const runs = Array.isArray(goalRuns) ? goalRuns.filter((r: any) => r.goal_id === g.id) : [];
                  const lastRun = runs[0];
                  return (
                    <div key={g.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-medium text-gray-800">{g.id}</span>
                          <span className="text-sm text-gray-400 ml-2">— {g.description}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          lastRun?.status === 'complete' ? 'bg-green-50 text-green-600' :
                          lastRun?.status === 'running' ? 'bg-blue-50 text-blue-600' :
                          lastRun?.status === 'escalated' ? 'bg-red-50 text-red-600' :
                          'bg-gray-100 text-gray-400'
                        }`}>{lastRun?.status || 'pending'}</span>
                      </div>
                      <div className="flex gap-6 text-xs text-gray-400">
                        <span>🕐 Cadence: {g.cadence}</span>
                        {g.deadline && <span>⏰ Deadline: {g.deadline}</span>}
                        <span>📋 Workflow: {g.workflow}</span>
                      </div>
                      {runs.length > 0 && (
                        <div className="mt-3 border-t border-gray-100 pt-3">
                          <span className="text-xs text-gray-400">Recent runs:</span>
                          <div className="flex gap-2 mt-1">
                            {runs.slice(0, 8).map((r: any) => (
                              <span key={r.id} className={`text-xs px-2 py-0.5 rounded-full ${
                                r.status === 'complete' ? 'bg-green-100 text-green-700' :
                                r.status === 'running' ? 'bg-blue-100 text-blue-700' :
                                r.status === 'failed' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-500'
                              }`}>{r.status}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {view === 'memory' && (
          <div>
            <h2 className="text-xl font-bold mb-4">Memory Explorer</h2>
            {memoryStats && (
              <div className="flex gap-4 mb-6 text-sm">
                <div className="bg-white rounded-xl border border-gray-200 p-3"><span className="text-gray-400">Total Facts:</span> <span className="font-bold text-gray-800 ml-1">{memoryStats.total}</span></div>
                {Array.isArray(memoryStats.byScope) && memoryStats.byScope.map((s: any) => (
                  <div key={s.scope} className="bg-white rounded-xl border border-gray-200 p-3"><span className="text-gray-400">{s.scope}:</span> <span className="font-bold text-gray-800 ml-1">{s.count}</span></div>
                ))}
              </div>
            )}
            <div className="mb-4">
              <input type="text" value={memorySearch} onChange={e => setMemorySearch(e.target.value)}
                placeholder="Search facts..." className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm w-full max-w-md focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            {Array.isArray(memoryFacts) && memoryFacts.length === 0 ? (
              <p className="text-gray-400 text-sm">No facts found. Agents will store knowledge here as they work.</p>
            ) : (
              <div className="space-y-2">
                {Array.isArray(memoryFacts) && memoryFacts.map((f: any) => (
                  <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{f.scope}</span>
                      <span className="text-xs text-gray-300">{new Date(f.created_at || f.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm text-gray-700">{f.content}</p>
                    <div className="flex gap-2 mt-2">
                      {f.category && <span className="text-xs text-gray-400">#{f.category}</span>}
                      {f.agent_id && <span className="text-xs text-gray-400">{f.agent_id}</span>}
                    </div>
                  </div>
                ))}
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

