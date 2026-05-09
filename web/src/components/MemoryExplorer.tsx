import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const API = '';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const SCOPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'company', label: 'Company' },
  { value: 'project', label: 'Project' },
  { value: 'agent', label: 'Agent' },
];

const CATEGORIES = [
  'convention', 'decision', 'pattern', 'constraint',
  'architecture', 'error_pattern', 'dependency',
];

export function MemoryExplorer() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'browse' | 'semantic' | 'sessions'>('browse');
  const [scopeFilter, setScopeFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [semanticQuery, setSemanticQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFact, setNewFact] = useState({ scope: 'company', category: 'convention', content: '' });
  const [addStatus, setAddStatus] = useState<'idle' | 'submitting' | 'error'>('idle');

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['memory-stats'],
    queryFn: () => fetch(`${API}/api/v1/memory/stats`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  // Browse facts
  const factParams = new URLSearchParams();
  if (scopeFilter) factParams.set('scope', scopeFilter);
  if (searchText) factParams.set('search', searchText);
  factParams.set('limit', '50');

  const { data: facts, isLoading: factsLoading } = useQuery({
    queryKey: ['memory-facts', scopeFilter, searchText],
    queryFn: () => fetch(`${API}/api/v1/memory/facts?${factParams.toString()}`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  // Semantic search
  const { data: semanticResults, isFetching: semanticLoading } = useQuery({
    queryKey: ['memory-semantic', semanticQuery],
    queryFn: () => fetch(`${API}/api/v1/memory/search?query=${encodeURIComponent(semanticQuery)}&scope=company&includeProject=true&limit=20`).then((r) => r.json()),
    enabled: semanticQuery.length > 0,
  });

  // Session summaries
  const { data: sessions } = useQuery({
    queryKey: ['memory-sessions'],
    queryFn: () => fetch(`${API}/api/v1/memory/sessions?limit=20`).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this fact?')) return;
    await fetch(`${API}/api/v1/memory/facts/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['memory-facts'] });
    queryClient.invalidateQueries({ queryKey: ['memory-stats'] });
  };

  const handleAdd = async () => {
    if (!newFact.content.trim()) return;
    setAddStatus('submitting');
    try {
      const res = await fetch(`${API}/api/v1/memory/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newFact, agentId: 'operator' }),
      });
      if (res.ok) {
        setNewFact({ scope: 'company', category: 'convention', content: '' });
        setShowAddForm(false);
        setAddStatus('idle');
        queryClient.invalidateQueries({ queryKey: ['memory-facts'] });
        queryClient.invalidateQueries({ queryKey: ['memory-stats'] });
      } else {
        setAddStatus('error');
      }
    } catch {
      setAddStatus('error');
    }
  };

  const factList = Array.isArray(facts) ? facts : [];
  const semanticList = semanticResults?.facts || [];
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const statData = stats || {};

  return (
    <div className="max-w-5xl">
      <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Memory Explorer</h2>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <div className="text-2xl font-bold dark:text-gray-100">{statData.total ?? '—'}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total Facts</div>
        </div>
        {(statData.byScope || []).slice(0, 3).map((s: any) => (
          <div key={s.scope} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
            <div className="text-2xl font-bold dark:text-gray-100">{s.count}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">{s.scope}</div>
          </div>
        ))}
      </div>

      {/* Category Breakdown */}
      {(statData.byCategory || []).length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {(statData.byCategory || []).map((c: any) => (
            <span key={c.category} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {c.category}: {c.count}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 mb-4 w-fit">
        {(['browse', 'semantic', 'sessions'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >{tab}</button>
        ))}
      </div>

      {/* Browse Tab */}
      {activeTab === 'browse' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setScopeFilter(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    scopeFilter === opt.value
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >{opt.label}</button>
              ))}
            </div>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search facts..."
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-200 flex-1 max-w-xs"
            />
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >{showAddForm ? 'Cancel' : '+ Add Fact'}</button>
          </div>

          {/* Add Fact Form */}
          {showAddForm && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
              <div className="flex gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Scope</label>
                  <select
                    value={newFact.scope}
                    onChange={(e) => setNewFact({ ...newFact, scope: e.target.value })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
                  >
                    {SCOPE_OPTIONS.filter(o => o.value).map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Category</label>
                  <select
                    value={newFact.category}
                    onChange={(e) => setNewFact({ ...newFact, category: e.target.value })}
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Content</label>
                  <input
                    type="text"
                    value={newFact.content}
                    onChange={(e) => setNewFact({ ...newFact, content: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder="Fact content..."
                    className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
                  />
                </div>
                <button
                  onClick={handleAdd}
                  disabled={addStatus === 'submitting' || !newFact.content.trim()}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >{addStatus === 'submitting' ? '...' : 'Add'}</button>
              </div>
              {addStatus === 'error' && (
                <p className="text-red-500 text-xs mt-2">Failed to add fact. Try again.</p>
              )}
            </div>
          )}

          {/* Fact List */}
          {factsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 animate-pulse">
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-50 dark:bg-gray-700 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : factList.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm py-4">No facts found</p>
          ) : (
            <div className="space-y-2">
              {factList.map((f: any) => (
                <div key={f.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-medium">
                          {f.category}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 capitalize">{f.scope}</span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{f.content}</p>
                      <div className="flex gap-3 text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                        <span>{f.agent_id || f.agentId || '—'}</span>
                        <span>{relativeTime(f.created_at || f.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="text-xs text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Semantic Search Tab */}
      {activeTab === 'semantic' && (
        <div>
          <input
            type="text"
            value={semanticQuery}
            onChange={(e) => setSemanticQuery(e.target.value)}
            placeholder="Search semantically across all facts..."
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200 w-full max-w-md mb-4"
          />
          {!semanticQuery ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm">Enter a search term to find semantically similar facts</p>
          ) : semanticLoading ? (
            <p className="text-gray-400 text-sm">Searching...</p>
          ) : semanticList.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm">No results</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{semanticResults.count} results for "{semanticQuery}"</p>
              {semanticList.map((f: any) => (
                <div key={f.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-medium">
                      {f.category}
                    </span>
                    {f._distance != null && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {(f._distance * 100).toFixed(0)}% match
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{f.content}</p>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{f.scope} · {relativeTime(f.created_at || f.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        <div>
          {sessionList.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm py-4">No session summaries yet</p>
          ) : (
            <div className="space-y-2">
              {sessionList.map((s: any) => (
                <div key={s.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium dark:text-gray-300">{s.agentId || '—'}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{relativeTime(s.createdAt)}</span>
                    <span className="text-xs text-gray-300 dark:text-gray-600 font-mono">{s.id.slice(0, 8)}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">{s.summary || 'No summary'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
