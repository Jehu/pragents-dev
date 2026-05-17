import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createProjectsRoute } from '../projects.js';
import * as loader from '../../../config/loader.js';
import type { AgentSessionManager } from '../../../agents/manager.js';

/**
 * Minimal pragents.yaml fixture with comments + flow-style cost entries so
 * we can assert round-trip preservation across mutations.
 */
const SAMPLE = `# top-level comment
company:
  name: "Acme"
  agents:
    office:
      type: office
      model: deepseek/deepseek-v4-flash

projects:
  alpha:
    # alpha-specific note
    name: "Alpha Project"
    directory: "~/code/alpha"
    agents:
      dev:
        type: dev
        model: claude-sonnet
        personality: "Helpful dev agent"
        capabilities: ["coding"]

costs:
  anthropic/claude-sonnet: { in: 3.0, out: 15.0 }
`;

function makeSessionMgr(activeForProject: Record<string, string[]> = {}): AgentSessionManager {
  return {
    getActiveSessionsForProject: vi.fn((projectId: string) => activeForProject[projectId] ?? []),
  } as unknown as AgentSessionManager;
}

describe('createProjectsRoute', () => {
  let dir: string;
  let configPath: string;
  let app: Hono;
  let sessionMgr: AgentSessionManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'projects-route-'));
    configPath = join(dir, 'pragents.yaml');
    writeFileSync(configPath, SAMPLE, 'utf8');
    sessionMgr = makeSessionMgr();
    app = new Hono().route('/projects', createProjectsRoute({ configPath, sessionMgr }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /', () => {
    it('returns the project list with ETag', async () => {
      const res = await app.request('/projects');
      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
      const body = (await res.json()) as Array<{ id: string; name: string; directory: string }>;
      expect(body).toEqual([
        { id: 'alpha', name: 'Alpha Project', directory: '~/code/alpha' },
      ]);
    });
  });

  describe('GET /:projectId', () => {
    it('returns the project block including agents', async () => {
      const res = await app.request('/projects/alpha');
      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
      const body = (await res.json()) as { id: string; name: string; agents: Record<string, unknown> };
      expect(body.id).toBe('alpha');
      expect(body.name).toBe('Alpha Project');
      expect(body.agents).toHaveProperty('dev');
    });

    it('returns 404 for unknown project', async () => {
      const res = await app.request('/projects/missing');
      expect(res.status).toBe(404);
    });

    it('rejects invalid projectId', async () => {
      const res = await app.request('/projects/has space');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /', () => {
    it('creates a new project and the YAML file contains the block', async () => {
      const projectDir = join(dir, 'beta-project');
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'beta',
          name: 'Beta Project',
          directory: projectDir,
        }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
      expect(existsSync(projectDir)).toBe(true);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('beta:');
      expect(onDisk).toContain('Beta Project');
      // Original comments preserved
      expect(onDisk).toContain('# top-level comment');
      expect(onDisk).toContain('# alpha-specific note');
    });

    it('returns 409 on duplicate projectId', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'alpha', name: 'X', directory: '/x' }),
      });
      expect(res.status).toBe(409);
    });

    it('returns 400 on invalid id', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'has space', name: 'X', directory: '/x' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 with Zod issues on invalid body', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'gamma', name: 123 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues?: unknown[] };
      expect(body.error).toMatch(/Invalid project config/);
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('returns 412 when If-Match is stale (C4: lost-update guard)', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"stale"' },
        body: JSON.stringify({ id: 'gamma', name: 'Gamma', directory: join(dir, 'gamma-project') }),
      });
      expect(res.status).toBe(412);
      // File untouched.
      expect(readFileSync(configPath, 'utf8')).not.toContain('gamma:');
    });

    it('proceeds when If-Match matches the current file', async () => {
      const list = await app.request('/projects');
      const etag = list.headers.get('ETag')!;
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ id: 'gamma', name: 'Gamma', directory: join(dir, 'gamma-project') }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('PUT /:projectId', () => {
    it('updates name + directory and keeps comments intact', async () => {
      const get = await app.request('/projects/alpha');
      const etag = get.headers.get('ETag')!;
      const res = await app.request('/projects/alpha', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({
          name: 'Alpha v2',
          directory: '~/code/alpha-v2',
          agents: {},
        }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('Alpha v2');
      // Top-level + nested comments preserved across the round trip.
      expect(onDisk).toContain('# top-level comment');
    });

    it('keeps existing agents when body omits `agents` (C1: silent-wipe guard)', async () => {
      // Body has no `agents` key at all — the dev agent must survive.
      const res = await app.request('/projects/alpha', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alpha v3', directory: '~/code/alpha-v3' }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('Alpha v3');
      expect(onDisk).toMatch(/dev:\s/);
      expect(onDisk).toContain('Helpful dev agent');
    });

    it('preserves nested `# alpha-specific note` comment on PUT (AE2)', async () => {
      const res = await app.request('/projects/alpha', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alpha v4', directory: '~/code/alpha-v4' }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('# alpha-specific note');
    });

    it('clears agents when body explicitly sets `agents: {}` (preserves opt-in wipe)', async () => {
      const res = await app.request('/projects/alpha', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Alpha empty',
          directory: '~/code/alpha',
          agents: {},
        }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      // `dev` slot is gone — explicit empty agents map is honoured.
      expect(onDisk).not.toMatch(/^\s*dev:/m);
    });

    it('returns 412 on stale If-Match', async () => {
      const res = await app.request('/projects/alpha', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"deadbeef"' },
        body: JSON.stringify({ name: 'x', directory: '/x', agents: {} }),
      });
      expect(res.status).toBe(412);
    });

    it('returns 404 when project does not exist', async () => {
      const res = await app.request('/projects/nope', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x', directory: '/x', agents: {} }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:projectId', () => {
    it('returns 409 with activeAgents when a session is running', async () => {
      sessionMgr = makeSessionMgr({ alpha: ['dev@alpha'] });
      app = new Hono().route('/projects', createProjectsRoute({ configPath, sessionMgr }));
      const res = await app.request('/projects/alpha', { method: 'DELETE' });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; activeAgents: string[] };
      expect(body.activeAgents).toEqual(['dev@alpha']);
      // File untouched
      expect(readFileSync(configPath, 'utf8')).toContain('alpha:');
    });

    it('removes the project block when no sessions are active', async () => {
      const res = await app.request('/projects/alpha', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).not.toMatch(/^\s*alpha:/m);
      // Sibling sections preserved.
      expect(onDisk).toContain('company:');
      expect(onDisk).toContain('costs:');
    });

    it('returns 404 when project does not exist', async () => {
      const res = await app.request('/projects/missing', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('returns 404 (not 409) when project is absent even if a same-suffix session exists (C3)', async () => {
      // Simulate an active session whose id happens to end with `@company`
      // (a company-scope agent). A naive `endsWith(@company)` lookup would
      // surface this as 409 against a non-existent `company` project.
      sessionMgr = makeSessionMgr({ company: ['office@company'] });
      app = new Hono().route('/projects', createProjectsRoute({ configPath, sessionMgr }));
      const res = await app.request('/projects/company', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:projectId/agents', () => {
    it('adds a new agent type', async () => {
      const res = await app.request('/projects/alpha/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'seo', model: 'claude-sonnet', personality: 'SEO agent' }),
      });
      expect(res.status).toBe(201);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toMatch(/seo:\s/);
      expect(onDisk).toContain('SEO agent');
    });

    it('returns 409 when the agent slot is taken', async () => {
      const res = await app.request('/projects/alpha/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'dev', model: 'claude-sonnet' }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects unknown type', async () => {
      const res = await app.request('/projects/alpha/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'pm', model: 'claude-sonnet' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 412 when If-Match is stale (C4)', async () => {
      const res = await app.request('/projects/alpha/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"stale"' },
        body: JSON.stringify({ type: 'seo', model: 'claude-sonnet' }),
      });
      expect(res.status).toBe(412);
    });
  });

  describe('PUT /:projectId/agents/:agentType', () => {
    it('updates personality and preserves YAML comments', async () => {
      const before = readFileSync(configPath, 'utf8');
      // Sanity: comments are present in the baseline fixture.
      expect(before).toContain('# alpha-specific note');

      const res = await app.request('/projects/alpha/agents/dev', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet',
          personality: 'Updated personality',
          capabilities: ['coding', 'review'],
        }),
      });
      expect(res.status).toBe(200);
      const after = readFileSync(configPath, 'utf8');
      expect(after).toContain('Updated personality');
      // Critical AE requirement: comments survive an agent update.
      expect(after).toContain('# top-level comment');
      expect(after).toContain('# alpha-specific note');
      // Flow-style scalar preserved.
      expect(after).toContain('{ in: 3.0, out: 15.0 }');
    });

    it('returns 412 on stale If-Match', async () => {
      const res = await app.request('/projects/alpha/agents/dev', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"stale"' },
        body: JSON.stringify({ model: 'claude-sonnet' }),
      });
      expect(res.status).toBe(412);
    });

    it('returns 400 with Zod issues on invalid model type', async () => {
      const res = await app.request('/projects/alpha/agents/dev', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 123 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues?: unknown[] };
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('returns 404 when agent slot is empty', async () => {
      const res = await app.request('/projects/alpha/agents/seo', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:projectId/agents/:agentType', () => {
    it('removes the agent and leaves siblings intact', async () => {
      const res = await app.request('/projects/alpha/agents/dev', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).not.toMatch(/dev:\s/);
      // Project + company blocks still there.
      expect(onDisk).toContain('alpha:');
      expect(onDisk).toContain('company:');
    });

    it('returns 404 for missing agent', async () => {
      const res = await app.request('/projects/alpha/agents/content', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('AE5: posted agents are readable through subsequent loadConfig calls', () => {
    it('shows up via loadConfig (reads file fresh)', async () => {
      const res = await app.request('/projects/alpha/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'content', model: 'claude-sonnet' }),
      });
      expect(res.status).toBe(201);
      const { loadConfig } = await import('../../../config/loader.js');
      const { agents } = loadConfig(configPath);
      const found = agents.find((a) => a.id === 'content@alpha');
      expect(found).toBeDefined();
      expect(found?.type).toBe('content');
    });
  });

  describe('Malformed JSON bodies return 400 across all mutating endpoints', () => {
    const cases: Array<{ name: string; method: 'POST' | 'PUT'; url: string }> = [
      { name: 'POST /', method: 'POST', url: '/projects' },
      { name: 'PUT /:projectId', method: 'PUT', url: '/projects/alpha' },
      { name: 'POST /:projectId/agents', method: 'POST', url: '/projects/alpha/agents' },
      { name: 'PUT /:projectId/agents/:agentType', method: 'PUT', url: '/projects/alpha/agents/dev' },
    ];

    for (const tc of cases) {
      it(`${tc.name} rejects non-JSON body with 400`, async () => {
        const res = await app.request(tc.url, {
          method: tc.method,
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/Body must be JSON/);
      });
    }
  });

  describe('AE7: writes go through the watcher-suppression channel', () => {
    /**
     * Verify `suppressWatcherChange` is called with the config path on every
     * UI-originated mutation, so a self-write does not get re-interpreted as
     * an external edit by the loader's fs.watch listener.
     */
    it('PUT agent triggers suppressWatcherChange with the config path', async () => {
      const spy = vi.spyOn(loader, 'suppressWatcherChange');
      const res = await app.request('/projects/alpha/agents/dev', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet', personality: 'x' }),
      });
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(configPath, expect.any(Number));
      spy.mockRestore();
    });

    it('every mutating endpoint suppresses the watcher', async () => {
      const spy = vi.spyOn(loader, 'suppressWatcherChange');

      // POST project
      await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'delta', name: 'D', directory: '~/d' }),
      });
      // POST agent
      await app.request('/projects/alpha/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'seo', model: 'claude-sonnet' }),
      });
      // PUT project
      await app.request('/projects/alpha', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alpha v9', directory: '~/code/alpha' }),
      });
      // DELETE agent
      await app.request('/projects/alpha/agents/seo', { method: 'DELETE' });
      // DELETE project
      await app.request('/projects/delta', { method: 'DELETE' });

      // Five mutations → five suppressions against the same file.
      const calls = spy.mock.calls.filter((c) => c[0] === configPath);
      expect(calls.length).toBe(5);
      spy.mockRestore();
    });
  });
});
