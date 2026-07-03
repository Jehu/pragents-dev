import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '../../components/ui/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthData {
  status: string;
  uptime: number;
  db: {
    connected: boolean;
    size: number;
  };
  memory: {
    store: string;
    degraded: boolean;
  };
  agents_active: number;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ') || '0m';
}

export function isHealthy(data: HealthData): boolean {
  return data.db.connected && !data.memory.degraded;
}

export function isWarning(data: HealthData): boolean {
  return !data.db.connected || data.memory.degraded;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/health/')({
  component: HealthView,
});

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
        ok ? 'bg-emerald-400' : 'bg-red-400'
      }`}
    />
  );
}

function HealthRow({ label, children, ok }: { label: string; children: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3 text-sm">
      <StatusDot ok={ok ?? true} />
      <span className="w-40 text-zinc-400 flex-shrink-0">{label}</span>
      <span className="text-zinc-200">{children}</span>
    </div>
  );
}

function HealthView() {
  const { data, isLoading, isError } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => fetch('/api/v1/health').then((r) => r.json()),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  if (isLoading) {
    return <div className="p-6 text-zinc-400 text-sm">Loading health status…</div>;
  }

  if (isError || !data) {
    return <div className="p-6 text-red-400 text-sm">Failed to load health status.</div>;
  }

  const warn = isWarning(data);

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-xl font-bold text-zinc-100 mb-4">Health</h2>

      {/* Warn banner */}
      {warn && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4 text-sm text-red-300">
          <span className="flex-shrink-0">✕</span>
          <span>
            {!data.db.connected && 'Database disconnected. '}
            {data.memory.degraded && 'Memory store is degraded.'}
          </span>
        </div>
      )}

      {/* Status rows */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800">
        <HealthRow label="DB connected" ok={data.db.connected}>
          <StatusPill status={data.db.connected ? 'ok' : 'failed'} />
        </HealthRow>

        <HealthRow label="DB size" ok={true}>
          {formatBytes(data.db.size)}
        </HealthRow>

        <HealthRow label="Memory store" ok={!data.memory.degraded}>
          {data.memory.store}
        </HealthRow>

        <HealthRow label="Memory status" ok={!data.memory.degraded}>
          {data.memory.degraded ? (
            <StatusPill status="failed" />
          ) : (
            <span className="text-emerald-400">nominal</span>
          )}
        </HealthRow>

        <HealthRow label="Active agents" ok={true}>
          {data.agents_active}
        </HealthRow>

        <HealthRow label="Uptime" ok={true}>
          {formatUptime(data.uptime)}
        </HealthRow>
      </div>
    </div>
  );
}
