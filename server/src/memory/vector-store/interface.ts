export interface ScoredDoc {
  id: string;
  content: string;
  metadata: Record<string, string>;
  score: number;
}

export interface VectorStore {
  add(id: string, content: string, metadata: Record<string, string>): Promise<void>;
  search(query: string, filter?: Record<string, string>, limit?: number): Promise<ScoredDoc[]>;
  delete(id: string): Promise<void>;
  count(filter?: Record<string, string>): Promise<number>;
}
