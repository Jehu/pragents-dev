import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm.js';
import {
  AgentForm,
  AGENT_TYPES,
  buildAgentPayload,
  type AgentFormValues,
  type ProjectAgentType,
} from '../../components/AgentForm.js';

export const Route = createFileRoute('/projects/new')({
  validateSearch: (search: Record<string, unknown>) => ({
    duplicate: typeof search.duplicate === 'string' ? search.duplicate : undefined,
  }),
  component: NewProjectPage,
});

type Step = 'project' | 'agents';

interface DraftAgent {
  id: string;
  values: AgentFormValues;
}

function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  let duplicateOf: string | undefined;
  try {
    const search = Route.useSearch();
    duplicateOf = search.duplicate;
  } catch {
    /* tests may not have a router context */
  }

  const { data: existing } = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/v1/projects').then((r) => r.json()),
    staleTime: 15_000,
  });

  const existingIds: string[] = useMemo(() => {
    if (Array.isArray(existing)) return existing.map((p: any) => p.id);
    if (Array.isArray(existing?.projects))
      return existing.projects.map((p: any) => p.id);
    return [];
  }, [existing]);

  const initialProject: Partial<ProjectFormValues> | undefined = duplicateOf
    ? { id: `${duplicateOf}-copy`, name: '', directory: '~/' }
    : undefined;

  const [step, setStep] = useState<Step>('project');
  const [project, setProject] = useState<ProjectFormValues | null>(null);
  const [agents, setAgents] = useState<DraftAgent[]>([]);
  const [editingAgent, setEditingAgent] = useState<DraftAgent | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleProjectSubmit(values: ProjectFormValues) {
    setProject(values);
    setStep('agents');
  }

  function takenTypes(exclude?: string): ProjectAgentType[] {
    return agents
      .filter((a) => a.id !== exclude)
      .map((a) => a.values.type);
  }

  function addOrUpdateAgent(values: AgentFormValues, existingId?: string) {
    setAgents((prev) => {
      if (existingId) {
        return prev.map((a) => (a.id === existingId ? { ...a, values } : a));
      }
      return [...prev, { id: `agent-${prev.length + 1}-${Date.now()}`, values }];
    });
    setEditingAgent(null);
  }

  function removeAgent(id: string) {
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }

  async function submitAll() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const agentsPayload: Record<string, unknown> = {};
      for (const a of agents) {
        agentsPayload[a.values.type] = buildAgentPayload(a.values);
      }
      const body = {
        id: project.id,
        name: project.name,
        directory: project.directory,
        agents: agentsPayload,
      };
      // Probe the current `/api/v1/projects` ETag right before the POST
      // so a parallel writer (another tab, an external editor) surfaces
      // as 412 instead of silently overwriting the file under us.
      // Probe failure is non-fatal — fall back to no-If-Match.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const probe = await fetch('/api/v1/projects');
        const etag = probe.headers.get('ETag');
        if (etag) headers['If-Match'] = etag;
      } catch {
        /* probe failed; let the POST proceed without If-Match */
      }
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (res.status === 412) {
        throw new Error(
          'pragents.yaml changed since this wizard opened — refresh and re-try.',
        );
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          New project
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Step {step === 'project' ? '1' : '2'} of 2 ·{' '}
          {step === 'project' ? 'Project details' : 'Initial agents (optional)'}
        </p>
      </div>

      {step === 'project' ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <ProjectForm
            initialValues={initialProject ?? project ?? undefined}
            existingIds={existingIds}
            onCancel={() => navigate({ to: '/projects' })}
            onSubmit={handleProjectSubmit}
            submitLabel="Next"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-100">Agents</h2>
              {agents.length < AGENT_TYPES.length && (
                <button
                  type="button"
                  onClick={() => setEditingAgent('new')}
                  className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                >
                  Add agent
                </button>
              )}
            </div>
            {agents.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No agents yet — you can add agents now or later from the project
                detail page.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="draft-agent-list">
                {agents.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-100 font-mono">
                        {a.values.type}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {a.values.model || '(no model)'} ·{' '}
                        {a.values.capabilities.length} capabilities
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingAgent(a)}
                        className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAgent(a.id)}
                        className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {editingAgent && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
              <AgentForm
                initialValues={editingAgent === 'new' ? undefined : editingAgent.values}
                editMode={editingAgent !== 'new'}
                takenTypes={takenTypes(editingAgent === 'new' ? undefined : editingAgent.id)}
                onCancel={() => setEditingAgent(null)}
                onSubmit={(values) =>
                  addOrUpdateAgent(
                    values,
                    editingAgent === 'new' ? undefined : editingAgent.id,
                  )
                }
                submitLabel={editingAgent === 'new' ? 'Add agent' : 'Update agent'}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
            >
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep('project')}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Back
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitAll}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40"
              >
                Skip agents
              </button>
              <button
                type="button"
                onClick={submitAll}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
              >
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
