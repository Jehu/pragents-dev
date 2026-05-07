import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';

export const healthRoute = new Hono().get('/health', (c) => {
  let dbConnected = false;
  let dbSize = 0;
  try {
    const db = getDb();
    dbConnected = true;
    const row = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
    dbSize = row?.size ?? 0;
  } catch { /* db not initialized yet */ }

  return c.json({
    status: dbConnected ? 'ok' : 'degraded',
    uptime: process.uptime(),
    db: { connected: dbConnected, size: dbSize },
    agents_active: 0,
  });
});
