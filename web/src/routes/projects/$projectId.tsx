import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal.js';
import {
  ProjectForm,
  type ProjectFormValues,
} from '../../components/ProjectForm.js';
import { AGENT_TYPES, type ProjectAgentType } from '../../components/AgentForm.js';
import { DeleteProjectModal } from '../../components/DeleteProjectModal.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import { useEtagFetch } from '../../hooks/useEtagFetch.js';

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailLayout,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawAgent {
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

export interface ProjectDetail {
  id: string;
  name: string;
  directory: string;
  agents: Partial<Record<ProjectAgentType, RawAgent>>;
}

// ─── Shared context ──────────────────────────────────────────────────────────
// Layout owns the etag-aware fetch and exposes it to nested routes so agents
// and workflows tabs share a single source of truth for project state +
// optimistic etag tracking. Children invoke `refresh()` after their own
// mutations so the layout's etag stays in lock-step with the on-disk file.

export interface ProjectDetailContextValue {
  projectId: string;
  data: ProjectDetail;
  etag: string | null;
  readUrl: string;
  refresh: () => Promise<void>;
}

// Exported so tests can render nested-route components in isolation by
// wrapping them in a provider with a stub value.
export const ProjectDetailContext = createContext<ProjectDetailContextValue | null>(null);

export function useProjectDetail(): ProjectDetailContextValue {
  const ctx = useContext(ProjectDetailContext);
  if (!ctx) {
    throw new Error('useProjectDetail must be used within a ProjectDetailLayout');
  }
  return ctx;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

function ProjectDetailLayout() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const readUrl = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  const { data, etag, refetch, loading, error } = useEtagFetch<ProjectDetail>(readUrl);

  const [editingProject, setEditingProject] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflictState, setConflictState] = useState<{
    localContent: string;
    remoteContent: string;
  } | null>(null);

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

  async function refresh() {
    refetch();
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['agents'] });
  }

  const configuredTypes: ProjectAgentType[] = useMemo(() => {
    if (!data) return [];
    return AGENT_TYPES.filter((t) => !!data.agents?.[t]);
  }, [data]);

  async function performDelete() {
    const res = await fetch(readUrl, {
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

  const ctxValue: ProjectDetailContextValue = {
    projectId,
    data,
    etag,
    readUrl,
    refresh,
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <Link
            to="/projects"
            className="text-[11px] text-zinc-500 hover:text-zinc-300 no-underline"
          >
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

      {/* Tab navigation as real URL segments */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800" role="tablist">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          activeOptions={{ exact: true }}
          activeProps={{
            className:
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors no-underline border-zinc-300 text-zinc-100',
          }}
          inactiveProps={{
            className:
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors no-underline border-transparent text-zinc-500 hover:text-zinc-300',
          }}
        >
          Agents
        </Link>
        <Link
          to="/projects/$projectId/workflows"
          params={{ projectId }}
          activeProps={{
            className:
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors no-underline border-zinc-300 text-zinc-100',
          }}
          inactiveProps={{
            className:
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors no-underline border-transparent text-zinc-500 hover:text-zinc-300',
          }}
        >
          Workflows
        </Link>
      </div>

      {mutationError && (
        <div
          role="alert"
          className="mb-4 bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
        >
          {mutationError}
        </div>
      )}

      <ProjectDetailContext.Provider value={ctxValue}>
        <Outlet />
      </ProjectDetailContext.Provider>

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
            await refresh();
          }}
          onReload={async () => {
            setConflictState(null);
            setEditingProject(false);
            await refresh();
          }}
          onClose={() => setConflictState(null)}
        />
      )}
    </div>
  );
}
