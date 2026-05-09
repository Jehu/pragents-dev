import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFeedStore } from '../stores/feed';

const API = '';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    complete: 'bg-green-50 text-green-600',
    failed: 'bg-red-50 text-red-600',
    running: 'bg-blue-50 text-blue-600',
    needs_review: 'bg-amber-50 text-amber-600',
    blocked: 'bg-purple-50 text-purple-600',
    pending: 'bg-gray-100 text-gray-400',
    approved: 'bg-green-50 text-green-600',
    rejected: 'bg-red-50 text-red-600',
    timed_out: 'bg-gray-100 text-gray-400',
  };
  return map[status] || 'bg-gray-100 text-gray-400';
}

function GateCard({ gate, onAction }: { gate: any; onAction: (id: string, action: 'approve' | 'reject') => void }) {
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null); // 'approved' | 'rejected'

  const handle = async (action: 'approve' | 'reject') => {
    setActing(action);
    setError(null);
    try {
      await fetch(`${API}/api/v1/gates/${gate.id}/${action}`, { method: 'POST' });
      setConfirmed(action === 'approve' ? 'approved' : 'rejected');
      setTimeout(() => onAction(gate.id, action), 1200);
    } catch {
      setError(`Failed to ${action} — try again`);
      setActing(null);
    }
  };

  const workflowName = gate.workflowName;
  const previousSteps = gate.previousStepOutputs || [];
  const nextSteps = gate.nextSteps || [];
  const totalSteps = previousSteps.length + 1 + nextSteps.length;
  const gatePosition = previousSteps.length + 1;

  // Consequence labels (aligned with engine: rejection always fails the workflow)
  const approveLabel = nextSteps.length > 0
    ? `Approve — continue to ${nextSteps[0].label || nextSteps[0].stepId}`
    : 'Approve — complete workflow';
  const rejectLabel = 'Reject — workflow fails';

  // Pipeline step status display
  const stepStatusIcon = (status: string) => {
    if (status === 'complete') return '✅';
    if (status === 'failed') return '❌';
    if (status === 'running') return '🔄';
    return '⬜';
  };

  if (confirmed) {
    return (
      <div className="bg-green-50 rounded-lg border border-green-200 p-3 flex items-center gap-2">
        <span className="text-sm">{confirmed === 'approved' ? '✅' : '❌'}</span>
        <span className="text-sm font-medium text-green-700">
          {confirmed === 'approved' ? 'Approved — continuing workflow' : 'Rejected — workflow stopped'}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="bg-white rounded-lg border border-amber-200 p-3 cursor-pointer hover:border-amber-400 transition-colors"
      >
        {/* Row 1: gate label + pending badge */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs flex-shrink-0">⏳</span>
            <span className="text-sm font-medium text-gray-800 truncate">{gate.label}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${statusBadge('pending')}`}>
            pending
          </span>
        </div>

        {/* Row 2: workflow name + step position */}
        <div className="text-xs text-gray-400 mb-1">
          {workflowName
            ? <>Step {gatePosition} of {totalSteps} in <span className="font-medium text-gray-500">{workflowName}</span></>
            : <>Workflow: {gate.workflowRunId?.slice(0, 8)} · Step: {gate.stepId}</>
          }
        </div>

        {/* Row 3: compact approve/reject + timeout */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => handle('approve')}
              disabled={acting !== null}
              className="bg-green-600 text-white px-2.5 py-0.5 rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40"
              aria-describedby={`gate-approve-hint-${gate.id}`}
            >{acting === 'approve' ? '...' : '✓ Approve'}</button>
            <button
              onClick={() => handle('reject')}
              disabled={acting !== null}
              className="bg-red-100 text-red-700 px-2.5 py-0.5 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-40"
              aria-describedby={`gate-reject-hint-${gate.id}`}
            >{acting === 'reject' ? '...' : '✗ Reject'}</button>
          </div>
          {gate.timeoutAt && (
            <span className="text-xs text-amber-500">⏰ {new Date(gate.timeoutAt).toLocaleTimeString()}</span>
          )}
        </div>
        <div className="hidden">
          <span id={`gate-approve-hint-${gate.id}`}>{approveLabel}</span>
          <span id={`gate-reject-hint-${gate.id}`}>{rejectLabel}</span>
        </div>

        {error && (
          <div className="mt-2 text-xs text-red-600">{error}</div>
        )}
      </div>

      {expanded && (
        <div className="bg-gray-50 border border-t-0 border-amber-200 rounded-b-lg p-4 ml-4">
          {/* Pipeline visualization */}
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pipeline</div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {previousSteps.map((s: any) => (
                <div key={s.stepId} className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded whitespace-nowrap" title={s.label || s.stepId}>
                    {stepStatusIcon(s.status)} {s.label || s.stepId}
                  </span>
                  <span className="text-gray-300 text-xs">→</span>
                </div>
              ))}
              <span className="text-xs px-2 py-1 bg-amber-100 text-amber-800 rounded font-medium whitespace-nowrap">
                ⏳ {gate.label}
              </span>
              {nextSteps.map((s: any) => (
                <span key={s.stepId} className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-300 text-xs">→</span>
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded whitespace-nowrap">
                    {s.label || s.stepId}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Previous step outputs */}
          {previousSteps.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Previous Steps</div>
              <div className="space-y-3">
                {previousSteps.map((s: any) => (
                  <div key={s.stepId} className="border border-gray-200 rounded-lg bg-white p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{stepStatusIcon(s.status)}</span>
                        <span className="text-xs font-medium text-gray-700">{s.label || s.stepId}</span>
                        {s.agentId && <span className="text-xs text-gray-400">{s.agentId}</span>}
                      </div>
                      {s.completedAt && (
                        <span className="text-xs text-gray-400">{relativeTime(s.completedAt)}</span>
                      )}
                    </div>
                    {s.output ? (
                      <pre className="text-xs text-gray-600 whitespace-pre-wrap max-h-64 overflow-y-auto bg-gray-50 rounded p-2 mt-1 font-mono">
                        {s.output.length > 3000 ? s.output.slice(0, 3000) + '\n\n… (truncated)' : s.output}
                      </pre>
                    ) : (
                      <div className="text-xs text-gray-400 italic mt-1">No output</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No previous steps */}
          {previousSteps.length === 0 && (
            <div className="mb-4 text-xs text-gray-400 italic">No previous steps to review — this is the first step in the workflow.</div>
          )}

          {/* Next steps */}
          {nextSteps.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">After Approval</div>
              <div className="text-xs text-gray-600">
                {nextSteps.map((s: any, i: number) => (
                  <span key={s.stepId}>
                    {i > 0 && ' → '}
                    <span className="font-medium">{s.label || s.stepId}</span>
                    {s.type === 'human_gate' && ' (gate)'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Consequence labels + full-size action buttons */}
          <div className="border-t border-gray-200 pt-3 mt-3">
            <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => handle('approve')}
                disabled={acting !== null}
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-40 text-center"
              >
                {acting === 'approve' ? 'Approving...' : approveLabel}
              </button>
              <button
                onClick={() => handle('reject')}
                disabled={acting !== null}
                className="flex-1 bg-red-100 text-red-700 px-4 py-2 rounded text-sm font-medium hover:bg-red-200 disabled:opacity-40 text-center"
              >
                {acting === 'reject' ? 'Rejecting...' : rejectLabel}
              </button>
            </div>
            {error && (
              <div className="mt-2 text-xs text-red-600">{error}</div>
            )}
            {gate.timeoutAt && (
              <div className="mt-2 text-xs text-amber-500 text-center">⏰ Timeout: {new Date(gate.timeoutAt).toLocaleTimeString()}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SkillProposalCard({ skill, onAction }: { skill: any; onAction: (name: string, action: 'approve' | 'reject') => void }) {
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handle = async (action: 'approve' | 'reject') => {
    setActing(action);
    try {
      await fetch(`${API}/api/v1/skills/${skill.name}/${action}`, { method: 'POST' });
      onAction(skill.name, action);
    } finally {
      setActing(null);
    }
  };

  const confidence = skill.extractionMetadata?.confidence;
  const confidenceDisplay = confidence != null ? `${Math.round(confidence * 100)}%` : null;
  const confidenceColor = confidence != null
    ? confidence >= 0.8 ? 'text-green-600 bg-green-50' : confidence >= 0.5 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'
    : 'text-gray-400 bg-gray-50';

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        className="bg-white rounded-lg border border-blue-200 p-3 cursor-pointer hover:border-blue-400 transition-colors"
      >
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs flex-shrink-0">🧩</span>
            <span className="text-sm font-medium text-gray-800 truncate">{skill.name}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${confidenceColor}`}>
            {confidenceDisplay || 'new'}
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5">{skill.description || 'No description'}</div>
        <div className="flex gap-3 text-xs text-gray-400 mt-1">
          {skill.tools?.length > 0 && <span>🛠 {skill.tools.join(', ')}</span>}
          <span>{relativeTime(skill.extractedAt)}</span>
        </div>
      </div>

      {expanded && (
        <div className="bg-gray-50 border border-t-0 border-blue-100 rounded-b-lg p-4 ml-4">
          <div className="text-sm text-gray-700 mb-2">{skill.description}</div>
          {skill.tags?.length > 0 && (
            <div className="flex gap-1 mb-2 flex-wrap">
              {skill.tags.map((t: string) => (
                <span key={t} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{t}</span>
              ))}
            </div>
          )}
          {skill.extractedFromSession && (
            <div className="text-xs text-gray-400 mb-2">Session: {skill.extractedFromSession.slice(0, 8)} · Agent: {skill.sourceAgent || 'unknown'}</div>
          )}
          <div className="flex gap-1.5 mt-3">
            <button
              onClick={(e) => { e.stopPropagation(); handle('approve'); }}
              disabled={acting !== null}
              className="bg-green-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40"
            >{acting === 'approve' ? '...' : 'Activate Skill'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); handle('reject'); }}
              disabled={acting !== null}
              className="bg-red-100 text-red-700 px-3 py-1 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-40"
            >{acting === 'reject' ? '...' : 'Reject'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, showUnblock }: { task: any; showUnblock?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const queryClient = useQueryClient();

  const handleUnblock = async () => {
    setUnblocking(true);
    try {
      await fetch(`${API}/api/v1/tasks/${task.id}/unblock`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    } finally {
      setUnblocking(false);
    }
  };

  const icon = task.status === 'needs_review' ? '👀' : task.status === 'blocked' ? '🚫' : '✅';

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        className="bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-blue-200 transition-colors"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs flex-shrink-0">{icon}</span>
            <span className="text-sm font-medium text-gray-800 truncate">{task.description}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${statusBadge(task.status)}`}>
            {task.status}
          </span>
        </div>
        <div className="flex gap-3 text-xs text-gray-400">
          <span>{task.agentId}</span>
          <span>{task.projectId}</span>
          <span>{relativeTime(task.createdAt || task.updatedAt)}</span>
        </div>
        {task.reason && (
          <div className="mt-1 text-xs text-gray-500 truncate max-w-lg">
            {task.reason.length > 120 ? task.reason.slice(0, 120) + '…' : task.reason}
          </div>
        )}
      </div>

      {expanded && (
        <div className="bg-gray-50 border border-t-0 border-gray-200 rounded-b-lg p-4 ml-4">
          <div className="text-sm text-gray-700 mb-2">{task.description}</div>
          {task.reason && (
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium">Reason:</span> {task.reason}
            </div>
          )}
          {task.result && (
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium">Result:</span>{' '}
              <pre className="inline whitespace-pre-wrap">{task.result.slice(0, 500)}</pre>
            </div>
          )}
          <div className="flex gap-3 text-xs text-gray-400 mb-3">
            <span>Agent: {task.agentId}</span>
            <span>Project: {task.projectId}</span>
            <span>Created: {new Date(task.createdAt).toLocaleString()}</span>
          </div>
          {showUnblock && task.status === 'blocked' && (
            <button
              onClick={handleUnblock}
              disabled={unblocking}
              className="bg-purple-600 text-white px-4 py-1.5 rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
            >{unblocking ? 'Unblocking...' : 'Unblock →'}</button>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonGroup({ label, count = 2 }: { label: string; count?: number }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">{label}</h3>
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-100 p-3 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-50 rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeedView() {
  const { filters, setFilter, clearFilters } = useFeedStore();
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (filters.project) params.set('project', filters.project);
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.intent) params.set('intent', filters.intent);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['feed', filters],
    queryFn: () => fetch(`${API}/api/v1/feed?${params.toString()}`).then(r => r.json()),
    refetchInterval: 5000,
  });

  const handleGateAction = () => {
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['gates'] });
  };

  const handleSkillAction = () => {
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['skills'] });
  };

  const feed = data || {};

  const intentOptions = [
    { value: '', label: 'All' },
    { value: 'gates', label: '⏳ Gates' },
    { value: 'review', label: '👀 Review' },
    { value: 'blocked', label: '🚫 Blocked' },
    { value: 'completed', label: '✅ Done' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Feed</h2>
        <div className="flex items-center gap-2">
          {/* Intent filter */}
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {intentOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter('intent', opt.value || undefined)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  (filters.intent || '') === opt.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >{opt.label}</button>
            ))}
          </div>
          {Object.keys(filters).length > 0 && (
            <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {(!filters.intent || filters.intent === 'gates') && <SkeletonGroup label="⏳ Waiting for You" count={2} />}
          {(!filters.intent || filters.intent === 'review') && <SkeletonGroup label="👀 Needs Review" count={2} />}
          {(!filters.intent || filters.intent === 'blocked') && <SkeletonGroup label="🚫 Blocked" count={2} />}
          {(!filters.intent || filters.intent === 'completed') && <SkeletonGroup label="✅ Recently Completed" count={2} />}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending Gates */}
          {(!filters.intent || filters.intent === 'gates') && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                ⏳ Waiting for You
                {feed.gates?.length > 0 && <span className="ml-2 text-amber-500">{feed.gates.length}</span>}
              </h3>
              {!feed.gates?.length ? (
                <p className="text-gray-300 text-sm py-2">No pending approvals</p>
              ) : (
                <div className="space-y-2">
                  {feed.gates.map((g: any) => (
                    <GateCard key={g.id} gate={g} onAction={handleGateAction} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pending Skill Approval */}
          {(!filters.intent || filters.intent === 'gates') && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                🧩 Pending Skill Approval
                {feed.pendingSkills?.length > 0 && <span className="ml-2 text-blue-500">{feed.pendingSkills.length}</span>}
              </h3>
              {!feed.pendingSkills?.length ? (
                <p className="text-gray-300 text-sm py-2">No pending skill proposals</p>
              ) : (
                <div className="space-y-2">
                  {feed.pendingSkills.map((s: any) => (
                    <SkillProposalCard key={s.name} skill={s} onAction={handleSkillAction} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Needs Review */}
          {(!filters.intent || filters.intent === 'review') && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                👀 Needs Review
                {feed.needsReview?.length > 0 && <span className="ml-2 text-amber-500">{feed.needsReview.length}</span>}
              </h3>
              {!feed.needsReview?.length ? (
                <p className="text-gray-300 text-sm py-2">No tasks awaiting review</p>
              ) : (
                <div className="space-y-2">
                  {feed.needsReview.map((t: any) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Blocked */}
          {(!filters.intent || filters.intent === 'blocked') && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                🚫 Blocked
                {feed.blocked?.length > 0 && <span className="ml-2 text-purple-500">{feed.blocked.length}</span>}
              </h3>
              {!feed.blocked?.length ? (
                <p className="text-gray-300 text-sm py-2">No blocked tasks</p>
              ) : (
                <div className="space-y-2">
                  {feed.blocked.map((t: any) => (
                    <TaskCard key={t.id} task={t} showUnblock />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recently Completed */}
          {(!filters.intent || filters.intent === 'completed') && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                ✅ Recently Completed
              </h3>
              {(!feed.completedTasks?.length && !feed.completedGates?.length) ? (
                <p className="text-gray-300 text-sm py-2">No recently completed items</p>
              ) : (
                <div className="space-y-2">
                  {feed.completedTasks?.map((t: any) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                  {feed.completedGates?.map((g: any) => (
                    <div key={g.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
                      <span className="text-xs">🚪</span>
                      <span className="text-sm text-gray-600 flex-1 truncate">{g.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(g.status)}`}>
                        {g.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
