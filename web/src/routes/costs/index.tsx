import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { StatCard, ProgressBar, CompanyWideBadge } from '../../components/ui/index.js';
import { useScopeStore } from '../../stores/scope.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  totalTokens?: number;
  agents?: AgentCostRow[];
}

// Raw row returned by GET /api/v1/cost/summary (one row per project per month).
export interface CostSummaryRow {
  project_id: string;
  month: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  calls: number;
}

export function aggregateSummary(rows: CostSummaryRow[]): CostSummary {
  return rows.reduce(
    (acc, r) => ({
      totalCost: acc.totalCost + (r.cost ?? 0),
      totalCalls: acc.totalCalls + (r.calls ?? 0),
      totalTokens: (acc.totalTokens ?? 0) + (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
    }),
    { totalCost: 0, totalCalls: 0, totalTokens: 0 } as CostSummary,
  );
}

export interface AgentCostRow {
  agentId: string;
  agentName?: string;
  costEur: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface TodayCost {
  costEur: number;
  calls?: number;
}

export interface ModelCostRow {
  model: string;
  costEur: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

export function formatCostEur(value: number | null | undefined): string {
  if (value == null) return '—';
  return `€${value.toFixed(4)}`;
}

// Same as formatCostEur but renders 0 as €0.0000 instead of —.
// Use when the value comes from a fully-loaded source and 0 is a real result.
export function formatCostEurZeroAsValue(value: number | null | undefined): string {
  return `€${(value ?? 0).toFixed(4)}`;
}

export function formatTokens(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString();
}

export function formatCountZeroAsValue(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

export function sortAgentsByCost(agents: AgentCostRow[]): AgentCostRow[] {
  return [...agents].sort((a, b) => b.costEur - a.costEur);
}

export function sortModelsByCost(models: ModelCostRow[]): ModelCostRow[] {
  return [...models].sort((a, b) => b.costEur - a.costEur);
}

export function maxCost(rows: { costEur: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.costEur), 0);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/costs/')({
  component: CostsView,
});

function CostsView() {
  const selectedProject = useScopeStore((s) => s.selectedProject);

  // Summary rows are per project per month — the global scope filters them
  // client-side (see below) so the response shape stays uniform.
  const { data: summaryRaw, isLoading: summaryLoading } = useQuery<CostSummaryRow[] | CostSummary>({
    queryKey: ['cost-summary'],
    queryFn: () => fetch('/api/v1/cost/summary').then((r) => r.json()),
    staleTime: 60_000,
  });

  const { data: todayData } = useQuery<TodayCost>({
    queryKey: ['cost-today', selectedProject],
    queryFn: () =>
      fetch(`/api/v1/cost/today${selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : ''}`).then((r) => r.json()),
    staleTime: 30_000,
  });

  const { data: modelData } = useQuery<ModelCostRow[] | { items: ModelCostRow[] }>({
    queryKey: ['cost-by-model'],
    queryFn: () => fetch('/api/v1/cost/by-model').then((r) => r.json()),
    staleTime: 60_000,
  });

  // API returns an array of per-project rows; older callers expected a single summary object.
  // Accept both shapes.
  const summary: CostSummary | undefined = Array.isArray(summaryRaw)
    ? aggregateSummary(
        selectedProject
          ? (summaryRaw as CostSummaryRow[]).filter((r) => r.project_id === selectedProject)
          : (summaryRaw as CostSummaryRow[]),
      )
    : (summaryRaw as CostSummary | undefined);

  const modelRows: ModelCostRow[] = Array.isArray(modelData)
    ? modelData
    : Array.isArray((modelData as any)?.items)
    ? (modelData as any).items
    : [];

  const agents = sortAgentsByCost(summary?.agents ?? []);
  const models = sortModelsByCost(modelRows);
  const maxAgentCost = maxCost(agents);
  const mostExpensiveModel = models[0]?.model;

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-xl font-bold text-zinc-100 mb-4">Costs</h2>

      {/* Info banner */}
      <div className="mb-4 bg-zinc-800/50 border border-zinc-700 rounded-lg px-4 py-2 text-xs text-zinc-400">
        Showing current month + today. Historical range not yet supported.
      </div>

      {/* Top 3 StatCards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label="This month"
          value={summaryLoading ? '—' : formatCostEurZeroAsValue(summary?.totalCost)}
          mono
        />
        <StatCard
          label="Today"
          value={formatCostEurZeroAsValue(todayData?.costEur)}
          mono
        />
        <StatCard
          label="Total calls"
          value={summaryLoading ? '—' : formatCountZeroAsValue(summary?.totalCalls)}
          mono
        />
      </div>

      {/* Per-agent table */}
      {agents.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            By Agent
          </h3>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2">Agent</th>
                  <th className="px-4 py-2 w-32">Share</th>
                  <th className="text-right px-4 py-2">Cost (€)</th>
                  <th className="text-right px-4 py-2">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {agents.map((a) => (
                  <tr key={a.agentId} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2 text-zinc-200 font-medium">
                      {a.agentName ?? a.agentId}
                    </td>
                    <td className="px-4 py-2">
                      <ProgressBar
                        value={maxAgentCost > 0 ? (a.costEur / maxAgentCost) * 100 : 0}
                      />
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-300">
                      {a.costEur.toFixed(4)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-500">
                      {(a.tokensIn + a.tokensOut).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-model table */}
      {models.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            By Model
            <CompanyWideBadge />
          </h3>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2">Model</th>
                  <th className="text-right px-4 py-2">Calls</th>
                  <th className="text-right px-4 py-2">Tokens In</th>
                  <th className="text-right px-4 py-2">Tokens Out</th>
                  <th className="text-right px-4 py-2">Cost (€)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {models.map((m) => (
                  <tr key={m.model} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2 text-zinc-200 font-medium flex items-center gap-2">
                      {m.model}
                      {m.model === mostExpensiveModel && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                          most used
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-400">{m.calls.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{m.tokensIn.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{m.tokensOut.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-300">
                      {m.costEur.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

