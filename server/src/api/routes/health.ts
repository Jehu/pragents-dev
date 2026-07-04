import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { MemoryEngine } from '../../memory/engine.js';
import type { ResolvedAgent } from '../../config/schema.js';
import { checkModelHealth } from '../../agents/model-health.js';

export function createHealthRoute(memory?: MemoryEngine, agents?: ResolvedAgent[]) {
  return new Hono().get('/health', (c) => {
    let dbConnected = false;
    let dbSize = 0;
    try {
      const db = getDb();
      dbConnected = true;
      const row = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
      dbSize = row?.size ?? 0;
    } catch { /* db not initialized yet */ }

    const memoryInfo = memory
      ? { store: memory.storeName(), degraded: memory.isDegraded() }
      : { store: 'simple' as const, degraded: false };

    // Per-model provider health: an unusable configured model (unknown id or
    // missing API key) degrades overall status — a green badge over agents
    // that cannot run was the worst finding of the 2026-07-04 usability test.
    const models = agents ? checkModelHealth(agents) : [];
    const modelsOk = models.every((m) => m.ok);

    return c.json({
      status: dbConnected && modelsOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      db: { connected: dbConnected, size: dbSize },
      memory: memoryInfo,
      models,
      agents_active: 0,
    });
  });
}

/** @deprecated Use createHealthRoute(memory) instead */
export const healthRoute = createHealthRoute();
