/**
 * Global project-scope filter helpers (header project picker).
 *
 * Semantics: project-bound data (tasks, agents, costs, events, traces,
 * project workflow files) is filtered; company-level data (goals, workflow
 * registry/runs, gates, skills) is never filtered — those surfaces render a
 * `CompanyWideBadge` instead so scoped and unscoped data are never silently
 * mixed.
 */

/**
 * Agents visible under a project scope: the project's own agents plus
 * company agents (office/pm serve every project).
 */
export function agentsInScope<T extends { projectId?: string | null }>(
  agents: T[],
  selectedProject: string | null,
): T[] {
  if (!selectedProject) return agents;
  return agents.filter((a) => a.projectId === selectedProject || a.projectId === 'company');
}

/** Events visible under a project scope: project events plus company-level ones (no projectId). */
export function eventsInScope<T extends { projectId?: string | null }>(
  events: T[],
  selectedProject: string | null,
): T[] {
  if (!selectedProject) return events;
  return events.filter((e) => !e.projectId || e.projectId === selectedProject);
}
