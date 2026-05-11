import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, getDb } from '../../db/sqlite.js';
import { GoalScheduler } from '../scheduler.js';
import type { ResolvedAgent } from '../../config/schema.js';

const mockPM: ResolvedAgent = {
  id: 'pm@company',
  projectId: 'company',
  type: 'pm',
  model: 'claude-sonnet',
  personality: 'You are a PM.',
  memory: { project: 'read', company: 'read/write' },
  skills: [],
  projectDir: '/tmp/test',
  tokenBudget: 30000,
};

describe('GoalScheduler pmCheck auto-extraction', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-scheduler-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  beforeEach(() => {
    // Clean sessions between tests
    getDb().exec('DELETE FROM sessions');
    getDb().exec('DELETE FROM session_messages');
  });

  function createMockDeps(autoExtractor?: any) {
    const mockSessionMgr = {
      getSessionMessages: vi.fn().mockReturnValue(null),
      dispatch: vi.fn().mockResolvedValue('OK'),
      setAutoExtractor: vi.fn(),
    };

    // Inject auto-extractor mock
    if (autoExtractor) {
      (mockSessionMgr as any).autoExtractor = autoExtractor;
    }

    return {
      wfRegistry: { get: vi.fn().mockReturnValue(null) } as any,
      wfEngine: { execute: vi.fn(), waitForGate: vi.fn() } as any,
      eventBuffer: { push: vi.fn(), getRecent: vi.fn().mockReturnValue([]), getSince: vi.fn().mockReturnValue([]) } as any,
      sessionMgr: mockSessionMgr as any,
      agents: [mockPM],
    };
  }

  it('scans ungeprüfte sessions and triggers tryExtract', async () => {
    const db = getDb();
    // Insert sessions with auto_extract_checked = 0
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sessions (id, agent_id, created_at, auto_extract_checked) VALUES (?, ?, ?, 0)',
    ).run('session-1', 'dev@test', now);
    db.prepare(
      'INSERT INTO sessions (id, agent_id, created_at, auto_extract_checked) VALUES (?, ?, ?, 0)',
    ).run('session-2', 'seo@test', now);

    // Insert session messages for eligibility
    const messages = JSON.stringify(Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    })));
    db.prepare(
      'INSERT INTO session_messages (id, session_id, messages_json, message_count) VALUES (?, ?, ?, ?)',
    ).run('msg-1', 'session-1', messages, 15);
    db.prepare(
      'INSERT INTO session_messages (id, session_id, messages_json, message_count) VALUES (?, ?, ?, ?)',
    ).run('msg-2', 'session-2', messages, 15);

    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    const deps = createMockDeps(mockAutoExtractor);
    // Override sessionMgr to return the real getSessionMessages
    deps.sessionMgr.getSessionMessages = vi.fn((sessionId: string) => {
      const row = db.prepare(
        'SELECT messages_json FROM session_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get(sessionId) as any;
      return row ? JSON.parse(row.messages_json) : null;
    });

    const scheduler = new GoalScheduler(
      deps.wfRegistry,
      deps.wfEngine,
      deps.eventBuffer,
      deps.sessionMgr,
      deps.agents,
    );

    // Manually call the auto-extract scan part
    await (scheduler as any).pmAutoExtractCheck(mockAutoExtractor);

    // Both sessions should be triggered
    expect(mockAutoExtractor.tryExtract).toHaveBeenCalledTimes(2);

    // Sessions should be marked as checked
    const session1 = db.prepare('SELECT auto_extract_checked FROM sessions WHERE id = ?').get('session-1') as any;
    const session2 = db.prepare('SELECT auto_extract_checked FROM sessions WHERE id = ?').get('session-2') as any;
    expect(session1.auto_extract_checked).toBe(1);
    expect(session2.auto_extract_checked).toBe(1);
  });

  it('skips already-checked sessions', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sessions (id, agent_id, created_at, auto_extract_checked) VALUES (?, ?, ?, 1)',
    ).run('session-3', 'dev@test', now);

    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    const deps = createMockDeps(mockAutoExtractor);
    const scheduler = new GoalScheduler(
      deps.wfRegistry,
      deps.wfEngine,
      deps.eventBuffer,
      deps.sessionMgr,
      deps.agents,
    );

    await (scheduler as any).pmAutoExtractCheck(mockAutoExtractor);

    // Already-checked sessions should not trigger
    expect(mockAutoExtractor.tryExtract).not.toHaveBeenCalled();
  });

  it('handles empty sessions gracefully', async () => {
    const mockAutoExtractor = {
      tryExtract: vi.fn().mockResolvedValue(undefined),
    };

    const deps = createMockDeps(mockAutoExtractor);
    const scheduler = new GoalScheduler(
      deps.wfRegistry,
      deps.wfEngine,
      deps.eventBuffer,
      deps.sessionMgr,
      deps.agents,
    );

    // No sessions in DB
    await expect(
      (scheduler as any).pmAutoExtractCheck(mockAutoExtractor),
    ).resolves.toBeUndefined();
    expect(mockAutoExtractor.tryExtract).not.toHaveBeenCalled();
  });
});
