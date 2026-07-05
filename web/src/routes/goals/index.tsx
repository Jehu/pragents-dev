import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Fragment, useState, useEffect } from 'react';
import { Button, StatusPill, EmptyState, ErrorState, LoadingState, PageHeader, Panel, Table, TableWrap, CompanyWideBadge } from '../../components/ui/index.js';
import type { StatusType } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { fetchJson, postJson } from '../../lib/api.js';
import { Modal } from '../../components/Modal.js';
import { GoalForm, buildGoalPayload, type GoalFormValues } from '../../components/GoalForm.js';
import * as YAML from 'yaml';

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
  acceptance?: string[];
  nextTriggerAt?: string | null;
  nextDeadlineAt?: string | null;
  status?: string;
  createdAt?: string;
}

export interface GoalRun {
  id: string;
  goalId: string;
  workflowRunId?: string | null;
  triggeredAt: string;
  completedAt?: string | null;
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

export function relativeFutureTime(ts: string | null | undefined): string {
  if (!ts) return 'not scheduled';
  const ms = new Date(ts).getTime();
  if (Number.isNaN(ms)) return ts;
  const diff = ms - Date.now();
  if (diff <= 0) return 'due now';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

const STATUS_PILL_MAP: Record<string, StatusType> = {
  triggered: 'running',
  running: 'running',
  complete: 'complete',
  failed: 'failed',
  escalated: 'busy',
  pending: 'idle',
};

function toStatusPill(s: string): StatusType {
  return STATUS_PILL_MAP[s] ?? 'idle';
}

// ─── Goal Table ───────────────────────────────────────────────────────────────

function GoalTable({
  goals,
  runs,
  knownWorkflows,
  workflowRefs,
  onEdit,
  onDelete,
}: {
  goals: Goal[];
  runs: GoalRun[];
  knownWorkflows: Set<string> | null;
  workflowRefs?: Map<string, string | null> | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [runError, setRunError] = useState<Record<string, string>>({});
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  const runMutation = useMutation({
    mutationFn: async (id: string) => {
      return postJson(`/api/v1/goals/${encodeURIComponent(id)}/run`);
    },
    onSuccess: (_data, id) => {
      setRunError((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['goal-runs'] });
      // Scroll to Recent Runs section so the user sees the new entry.
      requestAnimationFrame(() => {
        document.getElementById('goals-recent-runs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    onError: (err: unknown, id) => {
      setRunError((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Failed' }));
    },
  });

  if (goals.length === 0) {
    return (
      <EmptyState
        icon="Goals"
        title="No goals"
        description="No scheduled goals found. Add YAML files under goals/*.yaml."
      />
    );
  }

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="py-2 pr-4 font-medium">Goal</th>
            <th className="py-2 pr-4 font-medium">Outcome</th>
            <th className="py-2 pr-4 font-medium">Schedule</th>
            <th className="py-2 pr-4 font-medium">Target</th>
            <th className="py-2 pr-4 font-medium">Deadline</th>
            <th className="py-2 pr-4 font-medium w-24"></th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => {
            const isPending = runMutation.isPending && runMutation.variables === g.id;
            const goalRuns = runs.filter((run) => run.goalId === g.id);
            const activeRun = goalRuns.find((run) => run.status === 'running' || run.status === 'triggered' || run.status === 'pending');
            const latestRun = goalRuns[0];
            return (
              <Fragment key={g.id}>
              <tr key={g.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                <td className="py-2.5 pr-4 align-top">
                  <span className="font-mono text-xs text-zinc-400">{g.id}</span>
                  <div className="mt-1">
                    <StatusPill status={activeRun ? 'running' : latestRun ? toStatusPill(latestRun.status) : 'idle'} />
                  </div>
                </td>
                <td className="py-2.5 pr-4 align-top">
                  <span className="text-zinc-200">{g.description}</span>
                  {g.acceptance && g.acceptance.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {g.acceptance.map((item) => (
                        <li key={item} className="text-[11px] text-zinc-400">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2.5 pr-4 align-top">
                  <span className="font-mono text-xs text-zinc-300 block">{g.cadence ?? g.cron}</span>
                  <span className="text-[11px] text-zinc-500">{parseCron(g.cadence ?? g.cron ?? '')}</span>
                  <span className="mt-1 block text-[11px] text-zinc-400">
                    Next trigger {relativeFutureTime(g.nextTriggerAt)}
                  </span>
                </td>
                <td className="py-2.5 pr-4 align-top">
                  <span className="text-xs text-zinc-400">
                    {g.targetAgentId ?? g.targetWorkflowId ?? g.workflow ?? '—'}
                  </span>
                  {(() => {
                    const wfName = g.targetWorkflowId ?? g.workflow;
                    if (!wfName) return null;
                    // knownWorkflows === null means the registry has not loaded — don't warn on unknown state.
                    const missing = knownWorkflows !== null && !knownWorkflows.has(wfName);
                    return missing ? (
                      <div
                        className="mt-1 text-[11px] text-amber-300"
                        title={`No workflow named "${wfName}" is registered. Runs of this goal will fail until the workflow YAML exists.`}
                      >
                        ⚠ workflow missing
                      </div>
                    ) : (
                      (() => {
                        // Link straight to the workflow this goal drives.
                        // Project workflows open their editor; global/repo
                        // workflows (no projectId) go to the Workflows list.
                        const projectId = workflowRefs?.get(wfName) ?? null;
                        return projectId ? (
                          <Link
                            to="/projects/$projectId/workflows/$workflowName"
                            params={{ projectId, workflowName: wfName }}
                            className="mt-1 inline-block text-[11px] text-indigo-400 hover:text-indigo-300 no-underline hover:underline"
                          >
                            open workflow →
                          </Link>
                        ) : (
                          <Link
                            to="/workflows"
                            className="mt-1 inline-block text-[11px] text-indigo-400 hover:text-indigo-300 no-underline hover:underline"
                          >
                            open workflow →
                          </Link>
                        );
                      })()
                    );
                  })()}
                </td>
                <td className="py-2.5 pr-4 align-top">
                  <span className="text-xs text-zinc-400">
                    {g.deadline
                      ? (() => {
                          const ms = new Date(g.deadline).getTime();
                          return isNaN(ms) ? parseCron(g.deadline) : relativeTimeMs(ms);
                        })()
                      : '—'}
                  </span>
                  {g.nextDeadlineAt && (
                    <span className="mt-1 block text-[11px] text-zinc-500">
                      {relativeFutureTime(g.nextDeadlineAt)}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-4 align-top text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <Button
                      variant="primary"
                      type="button"
                      onClick={() => runMutation.mutate(g.id)}
                      disabled={Boolean(activeRun)}
                      loading={isPending}
                      title={activeRun ? 'This goal already has an active run' : undefined}
                    >
                      {activeRun ? 'Running' : 'Run now'}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setExpandedGoal((current) => current === g.id ? null : g.id)}
                    >
                      Details
                    </Button>
                    <Button variant="ghost" type="button" onClick={() => onEdit(g.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" type="button" onClick={() => onDelete(g.id)}>
                      Delete
                    </Button>
                  </div>
                  {runError[g.id] && (
                    <p className="text-[11px] text-red-400 mt-1">{runError[g.id]}</p>
                  )}
                </td>
              </tr>
              {expandedGoal === g.id && (
                <tr key={`${g.id}-details`} className="border-b border-zinc-800/50">
                  <td colSpan={6} className="py-3 pr-4">
                    <Panel className="p-3 bg-zinc-950">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Acceptance</h3>
                          {g.acceptance && g.acceptance.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                              {g.acceptance.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-zinc-600">No acceptance criteria recorded.</p>
                          )}
                        </div>
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Management</h3>
                          <p className="mt-2 text-xs text-zinc-400">
                            Edit the source YAML in <span className="font-mono text-zinc-300">goals/{g.id}.yaml</span>. A safe in-app goal editor is not available yet.
                          </p>
                        </div>
                      </div>
                      <div className="mt-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Recent runs for this goal</h3>
                        {goalRuns.length === 0 ? (
                          <p className="mt-2 text-xs text-zinc-600">No runs recorded.</p>
                        ) : (
                          <div className="mt-2 space-y-1">
                            {goalRuns.slice(0, 5).map((run) => (
                              <div key={run.id} className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                                {/* Scoped to one goal already — show a short run
                                    id (full id on hover) instead of a full UUID. */}
                                <span className="font-mono text-zinc-300" title={`Run ${run.id}`}>
                                  {run.id.slice(0, 8)}
                                </span>
                                <StatusPill status={toStatusPill(run.status)} />
                                <span>{relativeTimeMs(new Date(run.triggeredAt).getTime())}</span>
                                {run.workflowRunId && (
                                  <span
                                    className="font-mono text-[10px] text-zinc-600"
                                    title={`Workflow-Run ${run.workflowRunId}`}
                                  >
                                    run {run.workflowRunId.slice(0, 8)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Panel>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

// ─── Goal Runs ────────────────────────────────────────────────────────────────

function GoalRunList({ runs }: { runs: GoalRun[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (runs.length === 0) {
    return (
      <EmptyState
        icon="Runs"
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
              {/* Goal name is the readable identifier; the raw run UUID moves
                  to a hover tooltip so the row isn't a wall of hex. */}
              <span
                className="text-xs font-medium text-zinc-200 truncate"
                title={`Run ${run.id}`}
              >
                {run.goalId}
              </span>
              <span className="text-xs text-zinc-500 flex-shrink-0">
                {relativeTimeMs(new Date(run.triggeredAt).getTime())}
              </span>
              {run.workflowRunId && (
                <span
                  className="font-mono text-[10px] text-zinc-500 flex-shrink-0"
                  title={`Workflow-Run ${run.workflowRunId}`}
                >
                  run {run.workflowRunId.slice(0, 8)}
                </span>
              )}
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

  const { data: goalsData, isLoading: goalsLoading, error: goalsError, refetch: refetchGoals } = useQuery({
    queryKey: ['goals'],
    queryFn: () => fetchJson<{ goals?: Goal[] } | Goal[]>('/api/v1/goals'),
    staleTime: 15_000,
  });

  const { data: runsData, isLoading: runsLoading, error: runsError, refetch: refetchRuns } = useQuery({
    queryKey: ['goal-runs'],
    queryFn: () => fetchJson<{ runs?: GoalRun[] } | GoalRun[]>('/api/v1/goals/runs'),
    staleTime: 15_000,
  });

  // Workflow registry — used to flag goals whose linked workflow no longer exists.
  const { data: workflowsData } = useQuery({
    queryKey: ['workflows'],
    queryFn: () =>
      fetchJson<
        | { workflows?: Array<{ name: string; projectId?: string | null }> }
        | Array<{ name: string; projectId?: string | null }>
      >('/api/v1/workflows'),
    staleTime: 15_000,
  });

  const goals: Goal[] = !Array.isArray(goalsData) && Array.isArray(goalsData?.goals)
    ? goalsData.goals
    : Array.isArray(goalsData)
    ? goalsData
    : [];
  const runs: GoalRun[] = !Array.isArray(runsData) && Array.isArray(runsData?.runs)
    ? runsData.runs
    : Array.isArray(runsData)
    ? runsData
    : [];
  const workflowList = workflowsData
    ? Array.isArray(workflowsData)
      ? workflowsData
      : workflowsData.workflows ?? []
    : [];
  const knownWorkflowNames = workflowList.map((w) => w.name);
  // name → projectId (null for global/repo workflows). Lets the goal's
  // Target cell link straight to the workflow the goal drives.
  const workflowRefs = workflowsData
    ? new Map(workflowList.map((w) => [w.name, w.projectId ?? null]))
    : null;

  // ── Goal CRUD state ──
  const [editor, setEditor] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; id: string; etag: string; initial: GoalFormValues }
    | null
  >(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [crudError, setCrudError] = useState<string | null>(null);

  const invalidateGoals = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
    void queryClient.invalidateQueries({ queryKey: ['goal-runs'] });
  };

  /** Surface server errors incl. Zod issues in a readable form. */
  const readError = async (res: Response): Promise<string> => {
    const body = await res.json().catch(() => ({} as any));
    const issues = Array.isArray(body.issues)
      ? '\n' + body.issues.map((i: any) => `• ${i.path?.join('.') ?? ''}: ${i.message}`).join('\n')
      : '';
    return `${body.error ?? `Request failed (${res.status})`}${issues}`;
  };

  const saveMutation = useMutation({
    mutationFn: async (values: GoalFormValues) => {
      const content = YAML.stringify(buildGoalPayload(values));
      const res =
        editor?.mode === 'edit'
          ? await fetch(`/api/v1/goals/${encodeURIComponent(editor.id)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json', 'If-Match': editor.etag },
              body: JSON.stringify({ content }),
            })
          : await fetch('/api/v1/goals', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ content }),
            });
      if (!res.ok) {
        if (res.status === 412) throw new Error('Goal changed on disk — close the editor and retry.');
        throw new Error(await readError(res));
      }
      return res.json();
    },
    onSuccess: () => {
      setEditor(null);
      setCrudError(null);
      invalidateGoals();
    },
    onError: (err: unknown) => setCrudError(err instanceof Error ? err.message : 'Save failed'),
  });

  const openEdit = async (id: string) => {
    setCrudError(null);
    try {
      const raw = await fetchJson<{ id: string; content: string; etag: string }>(
        `/api/v1/goals/${encodeURIComponent(id)}/raw`,
      );
      const parsed = (YAML.parse(raw.content) ?? {}) as Record<string, any>;
      setEditor({
        mode: 'edit',
        id,
        etag: raw.etag,
        initial: {
          id: parsed.id ?? id,
          description: parsed.description ?? '',
          cadence: parsed.cadence ?? '',
          deadline: parsed.deadline ?? '',
          workflow: parsed.workflow ?? '',
          acceptance: Array.isArray(parsed.acceptance) ? parsed.acceptance : [],
        },
      });
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Failed to load goal');
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Fresh etag directly before delete — the confirm dialog may sit open a while.
      const raw = await fetchJson<{ etag: string }>(`/api/v1/goals/${encodeURIComponent(id)}/raw`);
      const res = await fetch(`/api/v1/goals/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'If-Match': raw.etag },
      });
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    onSuccess: () => {
      setDeleting(null);
      setCrudError(null);
      invalidateGoals();
    },
    onError: (err: unknown) => {
      setCrudError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(null);
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <PageHeader
        title="Goals"
        description="Managed outcomes, active status, and run history from goals/*.yaml."
        actions={
          <>
            <CompanyWideBadge />
            <button
              className="btn-approve text-xs px-3 py-1.5 rounded font-medium"
              onClick={() => {
                setCrudError(null);
                setEditor({ mode: 'create' });
              }}
            >
              + New goal
            </button>
          </>
        }
      />

      {crudError && !editor && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 whitespace-pre-wrap">
          {crudError}
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Scheduled Goals
        </h2>
        {goalsError ? (
          <ErrorState title="Goals failed to load" error={goalsError} onRetry={() => void refetchGoals()} />
        ) : goalsLoading ? (
          <LoadingState label="Loading goals" />
        ) : (
          <GoalTable
            goals={goals}
            runs={runs}
            knownWorkflows={workflowsData ? new Set(knownWorkflowNames) : null}
            workflowRefs={workflowRefs}
            onEdit={(id) => void openEdit(id)}
            onDelete={(id) => {
              setCrudError(null);
              setDeleting(id);
            }}
          />
        )}
      </section>

      {editor && (
        <Modal
          open
          onClose={() => setEditor(null)}
          ariaLabel={editor.mode === 'create' ? 'New goal' : `Edit goal ${editor.id}`}
        >
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">
              {editor.mode === 'create' ? 'New goal' : `Edit ${editor.id}`}
            </h3>
          </div>
          <GoalForm
            initialValues={editor.mode === 'edit' ? editor.initial : undefined}
            editMode={editor.mode === 'edit'}
            knownWorkflows={knownWorkflowNames}
            busy={saveMutation.isPending}
            serverError={crudError}
            onCancel={() => setEditor(null)}
            onSubmit={(values) => saveMutation.mutate(values)}
            submitLabel={editor.mode === 'create' ? 'Create goal' : 'Save'}
          />
        </Modal>
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} ariaLabel={`Delete goal ${deleting}`}>
          <div className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-100">Delete goal "{deleting}"?</h3>
            <p className="text-xs text-zinc-400">
              The YAML file is removed and the schedule stops. Past run history is kept.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="text-xs px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                className="text-xs px-3 py-1.5 rounded font-medium bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-50"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleting)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <section id="goals-recent-runs">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Recent Runs
          <span className="ml-2 text-zinc-600 font-normal normal-case">({runs.length})</span>
        </h2>
        {runsError ? (
          <ErrorState title="Goal runs failed to load" error={runsError} onRetry={() => void refetchRuns()} />
        ) : runsLoading ? (
          <LoadingState label="Loading goal runs" />
        ) : (
          <GoalRunList runs={runs} />
        )}
      </section>
    </div>
  );
}
