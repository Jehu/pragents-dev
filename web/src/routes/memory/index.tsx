import React, { useState, useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusPill, ProgressBar, EmptyState } from '../../components/ui/index.js';

/** Categories match the REMEMBER: format agents use (see AGENTS.md). */
export const FACT_CATEGORIES = [
  'convention', 'decision', 'pattern', 'constraint', 'architecture', 'error_pattern', 'dependency',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryStats {
  total?: number;
  totalFacts?: number;
  byScope: Record<string, number> | { scope: string; count: number }[];
  topCategories?: { name: string; count: number }[];
  byCategory?: { category: string; count: number }[];
}

export interface MemoryFact {
  id: string;
  content: string;
  scope: string;
  category?: string;
  agentId?: string;
  createdAt: string;
  score?: number;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

export function buildSearchUrl(query: string, scope: string, limit: number): string {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (scope && scope !== 'all') params.set('scope', scope);
  params.set('limit', String(limit));
  return `/api/v1/memory/search?${params.toString()}`;
}

export function scopeToStatusType(
  scope: string,
): 'idle' | 'busy' | 'running' | 'complete' | 'failed' | 'needs_review' | 'proposed' | 'cold' {
  const map: Record<
    string,
    'idle' | 'busy' | 'running' | 'complete' | 'failed' | 'needs_review' | 'proposed' | 'cold'
  > = {
    company: 'complete',
    project: 'running',
    agent: 'busy',
  };
  return map[scope?.toLowerCase()] ?? 'idle';
}

export function relativeTime(isoString: string): string {
  if (!isoString) return '—';
  const ms = new Date(isoString).getTime();
  if (isNaN(ms)) return '—';
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/memory/')({
  component: MemoryView,
});

const SCOPES = ['all', 'company', 'project', 'agent'] as const;
type ScopeFilter = (typeof SCOPES)[number];

function MemoryView() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const debouncedQuery = useDebounce(query, 300);
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFact, setNewFact] = useState({ scope: 'company', category: 'decision', content: '' });
  const [curationError, setCurationError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidateFacts = () => {
    void queryClient.invalidateQueries({ queryKey: ['memory-facts'] });
    void queryClient.invalidateQueries({ queryKey: ['memory-search'] });
    void queryClient.invalidateQueries({ queryKey: ['memory-stats'] });
  };

  const addMutation = useMutation({
    mutationFn: async (fact: { scope: string; category: string; content: string }) => {
      const res = await fetch('/api/v1/memory/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fact, agentId: 'operator' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed to add fact (${res.status})`);
      return body;
    },
    onSuccess: () => {
      setCurationError(null);
      setNewFact((f) => ({ ...f, content: '' }));
      setShowAddForm(false);
      invalidateFacts();
    },
    onError: (err: unknown) => setCurationError(err instanceof Error ? err.message : 'Failed to add fact'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/memory/facts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed to delete fact (${res.status})`);
      return body;
    },
    onSuccess: () => {
      setCurationError(null);
      setConfirmDeleteId(null);
      invalidateFacts();
    },
    onError: (err: unknown) => {
      setCurationError(err instanceof Error ? err.message : 'Failed to delete fact');
      setConfirmDeleteId(null);
    },
  });

  // Stats
  const { data: stats } = useQuery<MemoryStats>({
    queryKey: ['memory-stats'],
    queryFn: () => fetch('/api/v1/memory/stats').then((r) => r.json()),
    staleTime: 30_000,
  });

  // Search results (when query present)
  const searchUrl = buildSearchUrl(debouncedQuery, scope, 20);
  const { data: searchResults, isLoading: searchLoading } = useQuery<MemoryFact[] | { facts: MemoryFact[] }>({
    queryKey: ['memory-search', debouncedQuery, scope],
    queryFn: () => fetch(searchUrl).then((r) => r.json()),
    staleTime: 15_000,
    enabled: debouncedQuery.length > 0,
  });

  // Fallback: all facts when no query
  const { data: allFactsData } = useQuery<{ facts: MemoryFact[] } | MemoryFact[]>({
    queryKey: ['memory-facts'],
    queryFn: () => fetch('/api/v1/memory/facts').then((r) => r.json()),
    staleTime: 30_000,
    enabled: debouncedQuery.length === 0,
  });

  const totalFacts = stats?.totalFacts ?? stats?.total ?? 0;
  const rawByScope = stats?.byScope ?? {};
  const byScopeEntries: [string, number][] = Array.isArray(rawByScope)
    ? (rawByScope as { scope: string; count: number }[]).map((e) => [e.scope, e.count])
    : Object.entries(rawByScope as Record<string, number>);
  const rawCats = stats?.topCategories ?? (stats?.byCategory ?? []).map((c) => ({ name: c.category, count: c.count }));
  const topCategories = rawCats.slice(0, 5);
  const maxScopeCount = byScopeEntries.reduce((m, [, v]) => Math.max(m, v), 0);
  const maxCatCount = topCategories.reduce((m, c) => Math.max(m, c.count), 0);

  let displayFacts: MemoryFact[] = [];
  if (debouncedQuery) {
    // /memory/search returns { scope, query, count, facts: [...] }; legacy callers received bare arrays.
    displayFacts = Array.isArray(searchResults)
      ? (searchResults as MemoryFact[])
      : Array.isArray((searchResults as any)?.facts)
      ? ((searchResults as any).facts as MemoryFact[])
      : [];
  } else {
    const raw = allFactsData;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.facts)
      ? (raw as any).facts
      : [];
    displayFacts = scope !== 'all' ? list.filter((f: MemoryFact) => f.scope?.toLowerCase() === scope) : list;
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header with total count */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-zinc-100">
          Memory
          {totalFacts > 0 && (
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {totalFacts.toLocaleString()} facts
            </span>
          )}
        </h2>
        <button
          className="btn-approve text-xs px-3 py-1.5 rounded font-medium"
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm ? 'Close' : '+ Add fact'}
        </button>
      </div>

      {curationError && (
        <div className="mb-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {curationError}
        </div>
      )}

      {/* Add-fact form */}
      {showAddForm && (
        <form
          className="mb-6 bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newFact.content.trim()) addMutation.mutate({ ...newFact, content: newFact.content.trim() });
          }}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={newFact.scope}
              onChange={(e) => setNewFact((f) => ({ ...f, scope: e.target.value }))}
              placeholder="Scope (company or project id)"
              aria-label="Fact scope"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
            />
            <select
              value={newFact.category}
              onChange={(e) => setNewFact((f) => ({ ...f, category: e.target.value }))}
              aria-label="Fact category"
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500 cursor-pointer"
            >
              {FACT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <textarea
            value={newFact.content}
            onChange={(e) => setNewFact((f) => ({ ...f, content: e.target.value }))}
            placeholder="A concise, self-contained statement of the fact…"
            aria-label="Fact content"
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500 resize-y"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={addMutation.isPending || !newFact.content.trim() || !newFact.scope.trim()}
              className="btn-approve text-xs px-3 py-1.5 rounded font-medium disabled:opacity-50"
            >
              {addMutation.isPending ? 'Saving…' : 'Save fact'}
            </button>
          </div>
        </form>
      )}

      {/* Stats grid */}
      {(byScopeEntries.length > 0 || topCategories.length > 0) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* By scope */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              By scope
            </h3>
            <div className="space-y-2">
              {byScopeEntries.map(([scopeKey, count]) => (
                <div key={scopeKey}>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span className="capitalize">{scopeKey}</span>
                    <span>{count}</span>
                  </div>
                  <ProgressBar value={maxScopeCount > 0 ? (count / maxScopeCount) * 100 : 0} />
                </div>
              ))}
            </div>
          </div>

          {/* Top categories */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Top categories
            </h3>
            <div className="space-y-2">
              {topCategories.map((cat) => (
                <div key={cat.name}>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{cat.name}</span>
                    <span>{cat.count}</span>
                  </div>
                  <ProgressBar value={maxCatCount > 0 ? (cat.count / maxCatCount) * 100 : 0} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search facts…"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500 transition-colors"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ScopeFilter)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All scopes' : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Results */}
      {searchLoading && debouncedQuery ? (
        <div className="text-zinc-400 text-sm">Searching…</div>
      ) : displayFacts.length === 0 ? (
        <EmptyState
          icon="🧠"
          title={debouncedQuery ? 'No matching facts' : 'No facts stored yet'}
          description={
            debouncedQuery
              ? 'Try a broader search term or switch the scope filter to "All scopes".'
              : 'Facts appear here as agents remember things during their work — conventions, decisions, and project knowledge.'
          }
        />
      ) : (
        <div className="space-y-2">
          {displayFacts.map((fact) => (
            <div
              key={fact.id}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3"
            >
              <p className="text-sm text-zinc-200 mb-2">{fact.content}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <StatusPill status={scopeToStatusType(fact.scope ?? 'idle')} />
                {fact.category && (
                  <span className="bg-zinc-800 rounded px-1.5 py-0.5 text-zinc-400">
                    {fact.category}
                  </span>
                )}
                {fact.agentId && (
                  <Link
                    to="/agents/$agentId"
                    params={{ agentId: fact.agentId }}
                    className="text-indigo-400 hover:underline"
                  >
                    {fact.agentId}
                  </Link>
                )}
                <span className="ml-auto">{relativeTime(fact.createdAt)}</span>
                {confirmDeleteId === fact.id ? (
                  <span className="flex items-center gap-1.5">
                    <button
                      className="px-1.5 py-0.5 rounded font-medium bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-50"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(fact.id)}
                    >
                      Delete
                    </button>
                    <button
                      className="px-1.5 py-0.5 rounded text-zinc-400 hover:text-zinc-200"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    aria-label={`Delete fact ${fact.id}`}
                    title="Delete fact"
                    className="text-zinc-600 hover:text-red-300 transition-colors"
                    onClick={() => setConfirmDeleteId(fact.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
