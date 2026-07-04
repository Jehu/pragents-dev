import React, { useEffect, useState } from 'react';
import { createRootRoute, Outlet, Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useScopeStore } from '../stores/scope.js';
import { useEventBusStore } from '../stores/eventBus.js';
import { useCommandPaletteStore } from '../stores/commandPalette.js';
import { connectSSE, disconnectSSE, isSSEAvailable } from '../hooks/useSSE.js';
import { KbdHint, Sparkline } from '../components/ui/index.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { fetchJson } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Sidebar navigation structure
// ---------------------------------------------------------------------------

type NavItem = {
  label: string;
  to: string;
  short: string;
};

type NavGroup = {
  group: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', to: '/overview', short: 'Ov' },
      { label: 'Inbox', to: '/inbox', short: 'In' },
      { label: 'Projects', to: '/projects', short: 'Pr' },
      { label: 'Settings', to: '/settings', short: 'Se' },
    ],
  },
  {
    group: 'Run',
    items: [
      { label: 'Agents', to: '/agents', short: 'Ag' },
      { label: 'Tasks', to: '/tasks', short: 'Ta' },
      { label: 'Plans', to: '/plans', short: 'Pl' },
      { label: 'Workflows', to: '/workflows', short: 'Wf' },
      { label: 'Goals', to: '/goals', short: 'Go' },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { label: 'Skills', to: '/skills', short: 'Sk' },
      { label: 'Memory', to: '/memory', short: 'Me' },
    ],
  },
  {
    group: 'Observe',
    items: [
      { label: 'Metrics', to: '/metrics', short: 'Mt' },
      { label: 'Costs', to: '/costs', short: 'Co' },
      { label: 'Health', to: '/health', short: 'He' },
      { label: 'Traces', to: '/traces', short: 'Tr' },
    ],
  },
  {
    group: 'Talk',
    items: [{ label: 'Chat', to: '/chat', short: 'Ch' }],
  },
];

// ---------------------------------------------------------------------------
// Header sub-components
// ---------------------------------------------------------------------------

function ProjectPicker({ id = 'project-picker' }: { id?: string }) {
  const { selectedProject, setProject } = useScopeStore();
  const { data, isError } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['projects'],
    queryFn: () => fetchJson('/api/v1/projects'),
    staleTime: 60_000,
  });

  const projects = Array.isArray(data) ? data : [];

  // A selected project can go stale: persisted in localStorage across a
  // config change, or deleted while selected. Once the authoritative list
  // has loaded, reset so the visible option and the active filter never
  // disagree.
  useEffect(() => {
    if (!data) return;
    if (selectedProject && !projects.some((p) => p.id === selectedProject)) {
      setProject(null);
    }
  }, [data, projects, selectedProject, setProject]);

  const active = selectedProject !== null;

  return (
    <div className="flex items-center gap-1 text-xs">
      <label htmlFor={id} className="text-zinc-500">
        project:
      </label>
      <span
        className={`flex items-center rounded ${
          active ? 'bg-indigo-500/15 border border-indigo-400/30 pl-1.5' : ''
        }`}
      >
        <select
          id={id}
          value={selectedProject ?? ''}
          onChange={(e) => setProject(e.target.value || null)}
          className={`bg-transparent border-none outline-none cursor-pointer py-1 pr-1 ${
            active ? 'text-indigo-200 hover:text-indigo-100' : 'text-zinc-200 hover:text-zinc-100'
          }`}
        >
          <option value="">all projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {active && (
          <button
            type="button"
            onClick={() => setProject(null)}
            aria-label="Clear project filter"
            title="Show all projects"
            className="px-1.5 py-1 text-indigo-300 hover:text-white"
          >
            ×
          </button>
        )}
      </span>
      {isError && (
        <span
          title="Failed to load projects — scope switching unavailable"
          className="text-amber-400"
          role="img"
          aria-label="Failed to load projects"
        >
          ⚠
        </span>
      )}
    </div>
  );
}

function HealthDot() {
  const { data } = useQuery<{ status?: string }>({
    queryKey: ['health'],
    queryFn: () => fetchJson('/api/v1/health'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const healthy = !data || data.status === 'ok' || data.status === 'healthy';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-1.5 h-1.5 rounded-full pulse-dot ${healthy ? 'bg-emerald-400' : 'bg-red-400'}`}
      />
      <span className={healthy ? 'text-zinc-400' : 'text-red-400'}>
        {healthy ? 'healthy' : 'degraded'}
      </span>
    </div>
  );
}

function CostBadge() {
  // Honors the global project scope — the picker sits right next to this
  // badge, so a global number under an active filter reads as a lie.
  const selectedProject = useScopeStore((s) => s.selectedProject);
  const { data } = useQuery<{ cost?: number; project_id?: string }[]>({
    queryKey: ['cost-monthly'],
    queryFn: () => fetchJson('/api/v1/cost/summary'),
    staleTime: 300_000,
  });

  const rows = data ?? [];
  const scoped = selectedProject
    ? rows.filter((row) => row.project_id === selectedProject)
    : rows;
  const totalCost = scoped.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const cost = data
    ? `€${totalCost.toFixed(2)}`
    : '—';

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-500">cost this month</span>
      <span className="text-zinc-200 font-mono">{cost}</span>
    </div>
  );
}

function InboxBadge() {
  // Deliberately NOT project-scoped: the Inbox page itself is company-wide
  // (a hidden pending approval is a footgun — see CompanyWideBadge there),
  // so this count must match what the page shows.
  const { data } = useQuery<{ total?: number }>({
    queryKey: ['inbox-count'],
    queryFn: () => fetchJson('/api/v1/tasks?status=needs_review&limit=1'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const count = data?.total ?? 0;

  return (
    <Link
      to="/inbox"
      className="relative px-2 py-1 rounded hover:bg-zinc-800 text-zinc-300 flex items-center gap-1"
    >
      inbox
      {count > 0 && (
        <span className="inline-flex items-center justify-center text-[11px] font-semibold bg-amber-500/20 text-amber-300 rounded-full w-4 h-4">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ collapsed, mobile = false, onNavigate }: { collapsed: boolean; mobile?: boolean; onNavigate?: () => void }) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  function isActive(to: string): boolean {
    if (to === '/overview') return pathname === '/overview' || pathname === '/';
    return pathname.startsWith(to);
  }

  if (collapsed) {
    return (
      <aside className="hidden md:block w-14 bg-zinc-900/50 border-r border-zinc-800 flex-shrink-0 overflow-y-auto">
        <nav aria-label="Primary navigation" className="py-2">
          {NAV.flatMap((group) => group.items).map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                className={`mx-2 mb-1 flex h-8 items-center justify-center rounded text-[11px] font-semibold ${
                  active
                    ? 'bg-indigo-500/20 text-indigo-200'
                    : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200'
                }`}
              >
                {item.short}
              </Link>
            );
          })}
        </nav>
      </aside>
    );
  }

  return (
    <aside className={`${mobile ? 'w-64' : 'hidden md:block w-48'} bg-zinc-900/50 border-r border-zinc-800 flex-shrink-0 overflow-y-auto`}>
      <nav aria-label="Primary navigation" className="py-3">
        {NAV.map((group) => (
          <div key={group.group} className="mb-3">
            <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
              {group.group}
            </div>
            {group.items.map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs border-l-2 cursor-pointer transition-colors ${
                    active
                      ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                      : 'border-transparent text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                  }`}
                >
                  <span className="w-1 h-1 rounded-full bg-current opacity-60" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Footer live strip
// ---------------------------------------------------------------------------

function LiveStrip() {
  const connectionStatus = useEventBusStore((s) => s.connectionStatus);
  const eventRate = useEventBusStore((s) => s.eventRate);
  const events = useEventBusStore((s) => s.events);

  // Build a small sparkline from the last 200 events bucketed into 10 × 1s slots
  const sparkData = React.useMemo(() => {
    const now = Date.now();
    const bucketSize = 1000;
    const buckets = new Array(10).fill(0) as number[];
    for (const e of events.slice(-200)) {
      const age = now - e.ts;
      const bucket = Math.floor(age / bucketSize);
      if (bucket >= 0 && bucket < buckets.length) {
        buckets[9 - bucket] += 1;
      }
    }
    return buckets;
  }, [events]);

  const statusColor =
    connectionStatus === 'connected'
      ? 'bg-emerald-400'
      : connectionStatus === 'connecting'
      ? 'bg-amber-400'
      : 'bg-red-400';

  return (
    <footer className="h-6 bg-zinc-950 border-t border-zinc-800 px-3 sm:px-4 flex items-center gap-2 sm:gap-3 text-[11px] text-zinc-500 flex-shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
      <span>{connectionStatus}</span>
      <span className="text-zinc-600">·</span>
      <span className="hidden sm:inline-flex">
        <Sparkline data={sparkData} color="#6366f1" />
      </span>
      <span>{eventRate.toFixed(1)} ev/s</span>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

function RootLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { setOpen: setPaletteOpen } = useCommandPaletteStore();

  // Start SSE connection on mount
  useEffect(() => {
    if (!isSSEAvailable()) return;
    connectSSE({});
    return () => disconnectSSE();
  }, []);

  // Ensure dark mode is active (dark-first design)
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileNavOpen]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200 font-sans overflow-hidden">
      {/* Command Palette overlay */}
      <CommandPalette />

      {/* Header */}
      <header role="banner" className="min-h-12 bg-zinc-900 border-b border-zinc-800 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
            aria-label="Open navigation"
          >
            Menu
          </button>
          {/* Logo + sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="hidden md:flex items-center gap-2 hover:opacity-80 transition-opacity"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-400 to-purple-500" />
            <span className="font-semibold tracking-tight text-sm">pragents</span>
          </button>

          <div className="hidden sm:block">
            <ProjectPicker />
          </div>

          {/* ⌘K search hint */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-700 transition-colors"
            aria-label="Open command palette (⌘K)"
          >
            <span className="hidden sm:inline">Search…</span>
            <KbdHint keys={['⌘', 'K']} />
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 text-xs">
          <HealthDot />
          <div className="hidden md:block">
            <CostBadge />
          </div>
          <InboxBadge />
        </div>
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative h-full w-64 bg-zinc-950 shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-zinc-800 px-3">
              <span className="font-semibold tracking-tight text-sm">pragents</span>
              <button className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100" onClick={() => setMobileNavOpen(false)}>
                Close
              </button>
            </div>
            {/* The header picker is hidden below sm — without this, mobile
                users could neither see nor change an active project scope. */}
            <div className="border-b border-zinc-800 px-3 py-2">
              <ProjectPicker id="project-picker-mobile" />
            </div>
            <Sidebar collapsed={false} mobile onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Body: sidebar + main outlet */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar collapsed={sidebarCollapsed} />
        <main role="main" className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Live strip footer */}
      <LiveStrip />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
