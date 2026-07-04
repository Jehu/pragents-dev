import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, closeDb } from '../../db/sqlite.js';
import { PlanStore } from '../store.js';

describe('PlanStore', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-plans-store-'));
  let store: PlanStore;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    store = new PlanStore();
  });
  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('create() inserts a draft plan and returns the row', () => {
    const plan = store.create({
      origin: 'nl',
      prompt: 'build a thing',
      steps: [{ description: 'do x', agentId: 'dev' }],
    });
    expect(plan.id).toBeTruthy();
    expect(plan.status).toBe('draft');
    expect(plan.origin).toBe('nl');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].description).toBe('do x');
    expect(plan.approvedAt).toBeNull();
    expect(plan.startedAt).toBeNull();
    expect(plan.endedAt).toBeNull();
  });

  it('get() returns null for unknown id', () => {
    expect(store.get('does-not-exist')).toBeNull();
  });

  it('get() roundtrips steps JSON', () => {
    const created = store.create({
      origin: 'chat',
      conversationId: 'c1',
      prompt: 'p',
      steps: [
        { description: 'a', agentId: 'dev' },
        { description: 'b', agentId: 'dev', dependsOn: 0 },
      ],
    });
    const fetched = store.get(created.id);
    expect(fetched?.steps).toHaveLength(2);
    expect(fetched?.steps[1].dependsOn).toBe(0);
    expect(fetched?.conversationId).toBe('c1');
  });

  it('approve() transitions draft -> approved and stamps approvedAt', () => {
    const created = store.create({
      origin: 'nl',
      prompt: 'p',
      steps: [{ description: 'a', agentId: 'dev' }],
    });
    const approved = store.approve(created.id);
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeTruthy();
  });

  it('approve() throws on unknown plan', () => {
    expect(() => store.approve('nope')).toThrow(/not found/);
  });

  it('approve() throws when plan is not in draft', () => {
    const created = store.create({
      origin: 'nl',
      prompt: 'p',
      steps: [{ description: 'a', agentId: 'dev' }],
    });
    store.approve(created.id);
    expect(() => store.approve(created.id)).toThrow(/cannot be approved/);
  });

  it('setExecuting() / setDone() / setFailed() / setCancelled() update status + timestamps', () => {
    const created = store.create({
      origin: 'nl',
      prompt: 'p',
      steps: [{ description: 'a', agentId: 'dev' }],
    });
    store.approve(created.id);

    const exec = store.setExecuting(created.id);
    expect(exec.status).toBe('executing');
    expect(exec.startedAt).toBeTruthy();

    const done = store.setDone(created.id, { runId: 'r1' });
    expect(done.status).toBe('done');
    expect(done.endedAt).toBeTruthy();
    expect(done.result).toEqual({ runId: 'r1' });

    // A second plan to test failure path
    const p2 = store.create({
      origin: 'nl',
      prompt: 'p',
      steps: [{ description: 'a', agentId: 'dev' }],
    });
    const failed = store.setFailed(p2.id, 'boom');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('boom');
    expect(failed.endedAt).toBeTruthy();

    const p3 = store.create({
      origin: 'nl',
      prompt: 'p',
      steps: [{ description: 'a', agentId: 'dev' }],
    });
    const cancelled = store.setCancelled(p3.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.endedAt).toBeTruthy();
  });

  it('list() filters by status, origin, and conversationId', () => {
    // Fresh-ish slice — we have many created above; filter by conversationId
    const convId = `conv-${Date.now()}`;
    store.create({
      origin: 'chat',
      conversationId: convId,
      prompt: 'a',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    store.create({
      origin: 'chat',
      conversationId: convId,
      prompt: 'b',
      steps: [{ description: 'x', agentId: 'dev' }],
    });

    const byConv = store.list({ conversationId: convId });
    expect(byConv.length).toBe(2);
    for (const p of byConv) {
      expect(p.conversationId).toBe(convId);
      expect(p.origin).toBe('chat');
    }

    const drafts = store.list({ status: 'draft', conversationId: convId });
    expect(drafts.length).toBe(2);

    const nlDrafts = store.list({ status: 'draft', origin: 'nl' });
    for (const p of nlDrafts) {
      expect(p.origin).toBe('nl');
      expect(p.status).toBe('draft');
    }
  });

  it('list() filters by projectId but keeps unscoped plans visible', () => {
    const projectId = `proj-${Date.now()}`;
    const scoped = store.create({
      origin: 'nl',
      projectId,
      prompt: 'scoped',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const otherProject = store.create({
      origin: 'nl',
      projectId: `${projectId}-other`,
      prompt: 'other',
      steps: [{ description: 'x', agentId: 'dev' }],
    });
    const unscoped = store.create({
      origin: 'chat',
      prompt: 'unscoped',
      steps: [{ description: 'x', agentId: 'dev' }],
    });

    const byProject = store.list({ projectId, limit: 200 });
    const ids = byProject.map((p) => p.id);
    expect(ids).toContain(scoped.id);
    expect(ids).toContain(unscoped.id);
    expect(ids).not.toContain(otherProject.id);
  });

  it('list() respects limit + offset', () => {
    const all = store.list({ limit: 200 });
    expect(all.length).toBeGreaterThan(0);
    const limited = store.list({ limit: 1 });
    expect(limited.length).toBe(1);
    const offset = store.list({ limit: 1, offset: 1 });
    expect(offset.length).toBe(1);
    expect(offset[0].id).not.toBe(limited[0].id);
  });
});
