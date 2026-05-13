import React, { useState, useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { StatusPill, ProgressBar, EmptyState } from '../../components/ui/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryStats {
  totalFacts: number;
  byScope: Record<string, number>;
  topCategories: { name: string; count: number }[];
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
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
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

  // Stats
  const { data: stats } = useQuery<MemoryStats>({
    queryKey: ['memory-stats'],
    queryFn: () => fetch('/api/v1/memory/stats').then((r) => r.json()),
    staleTime: 30_000,
  });

  // Search results (when query present)
  const searchUrl = buildSearchUrl(debouncedQuery, scope, 20);
  const { data: searchResults, isLoading: searchLoading } = useQuery<MemoryFact[]>({
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

  const byScopeEntries = Object.entries(stats?.byScope ?? {});
  const topCategories = (stats?.topCategories ?? []).slice(0, 5);
  const maxScopeCount = byScopeEntries.reduce((m, [, v]) => Math.max(m, v), 0);
  const maxCatCount = topCategories.reduce((m, c) => Math.max(m, c.count), 0);

  let displayFacts: MemoryFact[] = [];
  if (debouncedQuery) {
    displayFacts = Array.isArray(searchResults) ? searchResults : [];
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
          {stats?.totalFacts != null && (
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {stats.totalFacts.toLocaleString()} facts
            </span>
          )}
        </h2>
      </div>

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
          title="No facts found"
          description="No facts found. Try a different query or lower your score expectations."
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
