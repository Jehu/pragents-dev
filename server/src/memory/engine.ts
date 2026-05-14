import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { VectorStore } from './vector-store/interface.js';
import { SimpleVectorStore } from './vector-store/simple.js';
import { LanceDbVectorStore, type EmbeddingConfig } from './vector-store/lancedb.js';
import { logger } from '../logging/index.js';
import type { ResolvedAgent } from '../config/schema.js';

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

export interface MemoryEngineConfig {
  maxEntries?: number;
  vectorStore?: 'simple' | 'lancedb';
  embeddings?: EmbeddingConfig;
}

export class MemoryEngine {
  private shortTerm: ShortTermMemory;
  private vectorStore: VectorStore;
  private _degraded: boolean = false;
  private _storeName: 'lancedb' | 'simple' = 'simple';

  constructor(config: number | MemoryEngineConfig = {}) {
    const opts = typeof config === 'number' ? { maxEntries: config } : config;
    this.shortTerm = new ShortTermMemory(opts.maxEntries ?? 100);

    // Select vector store based on config
    if (opts.vectorStore === 'lancedb') {
      try {
        this.vectorStore = new LanceDbVectorStore(opts.embeddings);
        this._storeName = 'lancedb';
        this._degraded = false;
      } catch (err) {
        logger.warn({ reason: 'LanceDB unavailable', err }, 'Memory running in degraded mode — using SimpleVectorStore. Recall quality reduced.');
        this.vectorStore = new SimpleVectorStore();
        this._storeName = 'simple';
        this._degraded = true;
      }
    } else {
      this.vectorStore = new SimpleVectorStore();
      this._storeName = 'simple';
      this._degraded = false;
    }
  }

  isDegraded(): boolean {
    return this._degraded;
  }

  storeName(): 'lancedb' | 'simple' {
    return this._storeName;
  }

  // Long-term: facts
  remember(scope: string, category: string, content: string, agentId: string, agentContext?: ResolvedAgent): Fact {
    if (agentContext) {
      const allowed = canWrite(agentContext, scope);
      if (!allowed) {
        logger.warn({ agentId: agentContext.id, scope }, 'Memory write blocked by scope policy');
        throw new Error('Memory scope violation');
      }
    }
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO facts (id, scope, category, content, agent_id) VALUES (?, ?, ?, ?, ?)',
    ).run(id, scope, category, content, agentId);
    // Index in vector store
    this.vectorStore.add(id, content, { scope, category, agentId }).catch(() => {});
    return { id, scope, category, content, agentId, createdAt: new Date().toISOString() };
  }

  async recall(query: string, scope: string, limit: number = 10, agentContext?: ResolvedAgent): Promise<Fact[]> {
    if (agentContext) {
      const allowed = canRead(agentContext, scope);
      if (!allowed) {
        logger.warn({ agentId: agentContext.id, scope }, 'Memory read blocked by scope policy');
        return [];
      }
    }
    const db = getDb();

    // Determine the SQL scope filter based on the scope argument:
    //   'all'     → no scope filter at all (returns facts from every scope)
    //   'company' → exact match on 'company'
    //   'agent'   → exact match on 'agent'
    //   anything  → treat as a project ID; include company-scope as cross-project visibility
    //   else
    let scopeFilter: string;
    let scopeParams: string[];
    if (scope === 'all') {
      scopeFilter = '1=1';
      scopeParams = [];
    } else if (scope === 'company' || scope === 'agent') {
      scopeFilter = 'scope = ?';
      scopeParams = [scope];
    } else {
      scopeFilter = "(scope = ? OR scope = 'company')";
      scopeParams = [scope];
    }
    const isProjectScope = scope !== 'company' && scope !== 'agent' && scope !== 'all';

    // Keyword search fallback (always runs — vector search is a *boost*, not a replacement)
    const sqlRows = db
      .prepare(
        `SELECT id, scope, category, content, agent_id as agentId, created_at as createdAt
         FROM facts WHERE ${scopeFilter} AND content LIKE ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...scopeParams, `%${query}%`, limit) as Fact[];

    // Vector search — supplement keyword hits with semantic matches.
    try {
      const vectorResults = scope === 'all' || isProjectScope
        ? await this.vectorStore.search(query, undefined, limit)
        : await this.vectorStore.search(query, { scope }, limit);

      const vectorFacts = vectorResults
        .filter((r) => {
          if (scope === 'all') return true;
          const metaScope = r.metadata.scope;
          return metaScope === scope || (isProjectScope && metaScope === 'company');
        })
        .map((r) => ({
          id: r.id, scope: r.metadata.scope || scope, category: r.metadata.category || '',
          content: r.content, agentId: r.metadata.agentId || '', createdAt: new Date().toISOString(),
        }));
      const seen = new Set(vectorFacts.map((f) => f.id));
      return [...vectorFacts, ...sqlRows.filter((f) => !seen.has(f.id))].slice(0, limit);
    } catch {
      return sqlRows;
    }
  }

  /**
   * Cross-project search: search company-scope facts visible to all projects.
   * Optionally also search specific project scopes.
   */
  async searchGlobal(query: string, options?: { includeProject?: string; limit?: number }): Promise<Fact[]> {
    const limit = options?.limit ?? 20;
    const includeProject = options?.includeProject;
    const db = getDb();

    const scopeFilter = includeProject
      ? `(scope = 'company' OR scope = ?)`
      : `scope = 'company'`;
    const params = includeProject
      ? [includeProject, `%${query}%`, limit]
      : [`%${query}%`, limit];

    const sqlRows = db
      .prepare(
        `SELECT id, scope, category, content, agent_id as agentId, created_at as createdAt
         FROM facts WHERE ${scopeFilter} AND content LIKE ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as Fact[];

    // Vector search for company scope
    try {
      const vectorResults = await this.vectorStore.search(query, { scope: 'company' }, limit);
      const vectorFacts = vectorResults.map(r => ({
        id: r.id, scope: r.metadata.scope || 'company', category: r.metadata.category || '',
        content: r.content, agentId: r.metadata.agentId || '', createdAt: new Date().toISOString(),
      }));
      const seen = new Set(vectorFacts.map(f => f.id));
      return [...vectorFacts, ...sqlRows.filter(f => !seen.has(f.id))].slice(0, limit);
    } catch {
      return sqlRows;
    }
  }

  async forget(factId: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM facts WHERE id = ?').run(factId);
    await this.vectorStore.delete(factId);
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

/**
 * Determine if an agent's memory policy allows writing to the given scope.
 *
 * - 'company' scope requires `memory.company === 'read/write'`
 * - 'agent' scope is always allowed (own private scope)
 * - any other scope is treated as a project scope and requires `memory.project === 'read/write'`
 */
function canWrite(agent: ResolvedAgent, scope: string): boolean {
  const mem = agent.memory;
  if (scope === 'company') {
    return mem.company === 'read/write';
  }
  if (scope === 'agent') {
    return true;
  }
  // project scope
  return mem.project === 'read/write';
}

/**
 * Determine if an agent's memory policy allows reading from the given scope.
 *
 * - 'company' scope requires `memory.company` to be set (read or read/write)
 * - 'agent' scope is always allowed (own private scope)
 * - any other scope is treated as a project scope and requires `memory.project` to be set
 */
function canRead(agent: ResolvedAgent, scope: string): boolean {
  const mem = agent.memory;
  if (scope === 'company') {
    return mem.company !== undefined;
  }
  if (scope === 'agent') {
    return true;
  }
  // project scope
  return mem.project !== undefined || mem.projects?.all !== undefined;
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
