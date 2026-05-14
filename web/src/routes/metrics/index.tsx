import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { StatCard } from '../../components/ui/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricsData {
  skillSuccessRate: number | null;
  memoryHitRate: number | null;
  escalationsPerGoalRun: number | null;
  tokensPerCompletedTask: number | null;
  windowDays: number;
  computedAt: string;
  notes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

export function formatPercent(value: number | null): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}`;
}

export function formatInteger(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString();
}

export function formatEscalations(value: number | null): string {
  if (value == null) return '—';
  return value.toFixed(2);
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

export function hasNotes(notes: Record<string, string>): boolean {
  return Object.values(notes).some((v) => v !== '' && v != null);
}

// camelCase → "Camel Case" for any metric key the backend emits.
export function humanizeMetricKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

// Replace internal event-name jargon with user-readable phrases.
export function humanizeMetricNote(note: string): string {
  return note
    .replace(/no skill\.used events in window/i, 'No skill activity recorded in the window')
    .replace(/no memory\.recall events in window/i, 'No memory lookups recorded in the window')
    .replace(/no goal_runs in window/i, 'No goal runs recorded in the window')
    .replace(/no completed tasks in window/i, 'No completed tasks in the window')
    .replace(/query failed — see logs/i, 'Backend query failed — see logs')
    .replace(/needs task_id propagation/i, 'task IDs not yet wired into the skill event stream');
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/metrics/')({
  component: MetricsView,
});

function MetricsView() {
  const { data, isLoading, isError } = useQuery<MetricsData>({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/v1/metrics').then((r) => r.json()),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="p-6 text-zinc-400 text-sm">Loading metrics…</div>;
  }

  if (isError || !data) {
    return <div className="p-6 text-red-400 text-sm">Failed to load metrics.</div>;
  }

  const notes = data.notes ?? {};
  const notesEntries = Object.entries(notes).filter(([, v]) => v !== '' && v != null);

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold text-zinc-100 mb-4">Metrics</h2>

      {/* 2×2 StatCard grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div title={notes['skillSuccessRate'] ?? undefined}>
          <StatCard
            label="Skill success rate"
            value={data.skillSuccessRate != null ? formatPercent(data.skillSuccessRate) : '—'}
            subline={data.skillSuccessRate != null ? '%' : 'No data yet'}
          />
        </div>

        <div title={notes['memoryHitRate'] ?? undefined}>
          <StatCard
            label="Memory hit rate"
            value={data.memoryHitRate != null ? formatPercent(data.memoryHitRate) : '—'}
            subline={data.memoryHitRate != null ? '%' : 'No data yet'}
          />
        </div>

        <div title={notes['escalationsPerGoalRun'] ?? undefined}>
          <StatCard
            label="Escalations per goal run"
            value={formatEscalations(data.escalationsPerGoalRun)}
            subline={data.escalationsPerGoalRun == null ? 'No data yet' : undefined}
          />
        </div>

        <div title={notes['tokensPerCompletedTask'] ?? undefined}>
          <StatCard
            label="Tokens per completed task"
            value={formatInteger(data.tokensPerCompletedTask)}
            mono={data.tokensPerCompletedTask != null}
            subline={data.tokensPerCompletedTask == null ? 'No data yet' : undefined}
          />
        </div>
      </div>

      {/* Window subtitle */}
      <p className="text-xs text-zinc-500 mb-6">
        {data.windowDays}-day window · updated {relativeTime(data.computedAt)}
      </p>

      {/* Notes amber banners */}
      {notesEntries.length > 0 && (
        <div className="space-y-2">
          {notesEntries.map(([key, note]) => (
            <div
              key={key}
              className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-300"
            >
              <span className="flex-shrink-0 mt-0.5">⚠</span>
              <span>
                <span className="font-semibold">{humanizeMetricKey(key)}:</span> {humanizeMetricNote(note)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
