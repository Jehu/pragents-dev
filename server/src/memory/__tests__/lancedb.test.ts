import { describe, it, expect, afterAll } from 'vitest';
import { LanceDbVectorStore } from '../vector-store/lancedb.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LanceDbVectorStore', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pragents-lance-'));
  const store = new LanceDbVectorStore({ dimensions: 64 }, tmpDir);

  afterAll(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('adds and searches documents', async () => {
    await store.add('doc-1', 'TypeScript is a typed superset of JavaScript', {
      scope: 'project-a',
      category: 'tech',
      agentId: 'dev@a',
    });
    await store.add('doc-2', 'Python is great for data science', {
      scope: 'project-b',
      category: 'tech',
      agentId: 'dev@b',
    });

    const results = await store.search('JavaScript programming', { scope: 'project-a' }, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('doc-1');
    expect(results[0].content).toContain('TypeScript');
    expect(results[0].metadata.scope).toBe('project-a');
  });

  it('searches with filter', async () => {
    await store.add('doc-3', 'React is a UI framework for JavaScript', {
      scope: 'project-a',
      category: 'framework',
      agentId: 'dev@a',
    });

    // Filter by scope should exclude project-b docs
    const results = await store.search('JavaScript', { scope: 'project-a' }, 10);
    expect(results.every(r => r.metadata.scope === 'project-a')).toBe(true);
  });

  it('deletes documents', async () => {
    await store.add('doc-del', 'Temporary document to delete', {
      scope: 'test',
      category: 'temp',
      agentId: 'test',
    });

    const before = await store.search('Temporary', { scope: 'test' }, 5);
    expect(before.some(r => r.id === 'doc-del')).toBe(true);

    await store.delete('doc-del');

    const after = await store.search('Temporary', { scope: 'test' }, 5);
    expect(after.every(r => r.id !== 'doc-del')).toBe(true);
  });

  it('counts documents', async () => {
    const count = await store.count({ scope: 'project-a' });
    expect(count).toBeGreaterThanOrEqual(2); // doc-1 and doc-3
  });

  it('counts all documents without filter', async () => {
    const count = await store.count();
    expect(count).toBeGreaterThanOrEqual(3); // at least doc-1, doc-2, doc-3
  });

  it('returns empty results for non-matching search', async () => {
    const results = await store.search('quantum physics equations', { scope: 'nonexistent' }, 5);
    expect(results).toHaveLength(0);
  });

  it('upserts on duplicate add', async () => {
    await store.add('doc-upsert', 'Original content', {
      scope: 'upsert-test',
      category: 'test',
      agentId: 'test',
    });
    await store.add('doc-upsert', 'Updated content', {
      scope: 'upsert-test',
      category: 'test',
      agentId: 'test',
    });

    const results = await store.search('Updated', { scope: 'upsert-test' }, 5);
    // Should only have one record with updated content
    const upsertResults = results.filter(r => r.id === 'doc-upsert');
    expect(upsertResults).toHaveLength(1);
    expect(upsertResults[0].content).toBe('Updated content');
  });
});
