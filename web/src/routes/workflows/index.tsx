import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { relativeTime, statusBadge } from '../../lib/badges';

export const Route = createFileRoute('/workflows/')({
  component: WorkflowPage,
});

const API = '';

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function gateLabel(status: string | null): string | null {
  if (!status) return null;
  const map: Record<string, string> = {
    pending: '⏳ Waiting for approval',
    approved: '✅ Approved',
    rejected: '❌ Rejected',
    timed_out: '⏰ Timed out',
    revision_requested: '🔄 Revision requested',
  };
  return map[status] || status;
}

interface Step {
  id: string;
  stepId: string;
  agentId: string | null;
  status: string;
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  gateStatus: string | null;
  gateFeedback: string | null;
}

interface Run {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  steps?: Step[];
}

function StepOutput({ output }: { output: string | null }) {
  const [showFull, setShowFull] = useState(false);
  if (!output) return <span className="text-xs text-gray-400 dark:text-gray-500 italic">No output</span>;

  const preview = output.length > 500 && !showFull ? output.slice(0, 500) + '\n\n… (truncated)' : output;

  return (
    <div>
      <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto bg-gray-50 dark:bg-gray-800 rounded p-2 mt-1 font-mono">
        {preview}
      </pre>
      {output.length > 500 && (
        <button
          onClick={() => setShowFull(!showFull)}
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mt-1"
        >
          {showFull ? 'Show less' : 'Show full output'}
        </button>
      )}
    </div>
  );
}

function RunRow({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false);
  const steps = run.steps || [];
  const hasPendingGate = steps.some(s => s.gateStatus === 'pending' || s.gateStatus === 'revision_requested');

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        className={`bg-white dark:bg-gray-800 rounded-lg border p-4 cursor-pointer hover:shadow-sm transition-shadow ${
          hasPendingGate ? 'border-amber-300 dark:border-amber-600 border-l-4' : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {hasPendingGate && <span className="text-sm flex-shrink-0">⏳</span>}
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{run.workflowName}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">{run.id.slice(0, 8)}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(run.status)}`}>
              {run.status}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 w-16 text-right">{relativeTime(run.startedAt)}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 w-16 text-right font-mono">
              {duration(run.startedAt, run.completedAt)}
            </span>
            <span className="text-xs text-gray-300 dark:text-gray-600">{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="bg-gray-50 dark:bg-gray-900 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-lg ml-4">
          {steps.length === 0 ? (
            <div className="p-4 text-xs text-gray-400 dark:text-gray-500 italic">No steps recorded</div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {steps.map((step, i) => (
                <div key={step.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400 dark:text-gray-500">{i + 1}</span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{step.stepId}</span>
                      {step.gateStatus ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusBadge(step.gateStatus)}`}>
                          {gateLabel(step.gateStatus)}
                        </span>
                      ) : (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusBadge(step.status)}`}>
                          {step.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                      {step.startedAt && <span>{new Date(step.startedAt!).toLocaleTimeString()}</span>}
                      <span className="font-mono">{duration(step.startedAt, step.completedAt)}</span>
                    </div>
                  </div>

                  {step.gateFeedback && (
                    <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                      <span className="font-medium">Feedback:</span> {step.gateFeedback}
                    </div>
                  )}

                  {step.output && <StepOutput output={step.output} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkflowPage() {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => fetch(`${API}/api/v1/workflows`).then(r => r.json()),
  });

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['workflow-runs'],
    queryFn: () => fetch(`${API}/api/v1/workflows/runs?includeSteps=true`).then(r => r.json()),
    refetchInterval: 5000,
  });

  const handleRun = async (name: string) => {
    setSubmitting(name);
    setError(null);
    try {
      await fetch(`${API}/api/v1/workflows/${name}/run`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
    } catch {
      setError(`Failed to start ${name}`);
    } finally {
      setSubmitting(null);
    }
  };

  const workflowList = Array.isArray(workflows) ? workflows : [];
  const runs: Run[] = Array.isArray(runsData) ? runsData : [];

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-bold dark:text-gray-100">Workflows</h2>

      {error && (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-2 rounded-lg text-sm">{error}</div>
      )}

      {/* Trigger section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Available Workflows</h3>
        {workflowList.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm">No workflows configured</p>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {workflowList.map((wf: any) => (
              <div key={wf.name} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex flex-col justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{wf.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{wf.description || 'No description'}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">{wf.steps} steps</div>
                </div>
                <button
                  onClick={() => handleRun(wf.name)}
                  disabled={submitting !== null}
                  className="mt-3 bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {submitting === wf.name ? 'Starting...' : 'Run'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Runs section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
          Recent Runs
          {runs.length > 0 && <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal normal-case">{runs.length}</span>}
        </h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 p-4 animate-pulse">
                <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-50 dark:bg-gray-700 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : runs.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm py-4">No workflow runs yet</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
