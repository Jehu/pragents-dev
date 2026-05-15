import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueries, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import * as YAML from 'yaml';
import { Modal } from '../../components/Modal.js';
import { StatusPill, EmptyState } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';

export const Route = createFileRoute('/workflows/')({
  component: WorkflowsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowDef {
  name: string;
  /** null for repo-global workflows; project id when loaded from a project's workflow dir. */
  projectId?: string | null;
  description?: string;
  steps?: unknown[];
  stepCount?: number;
  trigger?: string;
}

interface RunStep {
  id: string;
  stepId: string;
  agentId?: string | null;
  status: string;
  output?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  gateStatus?: string | null;
  gateFeedback?: string | null;
  error?: string | null;
}

interface WorkflowRun {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  steps?: RunStep[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTimeIso(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function durationStr(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

const RUN_STATUS_MAP: Record<string, StatusType> = {
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  pending: 'idle',
  interrupted: 'cold',
};

function toRunStatusPill(status: string): StatusType {
  return RUN_STATUS_MAP[status] ?? 'idle';
}

const STEP_DOT: Record<string, string> = {
  running: 'bg-sky-500',
  complete: 'bg-emerald-500',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
  pending: 'bg-zinc-600',
  skipped: 'bg-zinc-700',
};

function stepDot(status: string): string {
  return STEP_DOT[status] ?? 'bg-zinc-600';
}

// ─── Projects-by-workflow section ─────────────────────────────────────────────
// The global registry (`/api/v1/workflows`) and per-project workflow files
// (`<projectDir>/workflows/<name>.yaml`) are two separate systems. The global
// list above only covers the registry; this section gives users a discoverable
// route to project-scoped CRUD without conflating the two surfaces.

interface ProjectSummary {
  id: string;
  name: string;
  directory: string;
}

interface ProjectWorkflowFile {
  name: string;
  description?: string;
  mtime: number;
}

function ProjectWorkflowsSection() {
  const { data: projects, isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/v1/projects');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ProjectSummary[];
    },
    staleTime: 30_000,
  });

  const wfQueries = useQueries({
    queries: (projects ?? []).map((p) => ({
      queryKey: ['workflows', p.id],
      queryFn: async () => {
        const res = await fetch(
          `/api/v1/projects/${encodeURIComponent(p.id)}/workflows`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProjectWorkflowFile[];
      },
      staleTime: 15_000,
    })),
  });

  if (isLoading) {
    return <div className="text-xs text-zinc-500 py-6 text-center">Loading…</div>;
  }
  if (!projects || projects.length === 0) {
    return (
      <EmptyState
        icon="📁"
        title="No projects"
        description="Create a project to author project-scoped workflows."
      />
    );
  }

  return (
    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
      {projects.map((p, i) => {
        const q = wfQueries[i];
        const files = (q?.data ?? []) as ProjectWorkflowFile[];
        return (
          <Link
            key={p.id}
            to="/projects/$projectId/workflows"
            params={{ projectId: p.id }}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5 no-underline block"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-zinc-100 truncate">
                  {p.name || p.id}
                </div>
                <p className="text-[11px] text-zinc-500 font-mono mt-0.5 truncate">
                  {p.id}
                </p>
              </div>
              <span className="text-[11px] text-zinc-500 flex-shrink-0">
                {q?.isLoading
                  ? '…'
                  : files.length === 0
                  ? 'no files'
                  : `${files.length} file${files.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="text-[11px] text-indigo-400 mt-2">Manage workflows →</p>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Workflow Def Cards ───────────────────────────────────────────────────────

function WorkflowDefCard({ wf, latestRun }: { wf: WorkflowDef; latestRun?: WorkflowRun }) {
  const stepCount = wf.stepCount ?? (Array.isArray(wf.steps) ? wf.steps.length : 0);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  // Lazy fetch of the full definition for the read-only YAML viewer.
  // Only repo workflows surface this affordance — project workflows
  // already have a full editor reachable from the clickable name.
  const viewQuery = useQuery({
    queryKey: ['workflow-def', wf.name],
    enabled: viewing,
    queryFn: async () => {
      const res = await fetch(`/api/v1/workflows/${encodeURIComponent(wf.name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/workflows/${encodeURIComponent(wf.name)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to start'),
  });

  const editorHref = wf.projectId
    ? `/projects/${encodeURIComponent(wf.projectId)}/workflows/${encodeURIComponent(wf.name)}`
    : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editorHref ? (
              <Link
                to="/projects/$projectId/workflows/$workflowName"
                params={{ projectId: wf.projectId!, workflowName: wf.name }}
                className="font-mono text-sm text-zinc-100 hover:text-indigo-300 no-underline"
              >
                {wf.name}
              </Link>
            ) : (
              <span className="font-mono text-sm text-zinc-100">{wf.name}</span>
            )}
            {wf.projectId ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
                {wf.projectId}
              </span>
            ) : (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700 uppercase tracking-wider"
                title="Loaded from <repo>/workflows/ — edit the YAML file on disk"
              >
                repo
              </span>
            )}
            {wf.trigger && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-wider">
                {wf.trigger}
              </span>
            )}
          </div>
          {wf.description && (
            <p className="text-xs text-zinc-500 mt-1">{wf.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-zinc-600">
            {stepCount > 0 && <span>{stepCount} steps</span>}
            {latestRun && (
              <>
                <span>·</span>
                <span>latest: </span>
                <StatusPill status={toRunStatusPill(latestRun.status)} />
              </>
            )}
          </div>
          {error && (
            <p className="text-[11px] text-red-400 mt-1.5">Failed to start: {error}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="text-xs px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-500/30"
          >
            {runMutation.isPending ? 'Starting…' : '▶ Run'}
          </button>
          {!editorHref && (
            <button
              type="button"
              onClick={() => setViewing(true)}
              className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
            >
              View YAML
            </button>
          )}
        </div>
      </div>

      {viewing && (
        <Modal
          open
          onClose={() => setViewing(false)}
          ariaLabel={`View ${wf.name}`}
        >
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-100 font-mono">{wf.name}</h3>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700 uppercase tracking-wider"
              title="Loaded from <repo>/workflows/ — edit the YAML file on disk"
            >
              repo · read-only
            </span>
          </div>
          <div className="p-5 max-h-[60vh] overflow-auto">
            {viewQuery.isLoading ? (
              <div className="text-xs text-zinc-500">Loading…</div>
            ) : viewQuery.error ? (
              <div className="text-xs text-red-400" role="alert">
                Failed to load: {String((viewQuery.error as Error).message)}
              </div>
            ) : (
              <pre className="text-[12px] leading-5 text-zinc-200 font-mono whitespace-pre-wrap">
                {YAML.stringify(viewQuery.data ?? {}, { indent: 2 })}
              </pre>
            )}
          </div>
          <div className="border-t border-zinc-800 px-5 py-3 flex justify-end">
            <button
              type="button"
              onClick={() => setViewing(false)}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Run Step Rail ────────────────────────────────────────────────────────────

function RunStepList({ steps }: { steps: RunStep[] }) {
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const toggleError = (id: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isPendingGate = step.gateStatus === 'pending' || step.gateStatus === 'revision_requested';
        const isFailed = step.status === 'failed';
        const hasError = isFailed && (step.error || step.output);

        return (
          <li
            key={step.id}
            className={`relative flex gap-3 ${isPendingGate ? 'bg-amber-950/20 rounded-lg' : ''} ${isFailed ? 'bg-red-950/10 rounded-lg' : ''}`}
          >
            {/* Rail */}
            <div className="flex flex-col items-center flex-shrink-0 w-6 ml-1">
              <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 z-10 ${stepDot(step.status)}`} />
              {!isLast && <div className="w-0.5 bg-zinc-800 flex-1 mt-1" />}
            </div>

            {/* Content */}
            <div className={`pb-3 flex-1 min-w-0 ${isLast ? 'pb-1' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                <span className="text-[11px] text-zinc-600 font-mono">{i + 1}</span>
                <span className="text-sm text-zinc-200">{step.stepId}</span>

                {isPendingGate && (
                  <>
                    <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium">
                      waiting on gate
                    </span>
                    <Link
                      to="/inbox"
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 underline"
                    >
                      Review in inbox →
                    </Link>
                  </>
                )}

                {!isPendingGate && step.status !== 'pending' && (
                  <StatusPill status={toRunStatusPill(step.status)} />
                )}

                {hasError && (
                  <button
                    onClick={() => toggleError(step.id)}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    {expandedErrors.has(step.id) ? 'hide error ▲' : 'error ▼'}
                  </button>
                )}
              </div>

              {/* Gate feedback */}
              {step.gateFeedback && (
                <div className="mt-1.5 text-[11px] text-sky-400/80 bg-sky-950/20 rounded px-2 py-1">
                  Feedback: {step.gateFeedback}
                </div>
              )}

              {/* Error expander */}
              {hasError && expandedErrors.has(step.id) && (
                <div className="mt-1.5 text-[11px] text-red-400 font-mono bg-red-950/20 rounded px-2 py-1.5 whitespace-pre-wrap">
                  {step.error || step.output}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Run Row ──────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: WorkflowRun }) {
  const [expanded, setExpanded] = useState(false);
  const steps = run.steps ?? [];
  const hasPendingGate = steps.some(
    (s) => s.gateStatus === 'pending' || s.gateStatus === 'revision_requested',
  );

  return (
    <div className={`border rounded-lg overflow-hidden ${hasPendingGate ? 'border-amber-700/50' : 'border-zinc-800'}`}>
      {/* Run header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`w-full text-left px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-zinc-800/50 transition-colors ${hasPendingGate ? 'bg-amber-950/10' : 'bg-zinc-900'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-zinc-100 truncate">{run.workflowName}</span>
          <StatusPill status={toRunStatusPill(run.status)} />
          {hasPendingGate && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">gate pending</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-[11px] text-zinc-500">
          <span>{relativeTimeIso(run.startedAt)}</span>
          <span className="font-mono">{durationStr(run.startedAt, run.completedAt)}</span>
          <span className="text-zinc-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded steps */}
      {expanded && (
        <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-3">
          {steps.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">No steps recorded.</p>
          ) : (
            <RunStepList steps={steps} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function WorkflowsPage() {
  const queryClient = useQueryClient();

  const busEvents = useEventBusStore((s) => s.events);
  useEffect(() => {
    const latest = busEvents[busEvents.length - 1];
    if (latest && typeof latest.type === 'string' && latest.type.startsWith('workflow.')) {
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
    }
  }, [busEvents, queryClient]);

  const { data: wfData, isLoading: wfLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => fetch('/api/v1/workflows').then((r) => r.json()),
    staleTime: 30_000,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['workflow-runs'],
    queryFn: () => fetch('/api/v1/workflows/runs?includeSteps=true').then((r) => r.json()),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const workflows: WorkflowDef[] = Array.isArray(wfData?.workflows)
    ? wfData.workflows
    : Array.isArray(wfData)
    ? wfData
    : [];

  const runs: WorkflowRun[] = Array.isArray(runsData?.runs)
    ? runsData.runs
    : Array.isArray(runsData)
    ? runsData
    : [];

  // Map latest run per workflow name
  const latestRunByName = runs.reduce<Record<string, WorkflowRun>>((acc, run) => {
    if (!acc[run.workflowName] || new Date(run.startedAt) > new Date(acc[run.workflowName].startedAt)) {
      acc[run.workflowName] = run;
    }
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Workflows</h1>
        <p className="text-sm text-zinc-500 mt-1">Configured workflows and run history.</p>
      </div>

      {/* Project-scoped workflows: discovery entry into per-project CRUD/editor */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Workflows by Project
        </h2>
        <ProjectWorkflowsSection />
      </section>

      {/* Workflow definitions */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Available Workflows
        </h2>
        {wfLoading ? (
          <div className="text-xs text-zinc-500 py-6 text-center">Loading…</div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon="⚙️"
            title="No workflows"
            description="No workflows configured. Add workflows to pragents.yaml."
          />
        ) : (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {workflows.map((wf) => (
              <WorkflowDefCard
                key={wf.name}
                wf={wf}
                latestRun={latestRunByName[wf.name]}
              />
            ))}
          </div>
        )}
      </section>

      {/* Run history */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Recent Runs
          <span className="ml-2 text-zinc-600 font-normal normal-case">({runs.length})</span>
        </h2>

        {runsLoading ? (
          <div className="text-xs text-zinc-500 py-6 text-center">Loading…</div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon="▶️"
            title="No runs yet"
            description="Run a workflow to see history here."
          />
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
