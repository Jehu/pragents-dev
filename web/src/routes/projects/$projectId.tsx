import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Modal } from '../../components/Modal.js';
import {
  ProjectForm,
  type ProjectFormValues,
} from '../../components/ProjectForm.js';
import {
  AgentForm,
  AGENT_TYPES,
  buildAgentPayload,
  type AgentFormValues,
  type ProjectAgentType,
} from '../../components/AgentForm.js';
import { DeleteProjectModal } from '../../components/DeleteProjectModal.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { useEtagFetch } from '../../hooks/useEtagFetch.js';

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailPage,
});

interface ProjectDetail {
  id: string;
  name: string;
  directory: string;
  agents: Partial<Record<ProjectAgentType, RawAgent>>;
}

interface RawAgent {
  type: ProjectAgentType;
  role?: 'fast' | 'standard';
  model?: string;
  personality?: string;
  capabilities?: string[];
  memory?: {
    company?: 'read' | 'read/write';
    project?: 'read' | 'read/write';
    projects?: { all?: 'read' };
  };
  tokenBudget?: number;
  keepWarm?: boolean;
}

export function toAgentFormValues(
  raw: RawAgent | undefined,
  type: ProjectAgentType,
): AgentFormValues {
  return {
    type: raw?.type ?? type,
    role: raw?.role,
    model: raw?.model ?? '',
    personality: raw?.personality ?? '',
    capabilities: raw?.capabilities ?? [],
    memory: {
      company: raw?.memory?.company ?? 'none',
      project: raw?.memory?.project ?? 'none',
      projectsAll: raw?.memory?.projects?.all ?? 'none',
    },
    tokenBudget: raw?.tokenBudget,
    keepWarm: raw?.keepWarm ?? false,
  };
}

type SubTab = 'agents' | 'workflows';

interface AgentEditState {
  type: ProjectAgentType;
  isNew: boolean;
}

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const readUrl = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  const { data, etag, refetch, loading, error } = useEtagFetch<ProjectDetail>(readUrl);

  const [tab, setTab] = useState<SubTab>('agents');
  const [editingProject, setEditingProject] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [agentEdit, setAgentEdit] = useState<AgentEditState | null>(null);
  const [agentDelete, setAgentDelete] = useState<ProjectAgentType | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When the server returns 412, we capture both sides for ConflictDialog
  // instead of bubbling a generic error toast (R12 / AE1).
  const [conflictState, setConflictState] = useState<{
    localContent: string;
    remoteContent: string;
  } | null>(null);

  // Fetch the current on-disk JSON to show in the ConflictDialog. Returns
  // a pretty-printed string or an empty placeholder if the fetch itself
  // fails — we don't want a secondary error to mask the conflict UX.
  async function fetchRemoteForDiff(): Promise<string> {
    try {
      const remote = await fetch(readUrl);
      if (!remote.ok) return '(failed to load current server state)';
      const remoteJson = await remote.json();
      return JSON.stringify(remoteJson, null, 2);
    } catch {
      return '(failed to load current server state)';
    }
  }

  const configuredTypes: ProjectAgentType[] = useMemo(() => {
    if (!data) return [];
    return AGENT_TYPES.filter((t) => !!data.agents?.[t]);
  }, [data]);

  async function refresh() {
    refetch();
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['agents'] });
  }

  async function performDelete() {
    const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers: etag ? { 'If-Match': etag } : {},
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* no body */
    }
    return {
      ok: res.ok,
      status: res.status,
      activeAgents: body?.activeAgents as string[] | undefined,
      error: body?.error as string | undefined,
    };
  }

  async function saveProject(values: ProjectFormValues) {
    if (!data) return;
    setBusy(true);
    setMutationError(null);
    try {
      const body = {
        name: values.name,
        directory: values.directory,
        agents: data.agents ?? {},
      };
      const res = await fetch(readUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: JSON.stringify(body),
      });
      if (res.status === 412) {
        const remoteContent = await fetchRemoteForDiff();
        setConflictState({
          localContent: JSON.stringify(body, null, 2),
          remoteContent,
        });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setEditingProject(false);
      await refresh();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveAgent(values: AgentFormValues, isNew: boolean) {
    setBusy(true);
    setMutationError(null);
    try {
      const payload = buildAgentPayload(values);
      let res: Response;
      if (isNew) {
        res = await fetch(`${readUrl}/agents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(etag ? { 'If-Match': etag } : {}),
          },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(
          `${readUrl}/agents/${encodeURIComponent(values.type)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(etag ? { 'If-Match': etag } : {}),
            },
            body: JSON.stringify(payload),
          },
        );
      }
      if (res.status === 412) {
        const remoteContent = await fetchRemoteForDiff();
        setConflictState({
          localContent: JSON.stringify(payload, null, 2),
          remoteContent,
        });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setAgentEdit(null);
      await refresh();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAgent(type: ProjectAgentType) {
    setBusy(true);
    setMutationError(null);
    try {
      const res = await fetch(
        `${readUrl}/agents/${encodeURIComponent(type)}`,
        {
          method: 'DELETE',
          headers: etag ? { 'If-Match': etag } : {},
        },
      );
      if (res.status === 412) {
        const remoteContent = await fetchRemoteForDiff();
        setConflictState({
          localContent: `(delete agent "${type}")`,
          remoteContent,
        });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setAgentDelete(null);
      await refresh();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-xs text-zinc-500">Loading…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-6 text-xs text-red-400" role="alert">
        Failed to load project: {error ? String(error.message) : 'not found'}{' '}
        <Link to="/projects" className="underline">
          back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <Link to="/projects" className="text-[11px] text-zinc-500 hover:text-zinc-300 no-underline">
            ← Projects
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100 mt-1">
            {data.name || data.id}
          </h1>
          <p className="text-xs text-zinc-500 font-mono mt-0.5">{data.id}</p>
          <p className="text-xs text-zinc-500 font-mono mt-1">{data.directory}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setEditingProject(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
          >
            Edit project
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900 text-zinc-200 hover:text-red-200"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {(['agents', 'workflows'] as SubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-zinc-300 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {mutationError && (
        <div
          role="alert"
          className="mb-4 bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
        >
          {mutationError}
        </div>
      )}

      {tab === 'agents' && (
        <div className="space-y-3" data-testid="agents-tab">
          {AGENT_TYPES.map((type) => {
            const agent = data.agents?.[type];
            const configured = !!agent;
            return (
              <div
                key={type}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
                data-testid={`agent-slot-${type}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100 font-mono">
                      {type}
                    </div>
                    {configured ? (
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {agent?.model || '(no model)'} ·{' '}
                        {(agent?.capabilities?.length ?? 0)} capabilities
                        {agent?.keepWarm ? ' · keep-warm' : ''}
                      </div>
                    ) : (
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Not configured
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {configured ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setAgentEdit({ type, isNew: false })}
                          className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setAgentDelete(type)}
                          className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAgentEdit({ type, isNew: true })}
                        className="text-[11px] px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium"
                      >
                        Add
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'workflows' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-xs text-zinc-400">
            Workflow files live under{' '}
            <span className="font-mono">&lt;projectDir&gt;/workflows/</span>.
          </p>
          <Link
            to="/projects/$projectId/workflows"
            params={{ projectId: data.id }}
            className="inline-block mt-3 text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium no-underline"
          >
            Open workflows
          </Link>
        </div>
      )}

      {/* Edit project modal */}
      {editingProject && (
        <Modal
          open={editingProject}
          onClose={() => setEditingProject(false)}
          ariaLabel="Edit project"
        >
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Edit project</h3>
          </div>
          <ProjectForm
            initialValues={{
              id: data.id,
              name: data.name,
              directory: data.directory,
            }}
            editMode
            onCancel={() => setEditingProject(false)}
            onSubmit={saveProject}
            busy={busy}
            submitLabel="Save"
          />
        </Modal>
      )}

      {/* Agent modal */}
      {agentEdit && (
        <Modal
          open={!!agentEdit}
          onClose={() => setAgentEdit(null)}
          ariaLabel={`${agentEdit.isNew ? 'Add' : 'Edit'} agent`}
        >
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">
              {agentEdit.isNew ? 'Add agent' : `Edit ${agentEdit.type} agent`}
            </h3>
          </div>
          <AgentForm
            initialValues={
              agentEdit.isNew
                ? { type: agentEdit.type }
                : toAgentFormValues(data.agents?.[agentEdit.type], agentEdit.type)
            }
            editMode={!agentEdit.isNew}
            defaultType={agentEdit.type}
            takenTypes={agentEdit.isNew ? configuredTypes : []}
            onCancel={() => setAgentEdit(null)}
            onSubmit={(v) => saveAgent(v, agentEdit.isNew)}
            busy={busy}
            submitLabel={agentEdit.isNew ? 'Add agent' : 'Save'}
          />
        </Modal>
      )}

      {/* Agent delete confirm */}
      {agentDelete && (
        <Modal
          open={!!agentDelete}
          onClose={() => setAgentDelete(null)}
          ariaLabel={`Remove ${agentDelete} agent`}
        >
          <div className="px-5 py-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Remove agent</h3>
          </div>
          <div className="p-5 text-sm text-zinc-300">
            Remove the <span className="font-mono">{agentDelete}</span> agent
            from this project?
          </div>
          <div className="border-t border-zinc-800 px-5 py-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setAgentDelete(null)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteAgent(agentDelete)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium disabled:opacity-40"
            >
              {busy ? 'Removing…' : 'Remove agent'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <DeleteProjectModal
          open={deleting}
          projectId={data.id}
          projectName={data.name || data.id}
          configuredAgents={configuredTypes}
          onDelete={performDelete}
          onClose={() => setDeleting(false)}
          onSuccess={async () => {
            setDeleting(false);
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            navigate({ to: '/projects' });
          }}
        />
      )}

      {conflictState && (
        <ConflictDialog
          open
          localContent={conflictState.localContent}
          remoteContent={conflictState.remoteContent}
          onDiscard={async () => {
            setConflictState(null);
            setEditingProject(false);
            setAgentEdit(null);
            setAgentDelete(null);
            await refresh();
          }}
          onReload={async () => {
            setConflictState(null);
            setEditingProject(false);
            setAgentEdit(null);
            setAgentDelete(null);
            await refresh();
          }}
          onClose={() => setConflictState(null)}
        />
      )}
    </div>
  );
}
