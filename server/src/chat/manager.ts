import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

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

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private getDb() {
    return getDb();
  }

  getOrCreate(conversationId?: string, projectId?: string): string {
    const db = this.getDb();

    if (conversationId) {
      // Check if conversation exists
      const existing = db
        .prepare('SELECT id FROM chat_conversations WHERE id = ?')
        .get(conversationId);
      if (existing) {
        return conversationId;
      }
      // Non-existent ID — graceful degradation: create new
    }

    const id = conversationId || randomUUID();
    const now = new Date().toISOString();
    const pid = projectId || null;

    db.prepare(
      'INSERT INTO chat_conversations (id, project_id, last_activity_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, pid, now, now);

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
        `SELECT id, project_id as projectId, last_activity_at as lastActivityAt,
                created_at as createdAt
         FROM chat_conversations WHERE id = ?`,
      )
      .get(convId) as Conversation | undefined;
    return row ?? null;
  }

  expireStale(): number {
    const db = this.getDb();
    const cutoff = new Date(Date.now() - this.ttlMs).toISOString();

    const result = db
      .prepare(
        'DELETE FROM chat_conversations WHERE last_activity_at < ?',
      )
      .run(cutoff);

    return result.changes;
  }
}
