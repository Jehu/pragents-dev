import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export interface Fact {
  id: string;
  scope: string;
  category: string;
  content: string;
  agentId: string;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  agentId: string;
  compressedSummary: string | null;
  createdAt: string;
}

export class MemoryEngine {
  private shortTerm: ShortTermMemory;

  constructor(maxEntries: number = 100) {
    this.shortTerm = new ShortTermMemory(maxEntries);
  }

  // Long-term: facts
  remember(scope: string, category: string, content: string, agentId: string): Fact {
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?, ?, ?, ?, ?)',
    ).run(id, scope, category, content, agentId);
    return { id, scope, category, content, agentId, createdAt: new Date().toISOString() };
  }

  recall(query: string, scope: string, limit: number = 10): Fact[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, scope, category, content, agent_id as agentId, created_at as createdAt
         FROM facts WHERE scope = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(scope, `%${query}%`, limit) as Fact[];
    return rows;
  }

  forget(factId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM facts WHERE id = ?').run(factId);
  }

  // Short-term
  append(sessionId: string, entry: ShortTermEntry): void {
    this.shortTerm.append(sessionId, entry);
  }

  context(sessionId: string): ShortTermEntry[] {
    return this.shortTerm.get(sessionId);
  }

  // Compression
  compress(sessionId: string, agentId: string): SessionSummary | null {
    const entries = this.shortTerm.get(sessionId);
    if (entries.length === 0) return null;

    const summary = entries.map((e) => e.content).join('\n');
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO sessions (id, agent_id, compressed_summary) VALUES (?, ?, ?)',
    ).run(id, agentId, summary);

    this.shortTerm.clear(sessionId);
    return { id, agentId, compressedSummary: summary, createdAt: new Date().toISOString() };
  }

  clear(): void {
    this.shortTerm.clearAll();
  }
}

export interface ShortTermEntry {
  content: string;
  priority: number; // lower = evicted first
  timestamp: number;
}

class ShortTermMemory {
  private entries: Map<string, ShortTermEntry[]>;
  private maxEntries: number;

  constructor(maxEntries: number) {
    this.entries = new Map();
    this.maxEntries = maxEntries;
  }

  append(sessionId: string, entry: ShortTermEntry): void {
    let list = this.entries.get(sessionId);
    if (!list) {
      list = [];
      this.entries.set(sessionId, list);
    }
    list.push(entry);
    list.sort((a, b) => b.timestamp - a.timestamp);

    // Evict lowest priority entries if over limit
    while (list.length > this.maxEntries) {
      list.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);
      list.pop();
    }
  }

  get(sessionId: string): ShortTermEntry[] {
    return this.entries.get(sessionId) ?? [];
  }

  clear(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  clearAll(): void {
    this.entries.clear();
  }
}
