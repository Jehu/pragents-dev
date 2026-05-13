import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { StatusPill, EmptyState } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';

export const Route = createFileRoute('/goals/')({
  component: GoalsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  description: string;
  cadence: string;
  cron?: string; // alias fallback
  targetAgentId?: string;
  targetWorkflowId?: string;
  workflow?: string;
  deadline?: string;
  status?: string;
  createdAt?: string;
}

export interface GoalRun {
  id: string;
  goalId: string;
  triggeredAt: string;
  status: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  const allStar = (v: string) => v === '*';
  const isNum = (v: string) => /^\d+$/.test(v);

  // every minute: * * * * *
  if (allStar(minute) && allStar(hour) && allStar(dayOfMonth) && allStar(dayOfWeek)) {
    return 'every minute';
  }

  // every hour: 0 * * * *
  if (minute === '0' && allStar(hour) && allStar(dayOfMonth) && allStar(dayOfWeek)) {
    return 'every hour';
  }

  const hourStr = isNum(hour) ? hour.padStart(2, '0') + ':00' : null;

  if (hourStr) {
    // every weekday: 0 9 * * 1-5
    if (dayOfWeek === '1-5' && allStar(dayOfMonth)) {
      return `every weekday at ${hourStr}`;
    }

    // specific day of week: 0 9 * * 1
    const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (isNum(dayOfWeek) && !allStar(dayOfWeek) && allStar(dayOfMonth)) {
      const idx = parseInt(dayOfWeek, 10);
      const name = DOW_NAMES[idx] ?? dayOfWeek;
      return `every ${name} at ${hourStr}`;
    }

    // specific day of month: 0 9 1 * *
    if (isNum(dayOfMonth) && !allStar(dayOfMonth) && allStar(dayOfWeek)) {
      const d = parseInt(dayOfMonth, 10);
      return `every ${d}${ordinalSuffix(d)} of the month at ${hourStr}`;
    }

    // every day: 0 9 * * *
    if (allStar(dayOfMonth) && allStar(dayOfWeek)) {
      return `every day at ${hourStr}`;
    }
  }

  return cron;
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function relativeTimeMs(tsMs: number): string {
  const s = Math.floor((Date.now() - tsMs) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_PILL_MAP: Record<string, StatusType> = {
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  pending: 'idle',
};

function toStatusPill(s: string): StatusType {
  return STATUS_PILL_MAP[s] ?? 'idle';
}

// ─── Goal Table ───────────────────────────────────────────────────────────────

function GoalTable({ goals }: { goals: Goal[] }) {
  if (goals.length === 0) {
    return (
      <EmptyState
        icon="🎯"
        title="No goals"
        description="No scheduled goals found. Add goals to pragents.yaml."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="py-2 pr-4 font-medium">ID</th>
            <th className="py-2 pr-4 font-medium">Description</th>
            <th className="py-2 pr-4 font-medium">Schedule</th>
            <th className="py-2 pr-4 font-medium">Target</th>
            <th className="py-2 pr-4 font-medium">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => (
            <tr key={g.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
              <td className="py-2.5 pr-4">
                <span className="font-mono text-xs text-zinc-400">{g.id}</span>
              </td>
              <td className="py-2.5 pr-4">
                <span className="text-zinc-200">{g.description}</span>
              </td>
              <td className="py-2.5 pr-4">
                <span className="font-mono text-xs text-zinc-300 block">{g.cadence ?? g.cron}</span>
                <span className="text-[11px] text-zinc-500">{parseCron(g.cadence ?? g.cron ?? '')}</span>
              </td>
              <td className="py-2.5 pr-4">
                <span className="text-xs text-zinc-400">
                  {g.targetAgentId ?? g.targetWorkflowId ?? g.workflow ?? '—'}
                </span>
              </td>
              <td className="py-2.5 pr-4">
                <span className="text-xs text-zinc-400">
                  {g.deadline
                    ? (() => {
                        const ms = new Date(g.deadline).getTime();
                        return isNaN(ms) ? parseCron(g.deadline) : relativeTimeMs(ms);
                      })()
                    : '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Goal Runs ────────────────────────────────────────────────────────────────

function GoalRunList({ runs }: { runs: GoalRun[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (runs.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="No runs yet"
        description="Goal run history will appear here."
      />
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-y-auto max-h-[400px] space-y-1">
      {runs.map((run) => (
        <div key={run.id} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[11px] text-zinc-500">{run.goalId}</span>
              <span className="text-xs text-zinc-400">
                {relativeTimeMs(new Date(run.triggeredAt).getTime())}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={toStatusPill(run.status)} />
              {run.error && (
                <button
                  onClick={() => toggle(run.id)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300"
                >
                  {expanded.has(run.id) ? 'hide ▲' : 'error ▼'}
                </button>
              )}
            </div>
          </div>
          {run.error && expanded.has(run.id) && (
            <div className="mt-2 text-[11px] text-red-400 font-mono bg-red-950/20 rounded p-2 whitespace-pre-wrap">
              {run.error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function GoalsPage() {
  const queryClient = useQueryClient();

  const busEvents = useEventBusStore((s) => s.events);
  useEffect(() => {
    const latest = busEvents[busEvents.length - 1];
    if (latest && typeof latest.type === 'string' && latest.type.startsWith('goal.')) {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      void queryClient.invalidateQueries({ queryKey: ['goal-runs'] });
    }
  }, [busEvents, queryClient]);

  const { data: goalsData, isLoading: goalsLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: () => fetch('/api/v1/goals').then((r) => r.json()),
    staleTime: 15_000,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['goal-runs'],
    queryFn: () => fetch('/api/v1/goals/runs').then((r) => r.json()),
    staleTime: 15_000,
  });

  const goals: Goal[] = Array.isArray(goalsData?.goals)
    ? goalsData.goals
    : Array.isArray(goalsData)
    ? goalsData
    : [];
  const runs: GoalRun[] = Array.isArray(runsData?.runs)
    ? runsData.runs
    : Array.isArray(runsData)
    ? runsData
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Goals</h1>
        <p className="text-sm text-zinc-500 mt-1">Scheduled goals and run history.</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Scheduled Goals
        </h2>
        {goalsLoading ? (
          <div className="text-xs text-zinc-500 py-8 text-center">Loading…</div>
        ) : (
          <GoalTable goals={goals} />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Recent Runs
          <span className="ml-2 text-zinc-600 font-normal normal-case">({runs.length})</span>
        </h2>
        {runsLoading ? (
          <div className="text-xs text-zinc-500 py-8 text-center">Loading…</div>
        ) : (
          <GoalRunList runs={runs} />
        )}
      </section>
    </div>
  );
}
