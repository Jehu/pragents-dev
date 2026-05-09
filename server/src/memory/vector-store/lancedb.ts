import { connect, type Connection, type Table } from '@lancedb/lancedb';
import type { VectorStore, ScoredDoc } from './interface.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

/**
 * Embedding function that calls an OpenAI-compatible API.
 * Falls back to a simple hash-based pseudo-embedding if no API is configured.
 */
async function getEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'text-embedding-3-small';

  if (!apiKey) {
    // Fallback: deterministic pseudo-embedding from text hash
    return pseudoEmbed(text, config.dimensions || 384);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let response: any;
  try {
    response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${err}`);
  }

  const data = await response.json() as any;
  return data.data[0].embedding;
}

/**
 * Deterministic pseudo-embedding for fallback when no API key is configured.
 * Uses a simple hash-based approach that produces consistent vectors.
 */
function pseudoEmbed(text: string, dimensions: number): number[] {
  const vec = new Float32Array(dimensions);
  const words = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (let j = 0; j < words[i].length; j++) {
      const idx = (i * 31 + j * 17 + words[i].charCodeAt(j)) % dimensions;
      vec[idx] += 1.0 / (i + 1);
    }
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, v => v / norm);
}

export interface EmbeddingConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}

interface LanceRecord {
  id: string;
  content: string;
  scope: string;
  category: string;
  agentId: string;
  vector: number[];
}

/**
 * LanceDB-backed vector store with real embedding-based semantic search.
 * Falls back to pseudo-embeddings if no embedding API is configured.
 */
export class LanceDbVectorStore implements VectorStore {
  private db: Connection | null = null;
  private table: Table | null = null;
  private config: EmbeddingConfig;
  private tableName = 'pragents_vectors';
  private initialized = false;

  constructor(config: EmbeddingConfig = {}, dbPath?: string) {
    this.config = config;
    this.dbPath = dbPath || join(homedir(), '.pragents', 'data', 'lancedb');
  }

  private dbPath: string;

  async init(): Promise<void> {
    if (this.initialized) return;

    mkdirSync(this.dbPath, { recursive: true });
    this.db = await connect(this.dbPath);

    const existingTables = await this.db.tableNames();
    if (existingTables.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName);
    }

    this.initialized = true;
  }

  private async ensureTable(): Promise<Table> {
    await this.init();
    if (!this.table) {
      // Create table with a seed record then delete it
      const seedRecord: LanceRecord = {
        id: '__seed__',
        content: '',
        scope: '',
        category: '',
        agentId: '',
        vector: new Array(this.config.dimensions || 384).fill(0),
      };
      this.table = await (this.db as any).createTable(this.tableName, [seedRecord]) as any;
      await (this.table as any).delete('id = \'__seed__\'');
    }
    return this.table!;
  }

  async add(id: string, content: string, metadata: Record<string, string>): Promise<void> {
    const vector = await getEmbedding(content, this.config);
    const table = await this.ensureTable();

    // Delete existing record with same id (upsert pattern)
    try {
      await table.delete(`id = '${id.replace(/'/g, "''")}'`);
    } catch {
      // Table may be empty
    }

    const record: LanceRecord = {
      id,
      content,
      scope: metadata.scope || '',
      category: metadata.category || '',
      agentId: metadata.agentId || '',
      vector,
    };

    await (table as any).add([record] as any);
  }

  async search(query: string, filter?: Record<string, string>, limit: number = 10): Promise<ScoredDoc[]> {
    const vector = await getEmbedding(query, this.config);
    const table = await this.ensureTable();

    let queryBuilder = table.search(vector).limit(limit);

    // Apply filters
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        const escaped = value.replace(/'/g, "''");
        queryBuilder = queryBuilder.where(`${key} = '${escaped}'`);
      }
    }

    const results = await queryBuilder.toArray();

    return results.map((r: any) => ({
      id: r.id as string,
      content: r.content as string,
      metadata: {
        scope: r.scope as string,
        category: r.category as string,
        agentId: r.agentId as string,
      },
      score: 1 - (r._distance as number), // Convert distance to similarity
    }));
  }

  async delete(id: string): Promise<void> {
    try {
      const table = await this.ensureTable();
      await table.delete(`id = '${id.replace(/'/g, "''")}'`);
    } catch {
      // OK if table doesn't exist
    }
  }

  async count(filter?: Record<string, string>): Promise<number> {
    try {
      const table = await this.ensureTable();
      // LanceDB doesn't have a direct count API, so we use a query
      let queryBuilder = table.query();
      if (filter) {
        for (const [key, value] of Object.entries(filter)) {
          const escaped = value.replace(/'/g, "''");
          queryBuilder = queryBuilder.where(`${key} = '${escaped}'`);
        }
      }
      const results = await queryBuilder.toArray();
      return results.length;
    } catch {
      return 0;
    }
  }
}

