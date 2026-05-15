import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createSettingsRoute } from '../settings.js';
import * as loader from '../../../config/loader.js';

/**
 * Fixture with comments, flow-style scalars, and every settings section so
 * round-trip preservation can be asserted across the per-domain PUTs.
 */
const SAMPLE = `# top-level comment
company:
  name: "Acme"
  autoApproveSkills: false
  similarityThreshold: 0.8
  skillApproval:
    confidenceThreshold: 0.9
    blockedTools: [bash, write]
  agents:
    office:
      type: office
      model: deepseek/deepseek-v4-flash
      personality: "Office helper"
    pm:
      type: pm
      model: anthropic/claude-haiku-3-5
projects:
  alpha:
    # alpha-specific note
    name: "Alpha Project"
    directory: "~/code/alpha"
    agents:
      dev:
        type: dev
        model: claude-sonnet

chat:
  classifierThreshold: 0.7

interfaces:
  web:
    port: 3000
    host: localhost

costs:
  anthropic/claude-sonnet: { in: 3.0, out: 15.0 }

pool:
  maxWarmSessions: 10
`;

describe('createSettingsRoute', () => {
  let dir: string;
  let configPath: string;
  let app: Hono;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settings-route-'));
    configPath = join(dir, 'pragents.yaml');
    writeFileSync(configPath, SAMPLE, 'utf8');
    app = new Hono().route('/settings', createSettingsRoute({ configPath }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /', () => {
    it('returns a snapshot of every section with ETag', async () => {
      const res = await app.request('/settings');
      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
      const body = (await res.json()) as Record<string, any>;
      expect(body.costs).toEqual({
        'anthropic/claude-sonnet': { in: 3, out: 15 },
      });
      expect(body.pool).toEqual({ maxWarmSessions: 10 });
      expect(body.chat).toEqual({ classifierThreshold: 0.7 });
      expect(body.interfaces).toEqual({ web: { port: 3000, host: 'localhost' } });
      expect(body.company.name).toBe('Acme');
      expect(body.company.autoApproveSkills).toBe(false);
      expect(body.company.similarityThreshold).toBe(0.8);
      expect(body.company.skillApproval).toEqual({
        confidenceThreshold: 0.9,
        blockedTools: ['bash', 'write'],
      });
      expect(Object.keys(body.company.agents)).toEqual(['office', 'pm']);
    });
  });

  describe('PUT /pool', () => {
    it('updates maxWarmSessions and leaves sibling sections intact', async () => {
      const res = await app.request('/settings/pool', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxWarmSessions: 12 }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toMatch(/maxWarmSessions:\s*12/);
      // Comments + flow-style scalars survive.
      expect(onDisk).toContain('# top-level comment');
      expect(onDisk).toContain('# alpha-specific note');
      expect(onDisk).toContain('{ in: 3.0, out: 15.0 }');
      expect(onDisk).toContain('classifierThreshold: 0.7');
    });

    it('returns 400 on negative maxWarmSessions', async () => {
      const res = await app.request('/settings/pool', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxWarmSessions: -1 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues?: unknown[] };
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('returns 412 on stale If-Match', async () => {
      const res = await app.request('/settings/pool', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"stale"' },
        body: JSON.stringify({ maxWarmSessions: 12 }),
      });
      expect(res.status).toBe(412);
    });
  });

  describe('PUT /chat', () => {
    it('persists classifierThreshold within [0,1]', async () => {
      const res = await app.request('/settings/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classifierThreshold: 0.55 }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toMatch(/classifierThreshold:\s*0\.55/);
    });

    it('rejects classifierThreshold > 1', async () => {
      const res = await app.request('/settings/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classifierThreshold: 1.5 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /interfaces', () => {
    it('updates web.port', async () => {
      const res = await app.request('/settings/interfaces', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ web: { port: 4242, host: 'localhost' } }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toMatch(/port:\s*4242/);
    });
  });

  describe('PUT /costs', () => {
    it('preserves trailing per-row comments when updating existing model rates (review #5)', async () => {
      // Augment the fixture with a trailing comment that would be wiped if
      // the route replaced the whole `costs:` node instead of per-key edits.
      const dir2 = mkdtempSync(join(tmpdir(), 'settings-costs-comments-'));
      const configPath2 = join(dir2, 'pragents.yaml');
      try {
        writeFileSync(
          configPath2,
          `company:\n  name: "Acme"\ncosts:\n  anthropic/claude-sonnet: { in: 3.0, out: 15.0 } # GA pricing\n`,
          'utf8',
        );
        const app2 = new Hono().route(
          '/settings',
          createSettingsRoute({ configPath: configPath2 }),
        );
        const res = await app2.request('/settings/costs', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            'anthropic/claude-sonnet': { in: 4, out: 16 },
          }),
        });
        expect(res.status).toBe(200);
        const onDisk = readFileSync(configPath2, 'utf8');
        expect(onDisk).toContain('# GA pricing');
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    });

    it('adds a new model row while keeping existing models', async () => {
      const res = await app.request('/settings/costs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          'anthropic/claude-sonnet': { in: 3, out: 15 },
          'openai/gpt-4o': { in: 2.5, out: 10 },
        }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('openai/gpt-4o');
    });

    it('rejects negative rates (CostRate is non-negative)', async () => {
      const res = await app.request('/settings/costs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'openai/x': { in: -1, out: 1 } }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects non-numeric in/out with 400', async () => {
      const res = await app.request('/settings/costs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'openai/x': { in: 'oops', out: 1 } }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /skill-approval', () => {
    it('updates company.skillApproval without touching sibling fields', async () => {
      const res = await app.request('/settings/skill-approval', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confidenceThreshold: 0.95,
          blockedTools: ['bash', 'write', 'computer'],
        }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toMatch(/confidenceThreshold:\s*0\.95/);
      expect(onDisk).toContain('computer');
      // Sibling company fields preserved.
      expect(onDisk).toContain('name: "Acme"');
      expect(onDisk).toMatch(/office:/);
    });

    it('rejects confidenceThreshold > 1', async () => {
      const res = await app.request('/settings/skill-approval', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confidenceThreshold: 2, blockedTools: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /company', () => {
    it('updates name + autoApproveSkills + similarityThreshold, keeps nested blocks', async () => {
      const res = await app.request('/settings/company', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Acme Renamed',
          autoApproveSkills: true,
          similarityThreshold: 0.6,
        }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('Acme Renamed');
      expect(onDisk).toMatch(/autoApproveSkills:\s*true/);
      expect(onDisk).toMatch(/similarityThreshold:\s*0\.6/);
      // Nested agents + skillApproval intact.
      expect(onDisk).toMatch(/office:/);
      expect(onDisk).toMatch(/confidenceThreshold:\s*0\.9/);
    });

    it('rejects empty name', async () => {
      const res = await app.request('/settings/company', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /company/agents/:agentType', () => {
    it('updates the office agent personality', async () => {
      const res = await app.request('/settings/company/agents/office', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-3-5',
          personality: 'Refined office helper',
        }),
      });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).toContain('Refined office helper');
      // PM block untouched.
      expect(onDisk).toMatch(/pm:\s*\n\s*type: pm/);
    });

    it('rejects unknown agent type', async () => {
      const res = await app.request('/settings/company/agents/dev', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 412 on stale If-Match', async () => {
      const res = await app.request('/settings/company/agents/office', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'If-Match': 'W/"stale"' },
        body: JSON.stringify({ model: 'anthropic/claude-haiku-3-5' }),
      });
      expect(res.status).toBe(412);
    });
  });

  describe('DELETE /company/agents/:agentType', () => {
    it('removes the pm agent and keeps office intact', async () => {
      const res = await app.request('/settings/company/agents/pm', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const onDisk = readFileSync(configPath, 'utf8');
      expect(onDisk).not.toMatch(/pm:\s*\n\s*type: pm/);
      expect(onDisk).toMatch(/office:/);
    });

    it('returns 404 when the agent slot is empty', async () => {
      // First remove pm, then try again
      await app.request('/settings/company/agents/pm', { method: 'DELETE' });
      const res = await app.request('/settings/company/agents/pm', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('Watcher suppression (R17 / AE7)', () => {
    it('every mutating endpoint suppresses the watcher exactly once', async () => {
      const spy = vi.spyOn(loader, 'suppressWatcherChange');

      await app.request('/settings/pool', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxWarmSessions: 5 }),
      });
      await app.request('/settings/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classifierThreshold: 0.42 }),
      });
      await app.request('/settings/interfaces', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ web: { port: 4000, host: 'localhost' } }),
      });
      await app.request('/settings/costs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'x/y': { in: 1, out: 2 } }),
      });
      await app.request('/settings/skill-approval', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confidenceThreshold: 0.5, blockedTools: [] }),
      });
      await app.request('/settings/company', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme Two' }),
      });
      await app.request('/settings/company/agents/office', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'm' }),
      });
      await app.request('/settings/company/agents/office', { method: 'DELETE' });

      const calls = spy.mock.calls.filter((c) => c[0] === configPath);
      expect(calls.length).toBe(8);
      spy.mockRestore();
    });
  });

  describe('Malformed JSON returns 400', () => {
    const endpoints: Array<{ url: string; method: 'PUT' | 'DELETE' }> = [
      { url: '/settings/pool', method: 'PUT' },
      { url: '/settings/chat', method: 'PUT' },
      { url: '/settings/interfaces', method: 'PUT' },
      { url: '/settings/costs', method: 'PUT' },
      { url: '/settings/skill-approval', method: 'PUT' },
      { url: '/settings/company', method: 'PUT' },
      { url: '/settings/company/agents/office', method: 'PUT' },
    ];
    for (const e of endpoints) {
      it(`${e.method} ${e.url} rejects non-JSON body with 400`, async () => {
        const res = await app.request(e.url, {
          method: e.method,
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        });
        expect(res.status).toBe(400);
      });
    }
  });
});
