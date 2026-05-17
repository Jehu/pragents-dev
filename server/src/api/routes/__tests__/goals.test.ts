import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, getDb, initDb } from '../../../db/sqlite.js';
import { createGoalsRoute } from '../goals.js';

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
