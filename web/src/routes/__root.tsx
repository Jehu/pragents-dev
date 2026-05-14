import React, { useEffect, useState } from 'react';
import { createRootRoute, Outlet, Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useScopeStore } from '../stores/scope.js';
import { useEventBusStore } from '../stores/eventBus.js';
import { useCommandPaletteStore } from '../stores/commandPalette.js';
import { connectSSE, disconnectSSE, isSSEAvailable } from '../hooks/useSSE.js';
import { KbdHint, Sparkline } from '../components/ui/index.js';
import { CommandPalette } from '../components/CommandPalette.js';

// ---------------------------------------------------------------------------
// Sidebar navigation structure
// ---------------------------------------------------------------------------

type NavItem = {
  label: string;
  to: string;
};

type NavGroup = {
  group: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'Overview', to: '/overview' },
      { label: 'Inbox', to: '/inbox' },
    ],
  },
  {
    group: 'Run',
    items: [
      { label: 'Agents', to: '/agents' },
      { label: 'Tasks', to: '/tasks' },
      { label: 'Plans', to: '/plans' },
      { label: 'Workflows', to: '/workflows' },
      { label: 'Goals', to: '/goals' },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { label: 'Skills', to: '/skills' },
      { label: 'Memory', to: '/memory' },
    ],
  },
  {
    group: 'Observe',
    items: [
      { label: 'Metrics', to: '/metrics' },
      { label: 'Costs', to: '/costs' },
      { label: 'Health', to: '/health' },
      { label: 'Traces', to: '/traces' },
    ],
  },
  {
    group: 'Talk',
    items: [{ label: 'Chat', to: '/chat' }],
  },
];

// ---------------------------------------------------------------------------
// Header sub-components
// ---------------------------------------------------------------------------

function ProjectPicker() {
  const { selectedProject, setProject } = useScopeStore();
  const { data } = useQuery<{ projects?: { id: string; name: string }[] }>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/v1/projects').then((r) => r.json()),
    staleTime: 60_000,
  });

  const projects = data?.projects ?? [];

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-zinc-500">project:</span>
      <select
        value={selectedProject ?? ''}
        onChange={(e) => setProject(e.target.value || null)}
        className="bg-transparent text-zinc-200 border-none outline-none cursor-pointer hover:text-zinc-100 py-1 pr-4"
      >
        <option value="">all projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function HealthDot() {
  const { data } = useQuery<{ status?: string }>({
    queryKey: ['health'],
    queryFn: () => fetch('/api/v1/health').then((r) => r.json()),
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
  const { data } = useQuery<{ totalCost?: number; currency?: string }>({
    queryKey: ['cost-monthly'],
    queryFn: () => fetch('/api/v1/cost/monthly').then((r) => r.json()),
    staleTime: 300_000,
  });

  const cost = data?.totalCost != null
    ? `€${data.totalCost.toFixed(2)}`
    : '—';

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-500">cost this month</span>
      <span className="text-zinc-200 font-mono">{cost}</span>
    </div>
  );
}

function InboxBadge() {
  const { data } = useQuery<{ total?: number }>({
    queryKey: ['inbox-count'],
    queryFn: () => fetch('/api/v1/tasks?status=needs_review&limit=1').then((r) => r.json()),
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

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  function isActive(to: string): boolean {
    if (to === '/overview') return pathname === '/overview' || pathname === '/';
    return pathname.startsWith(to);
  }

  if (collapsed) {
    return (
      <aside className="w-10 bg-zinc-900/50 border-r border-zinc-800 flex-shrink-0 overflow-y-auto" />
    );
  }

  return (
    <aside className="w-48 bg-zinc-900/50 border-r border-zinc-800 flex-shrink-0 overflow-y-auto">
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
    <footer className="h-6 bg-zinc-950 border-t border-zinc-800 px-4 flex items-center gap-3 text-[11px] text-zinc-500 flex-shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
      <span>{connectionStatus}</span>
      <span className="text-zinc-600">·</span>
      <Sparkline data={sparkData} color="#6366f1" />
      <span>{eventRate.toFixed(1)} ev/s</span>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

function RootLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200 font-sans overflow-hidden">
      {/* Command Palette overlay */}
      <CommandPalette />

      {/* Header */}
      <header role="banner" className="h-12 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          {/* Logo + sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-400 to-purple-500" />
            <span className="font-semibold tracking-tight text-sm">pragents</span>
          </button>

          <ProjectPicker />

          {/* ⌘K search hint */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-700 transition-colors"
            aria-label="Open command palette (⌘K)"
          >
            <span>Search…</span>
            <KbdHint keys={['⌘', 'K']} />
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <HealthDot />
          <CostBadge />
          <InboxBadge />
        </div>
      </header>

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
