import React, { useState, useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEventBusStore } from '../../stores/eventBus.js';
import { useScopeStore } from '../../stores/scope.js';
import { MasterDetail, EmptyState } from '../../components/ui/index.js';

// ---------------------------------------------------------------------------
// Types + helpers (exported for tests)
// ---------------------------------------------------------------------------

export interface TraceEvent {
  id: string | number;
  type: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface TracesFilter {
  taskId: string;
  project: string;
  since: string;
  offset: number;
}

export function buildTracesUrl(filter: TracesFilter, limit = 50): string {
  const params = new URLSearchParams();
  if (filter.taskId) params.set('taskId', filter.taskId);
  if (filter.project) params.set('project', filter.project);
  if (filter.since) params.set('since', filter.since);
  params.set('limit', String(limit));
  params.set('offset', String(filter.offset));
  return `/api/v1/traces?${params.toString()}`;
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

export function truncateId(id: string | number, len = 8): string {
  return String(id).slice(0, len);
}

export const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Route (with URL-synced search params)
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/traces/')({
  validateSearch: (search: Record<string, unknown>) => ({
    taskId: typeof search.taskId === 'string' ? search.taskId : '',
    project: typeof search.project === 'string' ? search.project : '',
    since: typeof search.since === 'string' ? search.since : '',
    page: typeof search.page === 'number' ? search.page : 0,
  }),
  component: TracesList,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function TracesList() {
  const navigate = useNavigate({ from: '/traces/' });
  const search = Route.useSearch();

  const taskId = search.taskId ?? '';
  // Global project scope acts as the default; an explicit ?project= search
  // param (typed into the page filter) still overrides it.
  const globalProject = useScopeStore((s) => s.selectedProject);
  const project = (search.project || globalProject) ?? '';
  const since = search.since ?? '';
  const page = search.page ?? 0;

  const [followTail, setFollowTail] = useState(false);
  const [liveEvents, setLiveEvents] = useState<TraceEvent[]>([]);
  const allStoreEvents = useEventBusStore((s) => s.events);

  // Prepend live trace.* events when following tail
  useEffect(() => {
    if (!followTail) return;
    const trace = allStoreEvents.filter((e) => e.type.startsWith('trace.'));
    setLiveEvents(
      trace.map((e) => ({
        id: e.id ?? String(e.ts),
        type: e.type,
        agentId: e.agentId,
        projectId: e.projectId,
        taskId: e.taskId,
        timestamp: new Date(e.ts).toISOString(),
        data: e.data as Record<string, unknown>,
      })),
    );
  }, [followTail, allStoreEvents]);

  const filter: TracesFilter = { taskId, project, since, offset: page * PAGE_SIZE };
  const url = buildTracesUrl(filter, PAGE_SIZE);

  const { data, isLoading } = useQuery<TraceEvent[]>({
    queryKey: ['traces', taskId, project, since, page],
    queryFn: () => fetch(url).then((r) => r.json()),
    staleTime: 10_000,
    refetchInterval: followTail ? 5_000 : false,
  });

  const fetchedEvents: TraceEvent[] = Array.isArray(data) ? data : [];
  const displayEvents: TraceEvent[] = followTail
    ? [...liveEvents, ...fetchedEvents]
    : fetchedEvents;

  function setSearch(updates: Partial<typeof search>) {
    navigate({ search: (prev: typeof search) => ({ ...prev, ...updates }) });
  }

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sidebar = (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="p-3 space-y-2 border-b border-zinc-800 flex-shrink-0">
        <input
          type="text"
          value={taskId}
          onChange={(e) => setSearch({ taskId: e.target.value, page: 0 })}
          placeholder="Task ID…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
        <input
          type="text"
          value={project}
          onChange={(e) => setSearch({ project: e.target.value, page: 0 })}
          placeholder="Project…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
        <input
          type="date"
          value={since}
          onChange={(e) => setSearch({ since: e.target.value, page: 0 })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={followTail}
            onChange={(e) => setFollowTail(e.target.checked)}
            className="accent-indigo-500"
          />
          Follow tail
        </label>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 text-zinc-500 text-xs">Loading…</div>
        ) : displayEvents.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No traces"
            description="No trace events recorded yet."
          />
        ) : (
          <div>
            {displayEvents.map((e) => (
              <button
                key={String(e.id)}
                onClick={() => setSelectedId(String(e.id))}
                className={`w-full text-left px-3 py-2.5 border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors ${
                  selectedId === String(e.id) ? 'bg-indigo-500/10 border-l-2 border-l-indigo-400' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-mono text-[10px] text-zinc-500">{truncateId(e.id)}</span>
                  <span className="text-[10px] text-zinc-500 ml-auto">{relativeTime(e.timestamp)}</span>
                </div>
                <div className="text-xs text-zinc-300 font-medium truncate">{e.type}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {e.agentId ?? '—'} {e.taskId ? `· ${truncateId(e.taskId)}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="p-3 border-t border-zinc-800 flex items-center gap-2 flex-shrink-0">
        <button
          disabled={page === 0}
          onClick={() => setSearch({ page: Math.max(0, page - 1) })}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
        >
          ← Prev
        </button>
        <span className="text-xs text-zinc-500 flex-1 text-center">Page {page + 1}</span>
        <button
          disabled={fetchedEvents.length < PAGE_SIZE}
          onClick={() => setSearch({ page: page + 1 })}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
        >
          Load more →
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-xl font-bold text-zinc-100">Traces</h2>
      </div>

      <div className="flex-1 overflow-hidden">
        <MasterDetail sidebar={sidebar} sidebarWidth="w-72">
          {selectedId ? (
            <TraceDetailPanel traceId={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
              Select a trace to view details
            </div>
          )}
        </MasterDetail>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline detail panel
// ---------------------------------------------------------------------------

interface CollapsedKeys {
  [key: string]: boolean;
}

function TraceDetailPanel({ traceId, onBack }: { traceId: string; onBack: () => void }) {
  const [collapsed, setCollapsed] = useState<CollapsedKeys>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => fetch(`/api/v1/traces/${traceId}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-6 text-zinc-400 text-sm">Loading…</div>;
  if (isError || !data || (data as any).error) {
    return (
      <div className="p-6 text-red-400 text-sm">
        {(data as any)?.error ?? 'Failed to load trace.'}
      </div>
    );
  }

  const trace = data as TraceEvent;

  function toggleKey(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function renderJson(obj: unknown, depth = 0, path = ''): React.ReactNode {
    if (obj == null) return <span className="text-zinc-600">null</span>;
    if (typeof obj !== 'object') {
      return (
        <span className={typeof obj === 'string' ? 'text-emerald-400' : 'text-amber-300'}>
          {JSON.stringify(obj)}
        </span>
      );
    }
    if (Array.isArray(obj)) {
      return (
        <span>
          {'['}
          {(obj as unknown[]).map((v, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {renderJson(v, depth + 1, `${path}.${i}`)}
            </span>
          ))}
          {']'}
        </span>
      );
    }
    const entries = Object.entries(obj as Record<string, unknown>);
    return (
      <span>
        {'{'}
        <div className="pl-4">
          {entries.map(([k, v]) => {
            const isObj = v !== null && typeof v === 'object';
            const colKey = `${path}.${k}`;
            const isCollapsed = collapsed[colKey];
            return (
              <div key={k}>
                <span
                  onClick={() => isObj && toggleKey(colKey)}
                  className={isObj ? 'cursor-pointer hover:text-indigo-300' : undefined}
                >
                  <span className="text-indigo-400">{JSON.stringify(k)}</span>
                  <span className="text-zinc-500">: </span>
                  {isObj && isCollapsed ? (
                    <span className="text-zinc-500">{'{ … }'}</span>
                  ) : (
                    renderJson(v, depth + 1, colKey)
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {'}'}
      </span>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <button
        onClick={onBack}
        className="text-indigo-400 text-xs mb-4 hover:underline"
      >
        ← Back to list
      </button>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wider">ID</span>
            <p className="font-mono text-zinc-300 text-xs mt-0.5">{trace.id}</p>
          </div>
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wider">Type</span>
            <p className="text-zinc-200 text-xs mt-0.5">{trace.type}</p>
          </div>
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wider">Agent</span>
            <p className="text-xs mt-0.5">
              {trace.agentId ? (
                <Link
                  to="/agents/$agentId"
                  params={{ agentId: trace.agentId }}
                  className="text-indigo-400 hover:underline"
                >
                  {trace.agentId}
                </Link>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wider">Task</span>
            <p className="text-xs mt-0.5">
              {trace.taskId ? (
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: trace.taskId }}
                  className="text-indigo-400 hover:underline font-mono"
                >
                  {trace.taskId}
                </Link>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </p>
          </div>
          <div className="col-span-2">
            <span className="text-zinc-500 text-xs uppercase tracking-wider">Timestamp</span>
            <p className="text-zinc-300 text-xs mt-0.5">
              {new Date(trace.timestamp).toLocaleString()} · {relativeTime(trace.timestamp)}
            </p>
          </div>
        </div>
      </div>

      {/* Collapsible JSON data */}
      {trace.data && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Data
          </h3>
          <div className="text-xs text-zinc-300 leading-relaxed font-mono">
            {renderJson(trace.data)}
          </div>
        </div>
      )}
    </div>
  );
}
