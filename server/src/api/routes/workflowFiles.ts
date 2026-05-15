import { Hono } from 'hono';
import type { Context } from 'hono';
import * as YAML from 'yaml';
import { z } from 'zod';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ProjectConfig } from '../../config/schema.js';
import { WorkflowDef as WorkflowSchema } from '@pragents/schema/workflow';
import {
  readYamlDoc,
  computeEtag,
  EtagMismatchError,
} from '../../config/yaml-rw.js';
import { suppressWatcherChange } from '../../config/loader.js';
import { assertWithinRoot, PathOutOfBoundsError } from '../../security/paths.js';
import { logger } from '../../logging/index.js';

/**
 * Config-UI: workflow-file CRUD per project (Slice 4 / U11).
 *
 * Workflow definitions live at:
 *   <project.directory>/<project.workflowDirectory>/<name>.yaml
 *
 * Both `directory` and `workflowDirectory` come from `pragents.yaml` —
 * the latter defaults to `'workflows'` via the schema. Mounted as a
 * sub-route off `/api/v1/projects/:projectId/workflows` so the URL
 * naturally encodes which project the file belongs to.
 *
 * Path safety: every read/write resolves the requested name against
 * the resolved workflow root via `assertWithinRoot`, so URL-encoded
 * traversal (`../../etc/passwd`) is rejected with 400 before we touch
 * the filesystem. `~` in `directory` is expanded to the operator's
 * home directory the same way the agent manager does it.
 *
 * Concurrency: ETags are weak SHA-256 over file content. PUT/DELETE
 * accept `If-Match` for optimistic concurrency; mismatch → 412.
 * Every mutating endpoint trips `suppressWatcherChange` so the
 * eventual project-workflow watcher (Slice-4 follow-on) does not
 * re-interpret the UI save as an external edit.
 */

// kebab-case-friendly workflow name. Disallows slashes, dots, traversal.
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const PROJECT_RE = /^[a-z0-9][a-z0-9-]*$/i;

interface WorkflowFilesOptions {
  /**
   * Absolute path to `pragents.yaml`. Re-read on every request so route
   * behaviour reflects the on-disk truth even after a hot-reload.
   */
  configPath: string;
}

class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project "${projectId}" not found`);
    this.name = 'ProjectNotFoundError';
  }
}

class WorkflowNotFoundError extends Error {
  constructor(public readonly name: string) {
    super(`Workflow "${name}" not found`);
    this.name = 'WorkflowNotFoundError';
  }
}

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace(/^~/, homedir());
  }
  return p;
}

/**
 * Resolve `projects[projectId]` from `pragents.yaml`, returning the
 * absolute workflow directory. Throws `ProjectNotFoundError` if the
 * project block is missing.
 */
function resolveWorkflowRoot(configPath: string, projectId: string): string {
  const { doc } = readYamlDoc(configPath);
  const projects = doc.get('projects') as YAML.YAMLMap | undefined;
  if (!projects || !YAML.isMap(projects) || !projects.has(projectId)) {
    throw new ProjectNotFoundError(projectId);
  }
  const projectNode = projects.get(projectId) as YAML.YAMLMap;
  const raw = (projectNode.toJSON?.() ?? {}) as Record<string, unknown>;
  // Re-validate via the shared schema so the workflowDirectory default
  // kicks in for legacy configs without the field.
  const parsed = ProjectConfig.safeParse({
    name: raw.name,
    directory: raw.directory,
    workflowDirectory: raw.workflowDirectory,
    agents: raw.agents ?? {},
  });
  if (!parsed.success) {
    throw new Error(
      `Project "${projectId}" is malformed: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  const projectDir = expandHome(parsed.data.directory);
  return join(projectDir, parsed.data.workflowDirectory);
}

function workflowPath(root: string, name: string): string {
  return assertWithinRoot(`${name}.yaml`, root, { followSymlinks: false });
}

function zodError(c: Context, parseResult: z.SafeParseError<unknown>, message: string) {
  return c.json({ error: message, issues: parseResult.error.issues }, 400);
}

function mapWriteError(c: Context, err: unknown) {
  if (err instanceof ProjectNotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  if (err instanceof WorkflowNotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  if (err instanceof EtagMismatchError) {
    return c.json(
      { error: err.message, expected: err.expected, actual: err.actual },
      412,
    );
  }
  if (err instanceof PathOutOfBoundsError) {
    return c.json({ error: 'Workflow name is not within the project workflow root' }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'workflowFiles route failed');
  return c.json({ error: message }, 500);
}

export function createWorkflowFilesRoute(opts: WorkflowFilesOptions) {
  const { configPath } = opts;
  const r = new Hono();

  // GET /:projectId/workflows — list `.yaml` / `.yml` files in the
  // project's workflow root. Each entry carries the parsed `name` from
  // the file's YAML body (falling back to the filename when parsing
  // fails) plus a description-best-effort.
  r.get('/:projectId/workflows', (c) => {
    const projectId = c.req.param('projectId');
    if (!PROJECT_RE.test(projectId)) {
      return c.json({ error: 'Invalid projectId' }, 400);
    }
    try {
      const root = resolveWorkflowRoot(configPath, projectId);
      let files: string[] = [];
      try {
        files = readdirSync(root).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      } catch (err: any) {
        if (err?.code === 'ENOENT') return c.json([]);
        throw err;
      }
      const out: Array<{ name: string; description?: string; mtime: number }> = [];
      for (const file of files) {
        const filePath = join(root, file);
        let parsed: any = {};
        try {
          parsed = YAML.parse(readFileSync(filePath, 'utf8')) ?? {};
        } catch {
          /* unreadable / unparseable — surface filename only */
        }
        out.push({
          name: typeof parsed.name === 'string' ? parsed.name : file.replace(/\.ya?ml$/, ''),
          description: typeof parsed.description === 'string' ? parsed.description : undefined,
          mtime: statSync(filePath).mtimeMs,
        });
      }
      return c.json(out);
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // GET /:projectId/workflows/:name — return raw YAML text plus ETag.
  // The editor wants the original text (comments, formatting) — not a
  // round-tripped re-serialization.
  r.get('/:projectId/workflows/:name', (c) => {
    const projectId = c.req.param('projectId');
    const name = c.req.param('name');
    if (!PROJECT_RE.test(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    if (!NAME_RE.test(name)) return c.json({ error: 'Invalid workflow name' }, 400);
    try {
      const root = resolveWorkflowRoot(configPath, projectId);
      const filePath = workflowPath(root, name);
      if (!existsSync(filePath)) throw new WorkflowNotFoundError(name);
      const content = readFileSync(filePath, 'utf8');
      const etag = computeEtag(content);
      c.header('ETag', etag);
      return c.json({ name, content, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // POST /:projectId/workflows — body { name, content }. Creates the
  // workflow directory on demand. 409 if the file already exists.
  r.post('/:projectId/workflows', async (c) => {
    const projectId = c.req.param('projectId');
    if (!PROJECT_RE.test(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const name = (body as any).name;
    const content = (body as any).content;
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      return c.json({ error: 'Invalid workflow name (kebab-case identifier)' }, 400);
    }
    if (typeof content !== 'string') {
      return c.json({ error: '`content` must be a YAML string' }, 400);
    }
    // Validate parsed shape against the shared workflow schema before we
    // touch the filesystem. Surface Zod issues like the other routes do.
    let parsedDoc: unknown;
    try {
      parsedDoc = YAML.parse(content);
    } catch (err) {
      return c.json(
        { error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` },
        400,
      );
    }
    const validated = WorkflowSchema.safeParse(parsedDoc);
    if (!validated.success) return zodError(c, validated, 'Invalid workflow definition');
    try {
      const root = resolveWorkflowRoot(configPath, projectId);
      mkdirSync(root, { recursive: true });
      const filePath = workflowPath(root, name);
      if (existsSync(filePath)) {
        return c.json({ error: `Workflow "${name}" already exists` }, 409);
      }
      suppressWatcherChange(filePath, 250);
      writeFileSync(filePath, content, 'utf8');
      const etag = computeEtag(content);
      c.header('ETag', etag);
      logger.info({ projectId, name }, 'Workflow created via API');
      return c.json({ projectId, name, etag }, 201);
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // PUT /:projectId/workflows/:name — body { content }, If-Match enforced.
  r.put('/:projectId/workflows/:name', async (c) => {
    const projectId = c.req.param('projectId');
    const name = c.req.param('name');
    if (!PROJECT_RE.test(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    if (!NAME_RE.test(name)) return c.json({ error: 'Invalid workflow name' }, 400);
    const ifMatch = c.req.header('If-Match');
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Body must be JSON' }, 400);
    }
    const content = (body as any).content;
    if (typeof content !== 'string') {
      return c.json({ error: '`content` must be a YAML string' }, 400);
    }
    let parsedDoc: unknown;
    try {
      parsedDoc = YAML.parse(content);
    } catch (err) {
      return c.json(
        { error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` },
        400,
      );
    }
    const validated = WorkflowSchema.safeParse(parsedDoc);
    if (!validated.success) return zodError(c, validated, 'Invalid workflow definition');
    try {
      const root = resolveWorkflowRoot(configPath, projectId);
      const filePath = workflowPath(root, name);
      if (!existsSync(filePath)) throw new WorkflowNotFoundError(name);
      if (ifMatch !== undefined) {
        const currentEtag = computeEtag(readFileSync(filePath, 'utf8'));
        if (currentEtag !== ifMatch) {
          throw new EtagMismatchError(filePath, ifMatch, currentEtag);
        }
      }
      suppressWatcherChange(filePath, 250);
      writeFileSync(filePath, content, 'utf8');
      const etag = computeEtag(content);
      c.header('ETag', etag);
      logger.info({ projectId, name }, 'Workflow updated via API');
      return c.json({ projectId, name, etag });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  // DELETE /:projectId/workflows/:name — If-Match optional.
  r.delete('/:projectId/workflows/:name', (c) => {
    const projectId = c.req.param('projectId');
    const name = c.req.param('name');
    if (!PROJECT_RE.test(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    if (!NAME_RE.test(name)) return c.json({ error: 'Invalid workflow name' }, 400);
    const ifMatch = c.req.header('If-Match');
    try {
      const root = resolveWorkflowRoot(configPath, projectId);
      const filePath = workflowPath(root, name);
      if (!existsSync(filePath)) throw new WorkflowNotFoundError(name);
      if (ifMatch !== undefined) {
        const currentEtag = computeEtag(readFileSync(filePath, 'utf8'));
        if (currentEtag !== ifMatch) {
          throw new EtagMismatchError(filePath, ifMatch, currentEtag);
        }
      }
      suppressWatcherChange(filePath, 250);
      unlinkSync(filePath);
      logger.info({ projectId, name }, 'Workflow deleted via API');
      return c.json({ deleted: name });
    } catch (err) {
      return mapWriteError(c, err);
    }
  });

  return r;
}

// Re-export so callers needing the schema (e.g. tests) don't import deep paths.
export { WorkflowSchema as WorkflowDef };
