import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmptyState } from '../../components/ui/index.js';
import { DeleteProjectModal } from '../../components/DeleteProjectModal.js';

export const Route = createFileRoute('/projects/')({
  component: ProjectsIndexPage,
});

export interface ProjectSummary {
  id: string;
  name: string;
  directory: string;
}

async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/v1/projects');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Server returns plain array (see server/src/api/routes/projects.ts).
  if (Array.isArray(data)) return data as ProjectSummary[];
  // Defensive: the legacy ProjectPicker assumes `{ projects: [...] }`, so
  // tolerate that envelope too.
  if (Array.isArray(data?.projects)) return data.projects as ProjectSummary[];
  return [];
}

function ProjectsIndexPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 15_000,
  });

  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  const projects = data ?? [];

  async function performDelete(id: string) {
    // Fetch the project's current ETag immediately before deleting so a
    // concurrent edit between view and click surfaces as 412 rather than a
    // silent overwrite. Skipping this when the GET fails (e.g. 404) lets
    // the DELETE return its own status.
    const url = `/api/v1/projects/${encodeURIComponent(id)}`;
    const headers: Record<string, string> = {};
    try {
      const probe = await fetch(url);
      const etag = probe.headers.get('ETag');
      if (etag) headers['If-Match'] = etag;
    } catch {
      /* probe failed; proceed without If-Match */
    }
    const res = await fetch(url, { method: 'DELETE', headers });
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Projects</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Configure projects and their per-project agents.
          </p>
        </div>
        <Link
          to="/projects/new"
          search={{ duplicate: undefined } as any}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium no-underline"
        >
          New project
        </Link>
      </div>

      {isLoading ? (
        <div className="text-xs text-zinc-500 py-12 text-center">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 py-12 text-center" role="alert">
          Failed to load projects: {String(error)}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="📂"
          title="No projects yet"
          description="Create your first project to start configuring per-project agents."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="projects-grid">
          {projects.map((p) => (
            <div
              key={p.id}
              className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-4"
              data-testid={`project-card-${p.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    className="block text-sm font-semibold text-zinc-100 hover:text-indigo-300 no-underline truncate"
                  >
                    {p.name || p.id}
                  </Link>
                  <p className="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
                    {p.id}
                  </p>
                  <p className="text-[11px] text-zinc-500 font-mono truncate mt-1">
                    {p.directory}
                  </p>
                </div>
              </div>
              <div className="flex gap-1.5 mt-3 flex-wrap">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 no-underline"
                >
                  Detail
                </Link>
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: '/projects/new',
                      search: { duplicate: p.id } as any,
                    })
                  }
                  className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(p)}
                  className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteProjectModal
          open={!!deleteTarget}
          projectId={deleteTarget.id}
          projectName={deleteTarget.name || deleteTarget.id}
          configuredAgents={[]}
          onDelete={() => performDelete(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => {
            setDeleteTarget(null);
            void queryClient.invalidateQueries({ queryKey: ['projects'] });
            void queryClient.invalidateQueries({ queryKey: ['agents'] });
            void refetch();
          }}
        />
      )}
    </div>
  );
}
