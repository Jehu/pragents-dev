import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../db/sqlite.js';
import { ConversationManager } from '../manager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ConversationManager', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-chat-mgr-'));
  let manager: ConversationManager;

  beforeAll(() => {
    initDb(join(tmpDir, 'test.db'));
    manager = new ConversationManager();
  });
  afterAll(() => { closeDb(); rmSync(tmpDir, { recursive: true }); });

  describe('getOrCreate', () => {
    it('creates a new conversation when no ID is provided', () => {
      const id = manager.getOrCreate();
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('returns existing conversation when valid ID is provided', () => {
      const id = manager.getOrCreate();
      const sameId = manager.getOrCreate(id);
      expect(sameId).toBe(id);
    });

    it('creates a new conversation when non-existent ID is provided (graceful degradation)', () => {
      const id = manager.getOrCreate('non-existent-id');
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      // Should not throw — graceful degradation
    });

    it('accepts an optional projectId', () => {
      const id = manager.getOrCreate(undefined, 'proj-abc');
      const conv = manager.getConversation(id);
      expect(conv).toBeTruthy();
      expect(conv!.projectId).toBe('proj-abc');
    });
  });

  describe('addMessage', () => {
    it('persists a user message', () => {
      const convId = manager.getOrCreate();
      manager.addMessage(convId, 'user', 'Hello agent!');

      const history = manager.getHistory(convId);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello agent!');
    });

    it('persists an assistant message with type', () => {
      const convId = manager.getOrCreate();
      manager.addMessage(convId, 'assistant', 'Here are your tasks', 'text');

      const history = manager.getHistory(convId);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('assistant');
      expect(history[0].type).toBe('text');
    });

    it('persists a system message', () => {
      const convId = manager.getOrCreate();
      manager.addMessage(convId, 'system', 'System note');

      const history = manager.getHistory(convId);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('system');
    });

    it('updates last_activity_at on each message', async () => {
      const convId = manager.getOrCreate();
      const before = manager.getConversation(convId)!.lastActivityAt;

      // Small delay to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 2));
      manager.addMessage(convId, 'user', 'msg');
      const after = manager.getConversation(convId)!.lastActivityAt;

      expect(after >= before).toBe(true);
      // After adding a message, last_activity_at should be at least as recent
      expect(after).not.toBe(before);
    });

    it('stores attachments as JSON', () => {
      const convId = manager.getOrCreate();
      const attachments = [
        { name: 'test.txt', mimeType: 'text/plain' as const, data: 'SGVsbG8=' },
      ];
      manager.addMessage(convId, 'user', 'Message with attachment', undefined, attachments);

      const history = manager.getHistory(convId);
      expect(history).toHaveLength(1);
      expect(history[0].attachmentsJson).toBeDefined();
      // The attachments are stored as JSON string
      const parsed = JSON.parse(history[0].attachmentsJson!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('test.txt');
    });
  });

  describe('getHistory', () => {
    it('returns messages in chronological order', () => {
      const convId = manager.getOrCreate();
      manager.addMessage(convId, 'user', 'first');
      manager.addMessage(convId, 'assistant', 'second');
      manager.addMessage(convId, 'user', 'third');

      const history = manager.getHistory(convId);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('first');
      expect(history[1].content).toBe('second');
      expect(history[2].content).toBe('third');
    });

    it('respects the limit parameter', () => {
      const convId = manager.getOrCreate();
      for (let i = 0; i < 10; i++) {
        manager.addMessage(convId, 'user', `msg ${i}`);
      }

      const history = manager.getHistory(convId, 5);
      expect(history).toHaveLength(5);
    });

    it('returns empty array for conversation with no messages', () => {
      const convId = manager.getOrCreate();
      const history = manager.getHistory(convId);
      expect(history).toEqual([]);
    });

    it('returns empty array for non-existent conversation', () => {
      const history = manager.getHistory('does-not-exist');
      expect(history).toEqual([]);
    });

    it('default limit is 50', () => {
      const convId = manager.getOrCreate();
      for (let i = 0; i < 55; i++) {
        manager.addMessage(convId, 'user', `msg ${i}`);
      }
      const history = manager.getHistory(convId);
      expect(history).toHaveLength(50);
    });
  });

  describe('getConversation', () => {
    it('returns conversation metadata', () => {
      const convId = manager.getOrCreate(undefined, 'proj-x');
      const conv = manager.getConversation(convId);

      expect(conv).toBeTruthy();
      expect(conv!.id).toBe(convId);
      expect(conv!.projectId).toBe('proj-x');
      expect(conv!.lastActivityAt).toBeTruthy();
      expect(conv!.createdAt).toBeTruthy();
    });

    it('returns null for non-existent conversation', () => {
      const conv = manager.getConversation('does-not-exist');
      expect(conv).toBeNull();
    });
  });

  describe('expireStale', () => {
    it('deletes conversations older than TTL (24h default)', () => {
      // Create a conversation and manually set its last_activity_at to > 24h ago
      const convId = manager.getOrCreate();
      const db = (manager as any).getDb();
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.prepare(
        'UPDATE chat_conversations SET last_activity_at = ? WHERE id = ?',
      ).run(staleDate, convId);

      const deleted = manager.expireStale();
      expect(deleted).toBe(1);

      // Conversation should be gone
      const conv = manager.getConversation(convId);
      expect(conv).toBeNull();

      // Messages should cascade delete
      const history = manager.getHistory(convId);
      expect(history).toEqual([]);
    });

    it('does not delete active conversations', () => {
      const convId = manager.getOrCreate();
      manager.addMessage(convId, 'user', 'active');

      const deleted = manager.expireStale();
      expect(deleted).toBe(0);

      const conv = manager.getConversation(convId);
      expect(conv).toBeTruthy();
    });

    it('returns count of deleted conversations', () => {
      // Create 2 stale conversations
      const staleIds = [manager.getOrCreate(), manager.getOrCreate()];
      const db = (manager as any).getDb();
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      for (const id of staleIds) {
        db.prepare(
          'UPDATE chat_conversations SET last_activity_at = ? WHERE id = ?',
        ).run(staleDate, id);
      }

      const deleted = manager.expireStale();
      expect(deleted).toBe(2);
    });

    it('cascade deletes all messages of expired conversations', () => {
      const convId = manager.getOrCreate();
      manager.addMessage(convId, 'user', 'msg 1');
      manager.addMessage(convId, 'assistant', 'msg 2');

      const db = (manager as any).getDb();
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.prepare(
        'UPDATE chat_conversations SET last_activity_at = ? WHERE id = ?',
      ).run(staleDate, convId);

      const { totalChanges } = db.prepare(
        'SELECT total_changes() as totalChanges',
      ).get() as any;

      manager.expireStale();

      const { totalChanges: after } = db.prepare(
        'SELECT total_changes() as totalChanges',
      ).get() as any;

      // Both messages + conversation deleted = 3 changes minimum
      expect(after - totalChanges).toBeGreaterThanOrEqual(3);
    });

    it('custom TTL can be configured via constructor', () => {
      const shortManager = new ConversationManager(1000); // 1 second TTL
      const convId = shortManager.getOrCreate();

      // Wait a bit and make it stale
      const db = (shortManager as any).getDb();
      const staleDate = new Date(Date.now() - 2000).toISOString();
      db.prepare(
        'UPDATE chat_conversations SET last_activity_at = ? WHERE id = ?',
      ).run(staleDate, convId);

      const deleted = shortManager.expireStale();
      expect(deleted).toBe(1);
    });
  });
});
