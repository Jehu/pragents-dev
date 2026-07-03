import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, getDb, initDb } from '../../../db/sqlite.js';
import { createGoalsRoute } from '../goals.js';
import { GoalRegistry } from '../../../goals/loader.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-goals-route-test-'));

describe('Goals API', () => {
  beforeEach(() => {
    closeDb();
    try { rmSync(join(tmpDir, 'test.db'), { force: true }); } catch {}
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists goals as managed outcomes with next trigger metadata', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([
        {
          id: 'weekly-article',
          description: 'Publish one article per week',
          cadence: '0 8 * * 1',
          deadline: '0 16 * * 5',
          workflow: 'content-pipeline',
          acceptance: ['article is published'],
          human_gates: [{ step: 'after_draft', label: 'Review draft', timeout: '4h' }],
          warn_before_ms: 7200000,
        },
      ]),
      get: vi.fn(),
    };

    const app = createGoalsRoute(registry as any);
    const res = await app.request('/');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: 'weekly-article',
        description: 'Publish one article per week',
        workflow: 'content-pipeline',
        acceptance: ['article is published'],
        humanGates: [{ step: 'after_draft', label: 'Review draft', timeout: '4h' }],
        nextTriggerAt: expect.any(String),
        nextDeadlineAt: expect.any(String),
      }),
    ]);
  });

  it('lists goal runs using API-friendly camelCase fields', async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO goal_runs (id, goal_id, workflow_run_id, status, completed_at) VALUES ('gr-1', 'weekly-article', 'wf-1', 'complete', '2026-05-17T10:00:00.000Z')",
    ).run();

    const registry = { list: vi.fn().mockReturnValue([]), get: vi.fn() };
    const app = createGoalsRoute(registry as any);
    const res = await app.request('/runs');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: 'gr-1',
        goalId: 'weekly-article',
        workflowRunId: 'wf-1',
        status: 'complete',
        triggeredAt: expect.any(String),
        completedAt: '2026-05-17T10:00:00.000Z',
      }),
    ]);
  });
});

describe('Goals file CRUD', () => {
  const crudDbDir = mkdtempSync(join(tmpdir(), 'pragents-goals-crud-db-'));

  beforeEach(() => {
    closeDb();
    try { rmSync(join(crudDbDir, 'test.db'), { force: true }); } catch {}
    initDb(join(crudDbDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(crudDbDir, { recursive: true, force: true });
  });

  const VALID_YAML = [
    'id: tmp-goal',
    'description: temp goal',
    'cadence: "0 9 * * 1"',
    'workflow: content-pipeline',
    '',
  ].join('\n');

  function makeCrudApp() {
    const goalsDir = mkdtempSync(join(tmpdir(), 'pragents-goals-crud-'));
    const registry = new GoalRegistry();
    registry.load(goalsDir);
    // Mirrors the server's reloadGoals: real registry reload + scheduler-restart spy.
    const schedulerRestart = vi.fn();
    const reloadGoals = vi.fn(() => {
      const { loaded } = registry.load(goalsDir);
      schedulerRestart();
      return loaded;
    });
    const app = createGoalsRoute(registry, undefined, { goalsDir, reloadGoals });
    return { app, goalsDir, registry, reloadGoals, schedulerRestart };
  }

  it('POST creates the file, reloads the registry, and restarts the scheduler', async () => {
    const { app, goalsDir, registry, reloadGoals, schedulerRestart } = makeCrudApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('tmp-goal');
    expect(body.etag).toBeTruthy();
    expect(existsSync(join(goalsDir, 'tmp-goal.yaml'))).toBe(true);
    expect(registry.get('tmp-goal')?.workflow).toBe('content-pipeline');
    expect(reloadGoals).toHaveBeenCalledTimes(1);
    expect(schedulerRestart).toHaveBeenCalledTimes(1);
    rmSync(goalsDir, { recursive: true, force: true });
  });

  it('POST rejects duplicates, invalid YAML, schema failures, and path-shaped ids', async () => {
    const { app, goalsDir } = makeCrudApp();
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });

    const dup = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });
    expect(dup.status).toBe(409);

    const badYaml = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'id: [unclosed' }),
    });
    expect(badYaml.status).toBe(400);

    const badSchema = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'id: x-goal\ndescription: no cadence or workflow\n' }),
    });
    expect(badSchema.status).toBe(400);
    expect((await badSchema.json()).issues).toBeTruthy();

    const badId = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'id: ../evil\ndescription: t\ncadence: "0 9 * * 1"\nworkflow: wf\n',
      }),
    });
    expect(badId.status).toBe(400);
    rmSync(goalsDir, { recursive: true, force: true });
  });

  it('GET /:id/raw returns content + etag; 404 for unknown ids', async () => {
    const { app, goalsDir } = makeCrudApp();
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });

    const res = await app.request('/tmp-goal/raw');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe(VALID_YAML);
    expect(body.etag).toBe(res.headers.get('ETag'));
    expect(body.file).toBe('tmp-goal.yaml');

    const missing = await app.request('/nope/raw');
    expect(missing.status).toBe(404);
    rmSync(goalsDir, { recursive: true, force: true });
  });

  it('PUT enforces If-Match and id consistency', async () => {
    const { app, goalsDir, registry, schedulerRestart } = makeCrudApp();
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });
    const { etag } = await (await app.request('/tmp-goal/raw')).json();

    const stale = await app.request('/tmp-goal', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': 'wrong-etag' },
      body: JSON.stringify({ content: VALID_YAML.replace('temp goal', 'edited') }),
    });
    expect(stale.status).toBe(412);

    const renamed = await app.request('/tmp-goal', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ content: VALID_YAML.replace('tmp-goal', 'other-id') }),
    });
    expect(renamed.status).toBe(400);

    const ok = await app.request('/tmp-goal', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ content: VALID_YAML.replace('temp goal', 'edited') }),
    });
    expect(ok.status).toBe(200);
    expect(registry.get('tmp-goal')?.description).toBe('edited');
    expect(schedulerRestart).toHaveBeenCalledTimes(2); // POST + PUT
    rmSync(goalsDir, { recursive: true, force: true });
  });

  it('DELETE removes the file and registry entry; keeps goal_runs history', async () => {
    const { app, goalsDir, registry, schedulerRestart } = makeCrudApp();
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });
    const db = getDb();
    db.prepare(
      "INSERT INTO goal_runs (id, goal_id, status, triggered_at) VALUES ('gr-crud', 'tmp-goal', 'complete', datetime('now'))",
    ).run();
    const { etag } = await (await app.request('/tmp-goal/raw')).json();

    const stale = await app.request('/tmp-goal', { method: 'DELETE', headers: { 'If-Match': 'nope' } });
    expect(stale.status).toBe(412);

    const res = await app.request('/tmp-goal', { method: 'DELETE', headers: { 'If-Match': etag } });
    expect(res.status).toBe(200);
    expect(existsSync(join(goalsDir, 'tmp-goal.yaml'))).toBe(false);
    expect(registry.get('tmp-goal')).toBeUndefined();
    expect(schedulerRestart).toHaveBeenCalledTimes(2); // POST + DELETE
    const runs = db.prepare("SELECT COUNT(*) as n FROM goal_runs WHERE goal_id = 'tmp-goal'").get() as any;
    expect(runs.n).toBe(1);
    rmSync(goalsDir, { recursive: true, force: true });
  });

  it('CRUD endpoints are absent without crud options (legacy construction)', async () => {
    const registry = new GoalRegistry();
    const app = createGoalsRoute(registry as any);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_YAML }),
    });
    expect(res.status).toBe(404);
  });
});
