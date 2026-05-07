import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadConfig } from './config/loader.js';
import { initDb, closeDb } from './db/sqlite.js';
import { MemoryEngine } from './memory/engine.js';
import { AgentSessionManager } from './agents/manager.js';
import { TaskTracker } from './tasks/tracker.js';
import { EventBuffer } from './events/buffer.js';
import { WorkflowRegistry } from './workflows/loader.js';
import { WorkflowTracker } from './workflows/tracker.js';
import { WorkflowEngine } from './workflows/engine.js';
import { SkillRouter } from './routing/router.js';
import { setupWebSocket } from './api/ws.js';
import { healthRoute } from './api/routes/health.js';
import { createTasksRoute } from './api/routes/tasks.js';
import { createProjectsRoute, createAgentsRoute } from './api/routes/projects.js';
import { createWorkflowsRoute } from './api/routes/workflows.js';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(homedir(), '.pragents', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export async function startServer() {
  const { config, agents } = loadConfig();

  // Initialize database
  const dbPath = join(DATA_DIR, 'pragents.db');
  initDb(dbPath);

  // Recovery
  const tracker = new TaskTracker();
  const wfTracker = new WorkflowTracker();
  const recovered = tracker.recoverStaleTasks();
  const wfRecovered = wfTracker.recoverStaleRuns();
  if (recovered > 0) console.log(`Recovered ${recovered} stale task(s)`);
  if (wfRecovered > 0) console.log(`Recovered ${wfRecovered} stale workflow run(s)`);

  // Core services
  const memory = new MemoryEngine(config.company.memory?.short_term?.max_entries ?? 100);
  const eventBuffer = new EventBuffer(1000);
  const sessionMgr = new AgentSessionManager(memory);
  const router = new SkillRouter(agents);

  sessionMgr.setEventCallback((event: any) => {
    eventBuffer.push(event.projectId, event.agentId, event.type, event.data);
  });

  // Workflow system
  const wfRegistry = new WorkflowRegistry();
  const wfDir = join(__dirname, '..', '..', 'workflows');
  const { loaded, warnings } = wfRegistry.load(wfDir);
  console.log(`Workflows loaded: ${loaded.join(', ') || 'none'}`);
  for (const w of warnings) console.warn(`Workflow warning: ${w}`);

  const wfEngine = new WorkflowEngine(wfTracker, router, sessionMgr, agents, eventBuffer);

  // Build API
  const app = new Hono();
  setupWebSocket(app, eventBuffer);

  app.route('/', healthRoute);
  app.route('/api/v1/projects', createProjectsRoute(config));
  app.route('/api/v1/agents', createAgentsRoute(agents, sessionMgr));
  app.route('/api/v1/tasks', createTasksRoute(tracker, agents, sessionMgr, eventBuffer));
  app.route('/api/v1/workflows', createWorkflowsRoute(wfRegistry, wfEngine, wfTracker));

  // Traces
  app.get('/api/v1/traces', (c) => {
    return c.json(eventBuffer.getRecent(50, c.req.query('project') || undefined));
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
  console.log(`Company: ${config.company.name} | Projects: ${Object.keys(config.projects).length} | Agents: ${agents.length}`);

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`pragents ready — listening on http://${host}:${info.port}`);
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    await sessionMgr.disposeAll();
    closeDb();
    console.log('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, config, agents, tracker, sessionMgr, memory, eventBuffer, wfRegistry, wfEngine };
}

startServer().catch((err) => {
  console.error('Failed to start pragents server:', err);
  process.exit(1);
});

