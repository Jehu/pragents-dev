import type { VectorStore, ScoredDoc } from './interface.js';

// In-memory vector store using simple TF-IDF-like scoring.
// Replace with LanceDB when embedding pipeline is ready.
export class SimpleVectorStore implements VectorStore {
  private docs: Map<string, { content: string; metadata: Record<string, string> }> = new Map();

  async add(id: string, content: string, metadata: Record<string, string>): Promise<void> {
    this.docs.set(id, { content, metadata });
  }

  async search(query: string, filter?: Record<string, string>, limit: number = 10): Promise<ScoredDoc[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: ScoredDoc[] = [];

    for (const [id, doc] of this.docs) {
      // Filter
      if (filter) {
        let match = true;
        for (const [key, value] of Object.entries(filter)) {
          if (doc.metadata[key] !== value) { match = false; break; }
        }
        if (!match) continue;
      }

      // Score: count matching terms, weighted by term frequency in doc
      const contentLower = doc.content.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = contentLower.match(regex);
        if (matches) score += matches.length;
      }
      // Bonus for title/keyword matches in short content
      score += (queryTerms.filter(t => doc.content.toLowerCase().includes(t)).length) * 0.5;

      if (score > 0 || queryTerms.length === 0) {
        results.push({ id, content: doc.content, metadata: doc.metadata, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.docs.delete(id);
  }

  async count(filter?: Record<string, string>): Promise<number> {
    if (!filter) return this.docs.size;
    let count = 0;
    for (const doc of this.docs.values()) {
      let match = true;
      for (const [key, value] of Object.entries(filter)) {
        if (doc.metadata[key] !== value) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  }
}
