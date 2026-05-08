import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../../db/sqlite.js';
import { EventBuffer } from '../../../events/buffer.js';
import { createGatesRoute } from '../gates.js';
import { getDb } from '../../../db/sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Gates Route with EventBuffer', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-gates-test-'));
  let eventBuffer: EventBuffer;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    eventBuffer = new EventBuffer(100);
    // Seed a gate for testing
    getDb().prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)",
    ).run('gate-1', 'run-1', 'step-approval', 'Review deployment', new Date(Date.now() + 3600000).toISOString());
    getDb().prepare(
      "INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)",
    ).run('gate-2', 'run-2', 'step-check', 'Check SEO', new Date(Date.now() + 7200000).toISOString());
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  it('approve gate emits gate.approved event', async () => {
    const app = createGatesRoute(eventBuffer);
    const res = await app.request('/gate-1/approve', { method: 'POST' });
    expect(res.status).toBe(200);

    const events = eventBuffer.getSince(0);
    const approved = events.find(e => e.type === 'gate.approved');
    expect(approved).toBeDefined();
    expect(approved?.data.gateId).toBe('gate-1');
    expect(approved?.data.workflowRunId).toBe('run-1');
    expect(approved?.data.stepId).toBe('step-approval');
    expect(approved?.data.label).toBe('Review deployment');
  });

  it('reject gate emits gate.rejected event', async () => {
    const app = createGatesRoute(eventBuffer);
    const res = await app.request('/gate-2/reject', { method: 'POST' });
    expect(res.status).toBe(200);

    const events = eventBuffer.getSince(0);
    const rejected = events.find(e => e.type === 'gate.rejected');
    expect(rejected).toBeDefined();
    expect(rejected?.data.gateId).toBe('gate-2');
    expect(rejected?.data.workflowRunId).toBe('run-2');
  });

  it('approve on already approved gate returns 400, no duplicate event', async () => {
    const beforeCount = eventBuffer.getSince(0).filter(e => e.type === 'gate.approved').length;

    const app = createGatesRoute(eventBuffer);
    const res = await app.request('/gate-1/approve', { method: 'POST' });
    expect(res.status).toBe(400);

    const afterCount = eventBuffer.getSince(0).filter(e => e.type === 'gate.approved').length;
    expect(afterCount).toBe(beforeCount);
  });

  it('nonexistent gate returns 404', async () => {
    const app = createGatesRoute(eventBuffer);
    const res = await app.request('/nonexistent/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
