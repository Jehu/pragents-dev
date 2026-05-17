import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusPill } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';

export const Route = createFileRoute('/plans/$planId')({
  component: PlanDetailPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanStep {
  id?: string;
  description: string;
  agentId?: string;
  status?: string;
  output?: string;
}

export interface WorkflowStepArtifact {
  id: string;
  stepId: string;
  description?: string;
  agentId?: string | null;
  status: string;
  output?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface WorkflowRunArtifact {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  steps?: WorkflowStepArtifact[];
}

interface Plan {
  id: string;
  prompt: string;
  status: string;
  origin?: 'nl' | 'chat' | string;
  steps?: PlanStep[];
  conversationId?: string;
  result?: { runId?: string } | null;
  workflowRun?: WorkflowRunArtifact;
  createdAt: string;
  updatedAt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, StatusType> = {
  draft: 'proposed',
  approved: 'proposed',
  executing: 'running',
  running: 'running',
  done: 'complete',
  failed: 'failed',
  cancelled: 'cold',
};

function toPlanStatusPill(status: string): StatusType {
  return STATUS_MAP[status] ?? 'idle';
}

const STEP_STATUS_MAP: Record<string, string> = {
  running: 'bg-sky-500',
  done: 'bg-emerald-500',
  complete: 'bg-emerald-500',
  failed: 'bg-red-500',
  pending: 'bg-zinc-600',
};

function stepDotClass(status?: string): string {
  return STEP_STATUS_MAP[status ?? 'pending'] ?? 'bg-zinc-600';
}

export function planArtifacts(plan: Plan): WorkflowStepArtifact[] {
  return plan.workflowRun?.steps?.filter((step) => Boolean(step.output?.trim())) ?? [];
}

// ─── Step Rail ────────────────────────────────────────────────────────────────

function StepRail({ steps, planStatus }: { steps: PlanStep[]; planStatus: string }) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const showStatus = Boolean(step.status);

        return (
          <li key={step.id ?? i} className="relative flex gap-3 group">
            {/* Vertical rail line */}
            <div className="flex flex-col items-center flex-shrink-0 w-6">
              <div className={`w-3 h-3 rounded-full mt-0.5 flex-shrink-0 z-10 ${stepDotClass(step.status)}`} />
              {!isLast && <div className="w-0.5 bg-zinc-700 flex-1 mt-1 mb-0" />}
            </div>

            {/* Step content */}
            <div className={`pb-4 flex-1 min-w-0 ${isLast ? 'pb-0' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-600 font-mono">{i + 1}</span>
                <span className="text-sm text-zinc-200">{step.description}</span>
                {step.agentId && <span className="text-[11px] text-zinc-500 font-mono">{step.agentId}</span>}
                {showStatus && step.status && (
                  <StatusPill status={toPlanStatusPill(step.status)} />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PlanDetailPage() {
  const { planId } = Route.useParams();
  const queryClient = useQueryClient();
  const [actionDone, setActionDone] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['plan', planId],
    queryFn: () => fetch(`/api/v1/plans/${planId}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    staleTime: 10_000,
  });

  const plan: Plan | null = data?.plan ?? data ?? null;

  const approveMutation = useMutation({
    mutationFn: () => fetch(`/api/v1/plans/${planId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      setActionDone('approved');
      void queryClient.invalidateQueries({ queryKey: ['plan', planId] });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => fetch(`/api/v1/plans/${planId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setActionDone('cancelled');
      void queryClient.invalidateQueries({ queryKey: ['plan', planId] });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
  });

  const busy = approveMutation.isPending || cancelMutation.isPending;
  const isDraft = plan?.status === 'draft';
  const isRunning = plan?.status === 'running' || plan?.status === 'executing' || plan?.status === 'approved';
  const artifacts = plan ? planArtifacts(plan) : [];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Back link */}
      <Link to="/plans" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mb-5">
        ← Plans
      </Link>

      {isLoading && (
        <div className="text-xs text-zinc-500 py-12 text-center">Loading…</div>
      )}

      {error && (
        <div className="text-sm text-red-400 py-8 text-center">Failed to load plan.</div>
      )}

      {plan && (
        <div className="space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <StatusPill status={toPlanStatusPill(plan.status)} />
              {plan.origin && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-wider">
                  {plan.origin}
                </span>
              )}
            </div>
            <h1 className="text-lg font-semibold text-zinc-100 leading-snug">{plan.prompt}</h1>
            <p className="text-[11px] text-zinc-600 mt-1 font-mono">{plan.id}</p>
          </div>

          {/* Origin backlink for chat */}
          {plan.origin === 'chat' && plan.conversationId && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
              <span className="text-xs text-zinc-500">From conversation: </span>
              <Link
                to="/chat"
                search={{ conversationId: plan.conversationId, agentId: undefined }}
                className="text-xs text-sky-400 hover:text-sky-300 font-mono"
              >
                {plan.conversationId}
              </Link>
            </div>
          )}

          {/* Actions */}
          {(isDraft || isRunning) && !actionDone && (
            <div className="flex gap-2">
              {isDraft && (
                <button
                  onClick={() => approveMutation.mutate()}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm text-white font-semibold disabled:opacity-40 transition-colors"
                >
                  {approveMutation.isPending ? 'Approving…' : 'Approve plan'}
                </button>
              )}
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 font-medium disabled:opacity-40 transition-colors"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          )}

          {actionDone && (
            <div className="text-xs text-zinc-400 bg-zinc-800 rounded-lg px-3 py-2">
              Plan {actionDone}.
            </div>
          )}

          {/* Steps */}
          {plan.steps && plan.steps.length > 0 ? (
            <section>
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                Steps ({plan.steps.length})
              </h2>
              <StepRail steps={plan.steps} planStatus={plan.status} />
            </section>
          ) : (
            <div className="text-xs text-zinc-600 italic">No steps defined.</div>
          )}

          {/* Artifacts */}
          {plan.workflowRun && (
            <section>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                  Artifacts ({artifacts.length})
                </h2>
                <Link
                  to="/workflows"
                  className="text-xs text-sky-400 hover:text-sky-300 font-mono"
                >
                  {plan.workflowRun.workflowName} · {plan.workflowRun.id.slice(0, 8)}
                </Link>
              </div>
              {artifacts.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500">
                  This run completed, but no step produced a text artifact.
                </div>
              ) : (
                <div className="space-y-3">
                  {artifacts.map((artifact) => (
                    <article key={artifact.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] text-zinc-500 font-mono">{artifact.stepId}</span>
                        {artifact.agentId && <span className="text-[11px] text-zinc-500 font-mono">{artifact.agentId}</span>}
                        <StatusPill status={toPlanStatusPill(artifact.status)} />
                      </div>
                      {artifact.description && (
                        <div className="mb-2 text-[11px] text-zinc-500">{artifact.description}</div>
                      )}
                      <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-300 max-h-80 overflow-auto">
                        {artifact.output}
                      </pre>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
