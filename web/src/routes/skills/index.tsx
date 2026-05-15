import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { EmptyState } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';

export const Route = createFileRoute('/skills/')({
  validateSearch: (search: Record<string, unknown>) => ({
    name: typeof search.name === 'string' ? search.name : undefined,
  }),
  component: SkillsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  status: 'active' | 'proposed' | 'rejected';
  description?: string;
  tags?: string[];
  scope?: string;
  version?: string;
  sourceAgent?: string;
  extractedAt?: string;
  usageCount?: number;
  lastUsedAt?: string;
  rejectCount?: number;
  rejectReason?: string;
  createdAt: string;
  /** 'registry' = managed via approve/reject; 'config' = declared in pragents.yaml, read-only here */
  source?: 'registry' | 'config';
}

export type SkillTab = 'active' | 'proposed' | 'rejected';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTimeMs(tsMs: number): string {
  const s = Math.floor((Date.now() - tsMs) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function countSkillsByTab(skills: Skill[], tab: SkillTab): number {
  return skills.filter((s) => s.status === tab).length;
}

// ─── Badge / Tag ──────────────────────────────────────────────────────────────

function TagPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
      {label}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  return (
    <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
      {scope}
    </span>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

interface RejectModalProps {
  skillName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
}

function RejectModal({ skillName, onClose, onConfirm, isLoading }: RejectModalProps) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-sm mx-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-zinc-100 mb-1">Reject skill</h3>
        <p className="text-xs text-zinc-500 mb-3 font-mono">{skillName}</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional reason…"
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
        />
        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-40"
          >
            {isLoading ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Body Modal ───────────────────────────────────────────────────────────────

interface BodyModalProps {
  skillName: string;
  onClose: () => void;
}

function BodyModal({ skillName, onClose }: BodyModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['skill-body', skillName],
    queryFn: () => fetch(`/api/v1/skills/${encodeURIComponent(skillName)}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  const body: string = data?.body ?? data?.content ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-100 font-mono">{skillName}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="text-xs text-zinc-500 py-4 text-center">Loading…</div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap text-zinc-300 font-mono">{body || '(empty)'}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skill Cards ──────────────────────────────────────────────────────────────

function ActiveSkillCard({ skill }: { skill: Skill }) {
  const isConfig = skill.source === 'config';
  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-zinc-100">{skill.name}</span>
            {skill.version && (
              <span className="text-[10px] text-zinc-600">v{skill.version}</span>
            )}
            {skill.scope && <ScopeBadge scope={skill.scope} />}
            {isConfig && (
              <span
                className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700"
                title="Declared in pragents.yaml and cannot be approved or rejected here."
              >
                from pragents.yaml
              </span>
            )}
          </div>
          {skill.description && (
            <p className="text-xs text-zinc-500 mt-1">{skill.description}</p>
          )}
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {skill.tags.map((t) => <TagPill key={t} label={t} />)}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0 space-y-1">
          {skill.usageCount !== undefined && (
            <div className="text-[11px] text-zinc-500">used {skill.usageCount}×</div>
          )}
          {skill.lastUsedAt && (
            <div className="text-[11px] text-zinc-600">
              {relativeTimeMs(new Date(skill.lastUsedAt).getTime())}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProposedSkillCardProps {
  skill: Skill;
  onApprove: (name: string) => void;
  onReject: (name: string) => void;
  onViewBody: (name: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}

function ProposedSkillCard({ skill, onApprove, onReject, onViewBody, isApproving, isRejecting }: ProposedSkillCardProps) {
  const busy = isApproving || isRejecting;
  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-zinc-100">{skill.name}</span>
            {skill.scope && <ScopeBadge scope={skill.scope} />}
          </div>
          {skill.description && (
            <p className="text-xs text-zinc-500 mt-1">{skill.description}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-1.5 text-[11px] text-zinc-500">
            {skill.sourceAgent && <span>agent: <span className="font-mono">{skill.sourceAgent}</span></span>}
            {skill.extractedAt && <span>extracted {relativeTimeMs(new Date(skill.extractedAt).getTime())}</span>}
          </div>
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {skill.tags.map((t) => <TagPill key={t} label={t} />)}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={() => onViewBody(skill.name)}
            className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            View body
          </button>
          <Link
            to="/skills/$skillName"
            params={{ skillName: skill.name }}
            search={{ bucket: 'quarantine' as const }}
            className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 no-underline"
          >
            Edit
          </Link>
          <button
            onClick={() => onReject(skill.name)}
            disabled={busy}
            className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
          >
            Reject
          </button>
          <button
            onClick={() => onApprove(skill.name)}
            disabled={busy}
            className="text-xs px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium disabled:opacity-40"
          >
            {isApproving ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectedSkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3.5 opacity-80">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-zinc-400 line-through">{skill.name}</span>
            {skill.scope && <ScopeBadge scope={skill.scope} />}
          </div>
          {skill.description && (
            <p className="text-xs text-zinc-600 mt-1">{skill.description}</p>
          )}
          {skill.rejectReason && (
            <p className="text-[11px] text-red-500/70 mt-1.5">Reason: {skill.rejectReason}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          {skill.rejectCount !== undefined && skill.rejectCount > 0 && (
            <span className="text-[11px] text-zinc-600">rejected {skill.rejectCount}×</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function SkillsPage() {
  const queryClient = useQueryClient();
  // Read the route search; fall back to window.location when rendered outside
  // a router context (e.g. in unit tests that mount the component directly).
  let nameFilter = '';
  try {
    const search = Route.useSearch();
    nameFilter = search.name?.toLowerCase() ?? '';
  } catch {
    if (typeof window !== 'undefined') {
      nameFilter = new URLSearchParams(window.location.search).get('name')?.toLowerCase() ?? '';
    }
  }
  const [activeTab, setActiveTab] = useState<SkillTab>('active');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [bodyTarget, setBodyTarget] = useState<string | null>(null);
  const [optimisticApproved, setOptimisticApproved] = useState<Set<string>>(new Set());
  const [optimisticRejected, setOptimisticRejected] = useState<Set<string>>(new Set());

  const busEvents = useEventBusStore((s) => s.events);
  useEffect(() => {
    const latest = busEvents[busEvents.length - 1];
    if (latest && typeof latest.type === 'string' && latest.type.startsWith('skill.')) {
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    }
  }, [busEvents, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => fetch('/api/v1/skills').then((r) => r.json()),
    staleTime: 15_000,
  });

  const rawSkills: Skill[] = Array.isArray(data?.skills)
    ? data.skills
    : Array.isArray(data)
    ? data
    : [];
  const allSkills: Skill[] = nameFilter
    ? rawSkills.filter((s) => s.name.toLowerCase().includes(nameFilter))
    : rawSkills;

  const approveMutation = useMutation({
    mutationFn: (name: string) =>
      fetch(`/api/v1/skills/${encodeURIComponent(name)}/approve`, { method: 'POST' }),
    onMutate: (name) => {
      setOptimisticApproved((prev) => new Set([...prev, name]));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
    onError: (_err, name) => {
      setOptimisticApproved((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ name, reason }: { name: string; reason?: string }) =>
      fetch(`/api/v1/skills/${encodeURIComponent(name)}/reject`, {
        method: 'POST',
        headers: reason ? { 'Content-Type': 'application/json' } : {},
        body: reason ? JSON.stringify({ reason }) : undefined,
      }),
    onMutate: ({ name }) => {
      setOptimisticRejected((prev) => new Set([...prev, name]));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
      setRejectTarget(null);
    },
    onError: (_err, { name }) => {
      setOptimisticRejected((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    },
  });

  // Filter out optimistically moved skills from proposed tab
  const visibleSkills = allSkills.filter((s) => {
    if (s.status === 'proposed') {
      if (optimisticApproved.has(s.name) || optimisticRejected.has(s.name)) return false;
    }
    return true;
  });

  const tabs: SkillTab[] = ['active', 'proposed', 'rejected'];
  const tabCounts: Record<SkillTab, number> = {
    active: visibleSkills.filter((s) => s.status === 'active').length,
    proposed: visibleSkills.filter((s) => s.status === 'proposed').length,
    rejected: visibleSkills.filter((s) => s.status === 'rejected').length,
  };

  const filtered = visibleSkills.filter((s) => s.status === activeTab);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Skills</h1>
        <p className="text-sm text-zinc-500 mt-1">Skill library and proposal review.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-zinc-300 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className={`ml-1.5 text-[11px] ${activeTab === tab ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {tabCounts[tab]}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-xs text-zinc-500 py-12 text-center">Loading…</div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            activeTab === 'proposed' ? (
              <EmptyState
                icon="🔬"
                title="No proposed skills"
                description="No proposed skills — auto-extraction runs when agents complete tasks."
              />
            ) : (
              <EmptyState
                icon="📚"
                title={`No ${activeTab} skills`}
                description={`No ${activeTab} skills found.`}
              />
            )
          ) : (
            filtered.map((skill) => {
              if (activeTab === 'active') {
                return <ActiveSkillCard key={skill.name} skill={skill} />;
              }
              if (activeTab === 'proposed') {
                return (
                  <ProposedSkillCard
                    key={skill.name}
                    skill={skill}
                    onApprove={(name) => approveMutation.mutate(name)}
                    onReject={(name) => setRejectTarget(name)}
                    onViewBody={(name) => setBodyTarget(name)}
                    isApproving={approveMutation.isPending && approveMutation.variables === skill.name}
                    isRejecting={rejectMutation.isPending && rejectMutation.variables?.name === skill.name}
                  />
                );
              }
              return <RejectedSkillCard key={skill.name} skill={skill} />;
            })
          )}
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          skillName={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={(reason) => rejectMutation.mutate({ name: rejectTarget, reason: reason || undefined })}
          isLoading={rejectMutation.isPending}
        />
      )}

      {/* Body modal */}
      {bodyTarget && (
        <BodyModal skillName={bodyTarget} onClose={() => setBodyTarget(null)} />
      )}
    </div>
  );
}
