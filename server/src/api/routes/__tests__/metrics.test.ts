import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, getDb } from '../../../db/sqlite.js';
import { createMetricsRoute, _resetMetricsCacheForTests } from '../metrics.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-metrics-test-'));

function resetDb() {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  mkdtempSync(tmpDir);
}

describe('Metrics API (/api/v1/metrics)', () => {
  beforeEach(() => {
    // Fresh DB per test so seeded counts are predictable
    closeDb();
    try { rmSync(join(tmpDir, 'test.db'), { force: true }); } catch {}
    initDb(join(tmpDir, 'test.db'));
    _resetMetricsCacheForTests();
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns nulls and notes when no data exists', async () => {
    const app = createMetricsRoute();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.skillSuccessRate).toBeNull();
    expect(body.memoryHitRate).toBeNull();
    expect(body.escalationsPerGoalRun).toBeNull();
    expect(body.tokensPerCompletedTask).toBeNull();
    expect(body.windowDays).toBe(7);
    expect(typeof body.computedAt).toBe('string');
    expect(body.notes.skillSuccessRate).toMatch(/no skill\.used events/);
    expect(body.notes.memoryHitRate).toMatch(/no memory\.recall events/);
    expect(body.notes.escalationsPerGoalRun).toMatch(/no goal_runs/);
    expect(body.notes.tokensPerCompletedTask).toMatch(/no completed tasks/);
  });

  it('computes memoryHitRate from memory.recall events', async () => {
    const db = getDb();
    // 4 events: 3 hits, 1 miss → 0.75
    const insert = db.prepare(
      "INSERT INTO events (project_id, agent_id, type, data) VALUES (?, ?, 'memory.recall', ?)",
    );
    insert.run('proj-a', 'dev', JSON.stringify({ hit: true, resultCount: 3 }));
    insert.run('proj-a', 'dev', JSON.stringify({ hit: true, resultCount: 1 }));
    insert.run('proj-a', 'dev', JSON.stringify({ hit: true, resultCount: 2 }));
    insert.run('proj-a', 'dev', JSON.stringify({ hit: false, resultCount: 0 }));

    const app = createMetricsRoute();
    const res = await app.request('/');
    const body = await res.json();
    expect(body.memoryHitRate).toBeCloseTo(0.75, 5);
  });

  it('computes skillSuccessRate linking skill.used events to task status', async () => {
    const db = getDb();
    // 3 skill.used events linked to tasks: 2 complete, 1 failed → 2/3
    db.prepare("INSERT INTO tasks (id, project_id, agent_id, status, description) VALUES (?, 'proj-a', 'dev', 'complete', 't1')").run('task-1');
    db.prepare("INSERT INTO tasks (id, project_id, agent_id, status, description) VALUES (?, 'proj-a', 'dev', 'complete', 't2')").run('task-2');
    db.prepare("INSERT INTO tasks (id, project_id, agent_id, status, description) VALUES (?, 'proj-a', 'dev', 'failed', 't3')").run('task-3');

    const insert = db.prepare(
      "INSERT INTO events (project_id, agent_id, task_id, type, data) VALUES (?, ?, ?, 'skill.used', ?)",
    );
    insert.run('proj-a', 'dev', 'task-1', JSON.stringify({ count: 3 }));
    insert.run('proj-a', 'dev', 'task-2', JSON.stringify({ count: 3 }));
    insert.run('proj-a', 'dev', 'task-3', JSON.stringify({ count: 3 }));

    const app = createMetricsRoute();
    const res = await app.request('/');
    const body = await res.json();
    expect(body.skillSuccessRate).toBeCloseTo(2 / 3, 5);
  });

  it('flags skill.used events with no linkable task_id', async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO events (project_id, agent_id, type, data) VALUES ('proj-a', 'dev', 'skill.used', '{}')",
    ).run();

    const app = createMetricsRoute();
    const res = await app.request('/');
    const body = await res.json();
    expect(body.skillSuccessRate).toBeNull();
    expect(body.notes.skillSuccessRate).toMatch(/none linked/);
  });

  it('computes escalationsPerGoalRun from tasks and goal_runs', async () => {
    const db = getDb();
    // 4 goal_runs, 1 escalation task → 0.25
    const grInsert = db.prepare(
      "INSERT INTO goal_runs (id, goal_id, status) VALUES (?, 'weekly-article', 'complete')",
    );
    grInsert.run('gr-1');
    grInsert.run('gr-2');
    grInsert.run('gr-3');
    grInsert.run('gr-4');

    db.prepare(
      "INSERT INTO tasks (id, project_id, agent_id, status, description, type) VALUES ('t-esc', 'proj-a', 'pm', 'complete', 'escalation', 'escalation')",
    ).run();

    const app = createMetricsRoute();
    const res = await app.request('/');
    const body = await res.json();
    expect(body.escalationsPerGoalRun).toBeCloseTo(0.25, 5);
  });

  it('computes tokensPerCompletedTask from cost_log over completed tasks', async () => {
    const db = getDb();
    // 2 completed tasks
    db.prepare("INSERT INTO tasks (id, project_id, agent_id, status, description) VALUES ('t-a', 'proj-a', 'dev', 'complete', 'x')").run();
    db.prepare("INSERT INTO tasks (id, project_id, agent_id, status, description) VALUES ('t-b', 'proj-a', 'dev', 'complete', 'y')").run();
    // 8000 total tokens
    const c = db.prepare(
      "INSERT INTO cost_log (id, project_id, agent_id, model, tokens_in, tokens_out, cost_estimate) VALUES (?, 'proj-a', 'dev', 'm', ?, ?, 0)",
    );
    c.run('c-1', 1000, 2000); // 3000
    c.run('c-2', 2000, 3000); // 5000

    const app = createMetricsRoute();
    const res = await app.request('/');
    const body = await res.json();
    expect(body.tokensPerCompletedTask).toBe(4000); // 8000 / 2
  });

  it('caches results for 30 seconds (second call returns same computedAt)', async () => {
    const app = createMetricsRoute();
    const res1 = await app.request('/');
    const body1 = await res1.json();
    const res2 = await app.request('/');
    const body2 = await res2.json();
    expect(body2.computedAt).toBe(body1.computedAt);
  });
});
