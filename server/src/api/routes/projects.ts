import { Hono } from 'hono';
import type { ResolvedAgent } from '../../config/schema.js';
import type { AgentSessionManager } from '../../agents/manager.js';

export function createProjectsRoute(config: { projects: Record<string, any> }) {
  return new Hono().get('/', (c) => {
    const projects = Object.entries(config.projects).map(([id, p]) => ({
      id,
      name: p.name,
      directory: p.directory,
    }));
    return c.json(projects);
  });
}

export function createAgentsRoute(agents: ResolvedAgent[], sessionMgr: AgentSessionManager) {
  return new Hono().get('/', (c) => {
    const result = agents.map((a) => ({
      id: a.id,
      type: a.type,
      projectId: a.projectId,
      model: a.model,
      capabilities: a.capabilities,
      status: sessionMgr.getAgentStatus(a.id),
    }));
    return c.json(result);
  });
}
