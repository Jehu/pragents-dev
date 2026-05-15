import { Hono } from 'hono';
import * as YAML from 'yaml';
import { z } from 'zod';
import type { ResolvedAgent } from '../../config/schema.js';
import { AgentConfig, ProjectConfig } from '../../config/schema.js';
import { PROJECT_AGENT_TYPES, type ProjectAgentType } from '@pragents/schema';
import type { AgentSessionManager } from '../../agents/manager.js';
import { readYamlDoc, writeYamlDoc, applyMutation, EtagMismatchError } from '../../config/yaml-rw.js';
import { logger } from '../../logging/index.js';

/**
 * Config-UI: write API for projects + their agents (Slice 2 / U7).
 *
 * All mutations go through `readYamlDoc` + `applyMutation` + `writeYamlDoc`
 * so:
 *  - Block comments, key order, anchors, and scalar style are preserved in
 *    `~/.pragents/pragents.yaml` (see `yaml-rw.ts` and round-trip tests).
 *  - The fs watcher in `config/loader.ts` is told to ignore the resulting
 *    change event (R17 / AE7), so a UI save does not look like an external
 *    edit and double-reload.
 *  - Optimistic-concurrency uses weak SHA-256 ETags via the `If-Match`
 *    request header (pattern mirrors the skills routes).
 *
 * Validation happens server-side via the shared `@pragents/schema` Zod
 * types (defense in depth — the web bundle uses the same schemas).
 */

// Path-segment validation: kebab-case identifiers only. Blocks whitespace,
// dots, slashes, and any traversal characters.
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/i;

function isProjectAgentType(value: string): value is ProjectAgentType {
  return (PROJECT_AGENT_TYPES as readonly string[]).includes(value);
}

interface ProjectsRouteOptions {
  /**
   * Absolute path to `pragents.yaml`. Re-read on every request so the
   * route reflects the on-disk truth even after hot-reload.
   */
  configPath: string;
  sessionMgr: AgentSessionManager;
}

/**
 * Map a Zod failure to a `400` response with the issue list. Returned in
 * the same shape used by the skills route so the web client can drive a
 * consistent error-display path.
 */
function zodError(c: any, parseResult: z.SafeParseError<unknown>, message: string) {
  return c.json(
    {
      error: message,
      issues: parseResult.error.issues,
    },
    400,
  );
}

function mapWriteError(c: any, err: unknown) {
  if (err instanceof EtagMismatchError) {
    return c.json(
      { error: err.message, expected: err.expected, actual: err.actual },
      412,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'projects route write failed');
  return c.json({ error: message }, 500);
}

/**
 * Read `pragents.yaml` and return a typed view of a single project block.
 * Throws when the project is missing — callers map to 404.
 */
function readProjectBlock(configPath: string, projectId: string) {
  const { doc, etag, raw } = readYamlDoc(configPath);
  const projects = doc.get('projects') as YAML.YAMLMap | undefined;
  if (!projects || !YAML.isMap(projects) || !projects.has(projectId)) {
    return { found: false as const, etag, raw, doc };
  }
  const node = projects.get(projectId) as YAML.YAMLMap | undefined;
  const json = node?.toJSON ? node.toJSON() : node;
  return { found: true as const, etag, raw, doc, json };
}

export function createProjectsRoute(opts: ProjectsRouteOptions) {
  const { configPath, sessionMgr } = opts;
  const r = new Hono();

  // GET / — list projects. ETag tracks the on-disk pragents.yaml content
  // so a client cache can revalidate after external edits. Backwards-
  // compatible shape (`[{id, name, directory}]`) — see `web/src/routes/__root.tsx`.
  r.get('/', (c) => {
    try {
      const { doc, etag } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      const projects: Array<{ id: string; name: string; directory: string }> = [];
      if (projectsNode && YAML.isMap(projectsNode)) {
        for (const item of projectsNode.items) {
          const id = String(item.key);
          const value = (item.value as YAML.YAMLMap | null)?.toJSON?.() ?? {};
          projects.push({
            id,
            name: typeof value.name === 'string' ? value.name : '',
            directory: typeof value.directory === 'string' ? value.directory : '',
          });
        }
      }
      c.header('ETag', etag);
      return c.json(projects);
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // GET /:projectId — full project block including agents.
  r.get('/:projectId', (c) => {
    const projectId = c.req.param('projectId');
    if (!SEGMENT_RE.test(projectId)) {
      return c.json({ error: 'Invalid projectId' }, 400);
    }
    try {
      const result = readProjectBlock(configPath, projectId);
      if (!result.found) return c.json({ error: 'Project not found' }, 404);
      c.header('ETag', result.etag);
      const value = result.json as Partial<{ name: string; directory: string; agents: Record<string, unknown> }>;
      return c.json({
        id: projectId,
        name: value.name ?? '',
        directory: value.directory ?? '',
        agents: value.agents ?? {},
      });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // POST / — create a new project. Body: { id, name, directory, agents? }.
  // If-Match (optional) gates against a stale view of the file: when the
  // client read the project list at ETag X, a concurrent write would change
  // the file under it; supplying If-Match: X surfaces that as 412 instead of
  // silently overwriting the other writer's changes.
  r.post('/', async (c) => {
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const id = (body as any).id;
    if (typeof id !== 'string' || !SEGMENT_RE.test(id)) {
      return c.json({ error: 'Invalid `id` (must match /^[a-z0-9-]+$/i)' }, 400);
    }
    // Validate { name, directory, agents? } against the shared schema.
    const projectShape = ProjectConfig.safeParse({
      name: (body as any).name,
      directory: (body as any).directory,
      agents: (body as any).agents ?? {},
    });
    if (!projectShape.success) {
      return zodError(c, projectShape, 'Invalid project config');
    }
    try {
      const { doc } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      if (projectsNode && YAML.isMap(projectsNode) && projectsNode.has(id)) {
        return c.json({ error: `Project "${id}" already exists` }, 409);
      }
      applyMutation(doc, (d) => {
        const existing = d.get('projects') as YAML.YAMLMap | undefined;
        const block = d.createNode(projectShape.data);
        if (!existing || !YAML.isMap(existing)) {
          // Replace/insert a fresh `projects` map preserving the
          // document's section ordering.
          d.set('projects', d.createNode({ [id]: projectShape.data }));
        } else {
          existing.set(id, block);
        }
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ projectId: id }, 'Project created via API');
      return c.json({ id, etag }, 201);
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /:projectId — replace `name` and `directory`. The `agents` field is
  // optional in the body; when omitted, the existing agents block is kept
  // intact (prevents silent wipe — a client sending `{ name, directory }`
  // would otherwise lose every configured agent).
  r.put('/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    if (!SEGMENT_RE.test(projectId)) {
      return c.json({ error: 'Invalid projectId' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    try {
      const { doc } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      if (!projectsNode || !YAML.isMap(projectsNode) || !projectsNode.has(projectId)) {
        return c.json({ error: 'Project not found' }, 404);
      }
      const existingNode = projectsNode.get(projectId) as YAML.YAMLMap | undefined;
      const existing = (existingNode?.toJSON?.() ?? {}) as Partial<{
        agents: Record<string, unknown>;
      }>;
      const hasAgentsInBody = Object.prototype.hasOwnProperty.call(body, 'agents');
      const projectShape = ProjectConfig.safeParse({
        name: (body as any).name,
        directory: (body as any).directory,
        agents: hasAgentsInBody ? (body as any).agents : (existing.agents ?? {}),
      });
      if (!projectShape.success) {
        return zodError(c, projectShape, 'Invalid project config');
      }
      // Mutate the existing project YAMLMap in place rather than replacing it
      // wholesale — `set` on an existing key swaps only the value, so the
      // pair's `commentBefore` (e.g. `# alpha-specific note` attached to
      // `name:`) survives the round-trip (AE2).
      applyMutation(doc, (d) => {
        const projects = d.get('projects') as YAML.YAMLMap;
        const project = projects.get(projectId) as YAML.YAMLMap;
        project.set('name', projectShape.data.name);
        project.set('directory', projectShape.data.directory);
        if (hasAgentsInBody) {
          project.set('agents', d.createNode(projectShape.data.agents));
        }
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ projectId, agentsTouched: hasAgentsInBody }, 'Project updated via API');
      return c.json({ id: projectId, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // DELETE /:projectId — refuses while sessions for the project are
  // running (R6 / AE8). Existence is checked *before* the session lookup so
  // a non-existent projectId never collides with a name-suffix match (e.g.
  // requesting DELETE /company should 404, not 409 against `office@company`).
  r.delete('/:projectId', (c) => {
    const projectId = c.req.param('projectId');
    if (!SEGMENT_RE.test(projectId)) {
      return c.json({ error: 'Invalid projectId' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    try {
      const { doc } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      if (!projectsNode || !YAML.isMap(projectsNode) || !projectsNode.has(projectId)) {
        return c.json({ error: 'Project not found' }, 404);
      }
      const active = sessionMgr.getActiveSessionsForProject(projectId);
      if (active.length > 0) {
        return c.json(
          {
            error: `Project "${projectId}" has active agent sessions`,
            activeAgents: active,
          },
          409,
        );
      }
      applyMutation(doc, (d) => {
        const projects = d.get('projects') as YAML.YAMLMap;
        projects.delete(projectId);
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ projectId }, 'Project deleted via API');
      return c.json({ deleted: projectId, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // POST /:projectId/agents — add a new agent under a project. Body must
  // include `type` ∈ {dev, seo, content}; 409 if the slot is taken. Honours
  // If-Match for the same reason as POST / above.
  r.post('/:projectId/agents', async (c) => {
    const projectId = c.req.param('projectId');
    if (!SEGMENT_RE.test(projectId)) {
      return c.json({ error: 'Invalid projectId' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const type = (body as any).type;
    if (typeof type !== 'string' || !isProjectAgentType(type)) {
      return c.json(
        { error: `Invalid agent type; must be one of ${PROJECT_AGENT_TYPES.join(', ')}` },
        400,
      );
    }
    const agentShape = AgentConfig.safeParse(body);
    if (!agentShape.success) {
      return zodError(c, agentShape, 'Invalid agent config');
    }
    try {
      const { doc } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      if (!projectsNode || !YAML.isMap(projectsNode) || !projectsNode.has(projectId)) {
        return c.json({ error: 'Project not found' }, 404);
      }
      const projectNode = projectsNode.get(projectId) as YAML.YAMLMap;
      let agentsNode = projectNode.get('agents') as YAML.YAMLMap | undefined;
      if (agentsNode && YAML.isMap(agentsNode) && agentsNode.has(type)) {
        return c.json(
          { error: `Agent "${type}" already exists in project "${projectId}"` },
          409,
        );
      }
      applyMutation(doc, (d) => {
        const projects = d.get('projects') as YAML.YAMLMap;
        const project = projects.get(projectId) as YAML.YAMLMap;
        let agents = project.get('agents') as YAML.YAMLMap | undefined;
        if (!agents || !YAML.isMap(agents)) {
          project.set('agents', d.createNode({ [type]: agentShape.data }));
        } else {
          agents.set(type, d.createNode(agentShape.data));
        }
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ projectId, agentType: type }, 'Project agent created via API');
      return c.json({ projectId, type, etag }, 201);
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /:projectId/agents/:agentType — replace a single project agent.
  r.put('/:projectId/agents/:agentType', async (c) => {
    const projectId = c.req.param('projectId');
    const agentType = c.req.param('agentType');
    if (!SEGMENT_RE.test(projectId) || !isProjectAgentType(agentType)) {
      return c.json({ error: 'Invalid projectId or agentType' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    // Force `type` to match the URL segment regardless of body.
    const agentShape = AgentConfig.safeParse({ ...(body as object), type: agentType });
    if (!agentShape.success) {
      return zodError(c, agentShape, 'Invalid agent config');
    }
    try {
      const { doc } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      if (!projectsNode || !YAML.isMap(projectsNode) || !projectsNode.has(projectId)) {
        return c.json({ error: 'Project not found' }, 404);
      }
      const projectNode = projectsNode.get(projectId) as YAML.YAMLMap;
      const agentsNode = projectNode.get('agents') as YAML.YAMLMap | undefined;
      if (!agentsNode || !YAML.isMap(agentsNode) || !agentsNode.has(agentType)) {
        return c.json({ error: 'Agent not found' }, 404);
      }
      applyMutation(doc, (d) => {
        const projects = d.get('projects') as YAML.YAMLMap;
        const project = projects.get(projectId) as YAML.YAMLMap;
        const agents = project.get('agents') as YAML.YAMLMap;
        agents.set(agentType, d.createNode(agentShape.data));
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ projectId, agentType }, 'Project agent updated via API');
      return c.json({ projectId, type: agentType, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // DELETE /:projectId/agents/:agentType — drop a single agent. Per the
  // U7 plan, no active-session check here: the operator owns this surface.
  r.delete('/:projectId/agents/:agentType', (c) => {
    const projectId = c.req.param('projectId');
    const agentType = c.req.param('agentType');
    if (!SEGMENT_RE.test(projectId) || !isProjectAgentType(agentType)) {
      return c.json({ error: 'Invalid projectId or agentType' }, 400);
    }
    const ifMatch = c.req.header('If-Match');
    try {
      const { doc } = readYamlDoc(configPath);
      const projectsNode = doc.get('projects') as YAML.YAMLMap | undefined;
      if (!projectsNode || !YAML.isMap(projectsNode) || !projectsNode.has(projectId)) {
        return c.json({ error: 'Project not found' }, 404);
      }
      const projectNode = projectsNode.get(projectId) as YAML.YAMLMap;
      const agentsNode = projectNode.get('agents') as YAML.YAMLMap | undefined;
      if (!agentsNode || !YAML.isMap(agentsNode) || !agentsNode.has(agentType)) {
        return c.json({ error: 'Agent not found' }, 404);
      }
      applyMutation(doc, (d) => {
        const projects = d.get('projects') as YAML.YAMLMap;
        const project = projects.get(projectId) as YAML.YAMLMap;
        const agents = project.get('agents') as YAML.YAMLMap;
        agents.delete(agentType);
      });
      const { etag } = writeYamlDoc(configPath, doc, { ifMatch });
      c.header('ETag', etag);
      logger.info({ projectId, agentType }, 'Project agent deleted via API');
      return c.json({ deleted: agentType, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  return r;
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
