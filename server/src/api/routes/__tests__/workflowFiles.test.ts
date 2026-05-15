import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createWorkflowFilesRoute } from '../workflowFiles.js';
import { createProjectsRoute } from '../projects.js';
import * as loader from '../../../config/loader.js';
import type { AgentSessionManager } from '../../../agents/manager.js';

/**
 * Fixture: a config with one project whose directory points at a tmpdir
 * we can read/write under, plus a sibling project that uses a custom
 * `workflowDirectory` value to exercise the schema default override.
 */
function makeConfig(projectDir: string, customDir: string) {
  return `company:
  name: "Acme"
projects:
  alpha:
    name: "Alpha"
    directory: "${projectDir}"
  beta:
    name: "Beta"
    directory: "${customDir}"
    workflowDirectory: custom-wf
`;
}

const VALID_WORKFLOW = `name: publish-post
description: Publish a blog post end to end
steps:
  - id: draft
    agent: content@alpha
    prompt: "Write the post"
    output: draft
`;

const VALID_WORKFLOW_UPDATED = `name: publish-post
description: Publish a blog post end to end (v2)
steps:
  - id: draft
    agent: content@alpha
    prompt: "Write the post"
    output: draft
  - id: review
    agent: dev@alpha
    prompt: "Review the post"
    input: draft
`;

function makeSessionMgr(): AgentSessionManager {
  return {
    getActiveSessionsForProject: vi.fn(() => []),
  } as unknown as AgentSessionManager;
}

describe('createWorkflowFilesRoute', () => {
  let dir: string;
  let projectDir: string;
  let customDir: string;
  let configPath: string;
  let app: Hono;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workflow-files-route-'));
    projectDir = join(dir, 'alpha-project');
    customDir = join(dir, 'beta-project');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(customDir, { recursive: true });
    configPath = join(dir, 'pragents.yaml');
    writeFileSync(configPath, makeConfig(projectDir, customDir), 'utf8');
    app = new Hono()
      .route('/api/v1/projects', createWorkflowFilesRoute({ configPath }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /:projectId/workflows', () => {
    it('returns an empty array when the workflow root does not exist yet', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('lists workflow files with parsed name + description', async () => {
      const root = join(projectDir, 'workflows');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yaml'), VALID_WORKFLOW, 'utf8');
      const res = await app.request('/api/v1/projects/alpha/workflows');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string; description?: string }>;
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('publish-post');
      expect(body[0].description).toMatch(/Publish a blog post/);
    });

    it('honours a custom workflowDirectory on the project', async () => {
      const root = join(customDir, 'custom-wf');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yml'), VALID_WORKFLOW, 'utf8');
      const res = await app.request('/api/v1/projects/beta/workflows');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body).toHaveLength(1);
    });

    it('404s when the project is missing from pragents.yaml', async () => {
      const res = await app.request('/api/v1/projects/missing/workflows');
      expect(res.status).toBe(404);
    });

    it('rejects invalid projectIds', async () => {
      const res = await app.request('/api/v1/projects/has space/workflows');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /:projectId/workflows/:name', () => {
    it('returns raw YAML content + ETag', async () => {
      const root = join(projectDir, 'workflows');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yaml'), VALID_WORKFLOW, 'utf8');
      const res = await app.request('/api/v1/projects/alpha/workflows/publish');
      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
      const body = (await res.json()) as { name: string; content: string };
      expect(body.name).toBe('publish');
      // The raw file content survives — comments / formatting are not
      // round-tripped through the YAML serializer.
      expect(body.content).toBe(VALID_WORKFLOW);
    });

    it('404s for unknown workflow', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/nope');
      expect(res.status).toBe(404);
    });

    it('rejects traversal attempts in the name segment', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/..%2Fetc%2Fpasswd');
      // Hono normalises the URL before matching — we expect either a 400
      // from NAME_RE or a 404 from Hono failing to route. Both keep the
      // filesystem safe; the contract is "never 200 with /etc/passwd content".
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('POST /:projectId/workflows', () => {
    it('creates a new workflow file and returns 201 + ETag', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'publish', content: VALID_WORKFLOW }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
      const filePath = join(projectDir, 'workflows', 'publish.yaml');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf8')).toBe(VALID_WORKFLOW);
    });

    it('returns 409 when the workflow already exists', async () => {
      const root = join(projectDir, 'workflows');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yaml'), VALID_WORKFLOW, 'utf8');
      const res = await app.request('/api/v1/projects/alpha/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'publish', content: VALID_WORKFLOW }),
      });
      expect(res.status).toBe(409);
    });

    it('returns 400 with Zod issues when the YAML body fails WorkflowDef', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'broken',
          content: 'name: broken\nsteps: not-an-array\n',
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues?: unknown[] };
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('returns 400 when the YAML body fails to parse', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'syntax', content: '::: not yaml :::' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid workflow names', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'has space', content: VALID_WORKFLOW }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:projectId/workflows/:name', () => {
    beforeEach(() => {
      const root = join(projectDir, 'workflows');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yaml'), VALID_WORKFLOW, 'utf8');
    });

    it('updates the file content', async () => {
      const get = await app.request('/api/v1/projects/alpha/workflows/publish');
      const etag = get.headers.get('ETag')!;
      const res = await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ content: VALID_WORKFLOW_UPDATED }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(join(projectDir, 'workflows', 'publish.yaml'), 'utf8');
      expect(onDisk).toContain('(v2)');
      expect(onDisk).toContain('review');
    });

    it('returns 412 on stale If-Match', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"stale"' },
        body: JSON.stringify({ content: VALID_WORKFLOW_UPDATED }),
      });
      expect(res.status).toBe(412);
    });

    it('returns 404 for unknown workflow', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/nope', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: VALID_WORKFLOW }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid workflow YAML', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'name: 5\nsteps: 42\n' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:projectId/workflows/:name', () => {
    beforeEach(() => {
      const root = join(projectDir, 'workflows');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yaml'), VALID_WORKFLOW, 'utf8');
    });

    it('removes the file', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(existsSync(join(projectDir, 'workflows', 'publish.yaml'))).toBe(false);
    });

    it('returns 404 when the file is gone', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/nope', {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });

    it('returns 412 on stale If-Match', async () => {
      const res = await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'DELETE',
        headers: { 'If-Match': 'W/"stale"' },
      });
      expect(res.status).toBe(412);
    });
  });

  describe('Watcher suppression on mutating endpoints', () => {
    it('suppresses the watcher for the affected file on each write', async () => {
      const root = join(projectDir, 'workflows');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'publish.yaml'), VALID_WORKFLOW, 'utf8');
      const spy = vi.spyOn(loader, 'suppressWatcherChange');

      await app.request('/api/v1/projects/alpha/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'second', content: VALID_WORKFLOW }),
      });
      await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: VALID_WORKFLOW_UPDATED }),
      });
      await app.request('/api/v1/projects/alpha/workflows/publish', {
        method: 'DELETE',
      });

      // One suppression per mutating call, each targeting a workflow file.
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
      for (const call of spy.mock.calls.slice(-3)) {
        expect(call[0]).toMatch(/workflows\/[a-z]+\.yaml$/);
      }
      spy.mockRestore();
    });
  });

  describe('Co-mount with createProjectsRoute does not collide', () => {
    it('GET /:projectId still hits the projects route, GET /:projectId/workflows hits ours', async () => {
      const combined = new Hono()
        .route(
          '/api/v1/projects',
          createProjectsRoute({ configPath, sessionMgr: makeSessionMgr() }),
        )
        .route('/api/v1/projects', createWorkflowFilesRoute({ configPath }));

      const detail = await combined.request('/api/v1/projects/alpha');
      expect(detail.status).toBe(200);

      const list = await combined.request('/api/v1/projects/alpha/workflows');
      expect(list.status).toBe(200);
    });
  });
});
