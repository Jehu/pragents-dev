import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../db/sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the SQL logic directly rather than through the full route stack
// (which requires a SkillRegistry file system setup).

function insertSkillUsedEvent(skillName: string, ts: string) {
  const db = getDb();
  db.prepare(
    "INSERT INTO events (project_id, agent_id, task_id, type, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
  ).run('p1', 'a1', null, 'skill.used', JSON.stringify({ skill: skillName }), ts);
}

function queryUsage(skillName: string, since?: string) {
  const db = getDb();
  const params: any[] = [skillName];
  let sinceClause = '';
  if (since) {
    sinceClause = ' AND timestamp >= ?';
    params.push(since);
  }
  return db.prepare(
    `SELECT COUNT(*) as usageCount, MAX(timestamp) as lastUsedAt
     FROM events
     WHERE type = 'skill.used' AND json_extract(data, '$.skill') = ?${sinceClause}`,
  ).get(...params) as { usageCount: number; lastUsedAt: string | null };
}

describe('skill usage counter queries', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-skill-usage-test-'));

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true });
  });

  it('returns 0 usage for unknown skill', () => {
    const result = queryUsage('nonexistent-skill');
    expect(result.usageCount).toBe(0);
    expect(result.lastUsedAt).toBeNull();
  });

  it('counts skill.used events by skill name', () => {
    insertSkillUsedEvent('my-skill', '2026-05-13T10:00:00.000Z');
    insertSkillUsedEvent('my-skill', '2026-05-13T11:00:00.000Z');
    insertSkillUsedEvent('other-skill', '2026-05-13T10:30:00.000Z');

    const result = queryUsage('my-skill');
    expect(result.usageCount).toBe(2);
    expect(result.lastUsedAt).toBe('2026-05-13T11:00:00.000Z');
  });

  it('does not count other event types', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO events (project_id, agent_id, task_id, type, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('p1', 'a1', null, 'skill.proposed', JSON.stringify({ skill: 'my-skill' }), '2026-05-13T12:00:00.000Z');

    const result = queryUsage('my-skill');
    // Should still be 2, not 3
    expect(result.usageCount).toBe(2);
  });

  it('respects since filter', () => {
    // events at 10:00 and 11:00 exist; filter from 11:30 → 0 results for my-skill
    const result = queryUsage('my-skill', '2026-05-13T11:30:00.000Z');
    expect(result.usageCount).toBe(0);

    // filter from 10:30 → only the 11:00 event
    const result2 = queryUsage('my-skill', '2026-05-13T10:30:00.000Z');
    expect(result2.usageCount).toBe(1);
  });

  it('correctly isolates skills by name via json_extract', () => {
    const result = queryUsage('other-skill');
    expect(result.usageCount).toBe(1);
  });
});
