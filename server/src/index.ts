import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadConfig } from './config/loader.js';
import { initDb, closeDb } from './db/sqlite.js';
import { MemoryEngine } from './memory/engine.js';
import { AgentSessionManager } from './agents/manager.js';
import { TaskTracker } from './tasks/tracker.js';
import { EventBuffer } from './events/buffer.js';
import { setupWebSocket } from './api/ws.js';
import { healthRoute } from './api/routes/health.js';
import { createTasksRoute } from './api/routes/tasks.js';
import { createProjectsRoute, createAgentsRoute } from './api/routes/projects.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const DATA_DIR = join(homedir(), '.pragents', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export async function startServer() {
  const { config, agents } = loadConfig();

  // Initialize database
  const dbPath = join(DATA_DIR, 'pragents.db');
  initDb(dbPath);

  // Recovery: mark stale running tasks as needs_review
  const tracker = new TaskTracker();
  const recovered = tracker.recoverStaleTasks();
  if (recovered > 0) {
    console.log(`Recovered ${recovered} stale task(s) — marked as needs_review`);
  }

  // Memory engine
  const memory = new MemoryEngine(config.company.memory?.short_term?.max_entries ?? 100);

  // Event buffer
  const eventBuffer = new EventBuffer(1000);

  // Agent session manager
  const sessionMgr = new AgentSessionManager(memory);
  sessionMgr.setEventCallback((event: any) => {
    eventBuffer.push(event.projectId, event.agentId, event.type, event.data);
  });

  // Build API
  const app = new Hono();

  // WebSocket
  setupWebSocket(app, eventBuffer);

  app.route('/', healthRoute);
  app.route('/api/v1/projects', createProjectsRoute(config));
  app.route('/api/v1/agents', createAgentsRoute(agents, sessionMgr));
  app.route('/api/v1/tasks', createTasksRoute(tracker, agents, sessionMgr));

  // Traces endpoint (read from event buffer)
  app.get('/api/v1/traces', (c) => {
    const projectId = c.req.query('project');
    return c.json(eventBuffer.getRecent(50, projectId || undefined));
  });
  app.get('/api/v1/traces/:id', (c) => {
    const events = eventBuffer.getSince(parseInt(c.req.param('id')) - 1);
    const event = events.find((e) => e.id === parseInt(c.req.param('id')));
    return event ? c.json(event) : c.json({ error: 'Trace not found' }, 404);
  });

  // Startup
  const port = config.interfaces.web.port;
  const host = config.interfaces.web.host;

  console.log(`pragents server starting on http://${host}:${port}`);
  console.log(`Company: ${config.company.name}`);
  console.log(`Projects: ${Object.keys(config.projects).length}`);
  console.log(`Agents: ${agents.length}`);

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`pragents ready — listening on http://${host}:${info.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await sessionMgr.disposeAll();
    closeDb();
    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, config, agents, tracker, sessionMgr, memory, eventBuffer };
}

startServer().catch((err) => {
  console.error('Failed to start pragents server:', err);
  process.exit(1);
});

