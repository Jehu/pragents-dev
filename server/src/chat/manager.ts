import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logging/index.js';

export interface ChatMessage {
  id: number;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type: string | null;
  attachmentsJson: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  agentId: string | null;
  projectId: string | null;
  lastActivityAt: string;
  createdAt: string;
}

export interface AttachmentInput {
  name: string;
  mimeType: string;
  data: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class ConversationManager {
  private ttlMs: number;
  /**
   * In-memory index: agentId → conversationId.
   * Populated lazily on first getOrCreate call for a given agentId.
   * Acts as a fast cache in front of the DB lookup so that reconnecting
   * clients (new SSE connection, same agentId) recover their prior
   * conversation without round-tripping the database every time.
   */
  private agentConversationMap: Map<string, string> = new Map();

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private getDb() {
    return getDb();
  }

  /**
   * Return the conversationId to use for this request.
   *
   * Resolution order:
   *   1. If `conversationId` is supplied and exists in the DB → reuse it.
   *   2. If `agentId` is supplied → look up the most-recent active
   *      conversation for that agent in the DB (populated on first call);
   *      cache the result in `agentConversationMap`.
   *   3. Otherwise create a new conversation.
   *
   * When a new conversation is created and `agentId` is known, the map is
   * updated so that the next reconnect for the same agent reuses it.
   */
  getOrCreate(conversationId?: string, projectId?: string, agentId?: string): string {
    const db = this.getDb();

    // --- 1. Explicit conversationId supplied ---
    if (conversationId) {
      const existing = db
        .prepare('SELECT id FROM chat_conversations WHERE id = ?')
        .get(conversationId);
      if (existing) {
        // Keep the in-memory map in sync
        if (agentId) this.agentConversationMap.set(agentId, conversationId);
        return conversationId;
      }
      // Non-existent ID — graceful degradation: fall through to create new
      logger.warn({ conversationId }, 'ConversationManager: unknown conversationId, creating new');
    }

    // --- 2. agentId supplied — try to recover existing conversation ---
    if (agentId) {
      // Fast path: check the in-memory cache first
      const cached = this.agentConversationMap.get(agentId);
      if (cached) {
        const stillExists = db
          .prepare('SELECT id FROM chat_conversations WHERE id = ?')
          .get(cached);
        if (stillExists) return cached;
        // Cache is stale (e.g. TTL cleanup deleted it) — fall through
        this.agentConversationMap.delete(agentId);
      }

      // Slow path: look up the most-recent conversation for this agent in the DB
      const row = db
        .prepare(
          `SELECT id FROM chat_conversations
           WHERE agent_id = ?
           ORDER BY last_activity_at DESC
           LIMIT 1`,
        )
        .get(agentId) as { id: string } | undefined;

      if (row) {
        this.agentConversationMap.set(agentId, row.id);
        logger.debug({ agentId, conversationId: row.id }, 'ConversationManager: recovered conversation for agent');
        return row.id;
      }
    }

    // --- 3. Create a new conversation ---
    const id = randomUUID();
    const now = new Date().toISOString();
    const pid = projectId || null;
    const aid = agentId || null;

    db.prepare(
      'INSERT INTO chat_conversations (id, agent_id, project_id, last_activity_at, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, aid, pid, now, now);

    if (agentId) {
      this.agentConversationMap.set(agentId, id);
      logger.debug({ agentId, conversationId: id }, 'ConversationManager: new conversation for agent');
    }

    return id;
  }

  addMessage(
    convId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    type?: string,
    attachments?: AttachmentInput[],
  ): void {
    const db = this.getDb();
    const now = new Date().toISOString();
    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    db.prepare(
      `INSERT INTO chat_messages (conversation_id, role, content, type, attachments_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(convId, role, content, type || null, attachmentsJson, now);

    // Update last_activity_at
    db.prepare(
      'UPDATE chat_conversations SET last_activity_at = ? WHERE id = ?',
    ).run(now, convId);
  }

  getHistory(convId: string, limit: number = 50): ChatMessage[] {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT id, conversation_id as conversationId, role, content, type,
                attachments_json as attachmentsJson, created_at as createdAt
         FROM chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(convId, limit) as ChatMessage[];
    return rows;
  }

  getConversation(convId: string): Conversation | null {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT id, agent_id as agentId, project_id as projectId,
                last_activity_at as lastActivityAt, created_at as createdAt
         FROM chat_conversations WHERE id = ?`,
      )
      .get(convId) as Conversation | undefined;
    return row ?? null;
  }

  listRecent(limit: number = 20, projectId?: string, agentId?: string): Conversation[] {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT id, agent_id as agentId, project_id as projectId,
                last_activity_at as lastActivityAt, created_at as createdAt
         FROM chat_conversations
         WHERE (? IS NULL OR project_id = ?)
           AND (? IS NULL OR agent_id = ?)
         ORDER BY last_activity_at DESC
         LIMIT ?`,
      )
      .all(projectId ?? null, projectId ?? null, agentId ?? null, agentId ?? null, limit) as Conversation[];
    return rows;
  }

  expireStale(): number {
    const db = this.getDb();
    const cutoff = new Date(Date.now() - this.ttlMs).toISOString();

    // Collect agent_ids of conversations about to be deleted so we can
    // evict them from the in-memory map too.
    const stale = db
      .prepare(
        `SELECT id, agent_id FROM chat_conversations WHERE last_activity_at < ?`,
      )
      .all(cutoff) as Array<{ id: string; agent_id: string | null }>;

    const result = db
      .prepare(
        'DELETE FROM chat_conversations WHERE last_activity_at < ?',
      )
      .run(cutoff);

    // Evict stale entries from the in-memory agent→conversation map
    for (const row of stale) {
      if (row.agent_id) {
        const mapped = this.agentConversationMap.get(row.agent_id);
        if (mapped === row.id) {
          this.agentConversationMap.delete(row.agent_id);
        }
      }
    }

    return result.changes;
  }
}
