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
import { setupWebSocket, broadcast } from './api/ws.js';
import { healthRoute } from './api/routes/health.js';
import { createTasksRoute } from './api/routes/tasks.js';
import { createProjectsRoute, createAgentsRoute } from './api/routes/projects.js';
import { createWorkflowsRoute } from './api/routes/workflows.js';
import { NLDecomposer } from './nl/decomposer.js';
import { createNLRoutes } from './api/routes/nl.js';
import { CostTracker } from './tracking/cost-tracker.js';
import { createCostRoute } from './api/routes/cost.js';
import { GoalRegistry } from './goals/loader.js';
import { GoalScheduler } from './goals/scheduler.js';
import { createGoalsRoute } from './api/routes/goals.js';
import { createGatesRoute } from './api/routes/gates.js';
import { createMemoryRoute } from './api/routes/memory.js';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger, childLogger } from './logging/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(homedir(), '.pragents', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export async function startServer() {
  // Load .env from ~/.pragents/.env
  const envPath = join(homedir(), '.pragents', '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
    console.log(`Loaded env from ${envPath}`);
  }

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
    const evt = eventBuffer.push(event.projectId, event.agentId, event.type, event.data);
    broadcast(evt);
  });

  // Workflow system
  const wfRegistry = new WorkflowRegistry();
  const wfDir = join(__dirname, '..', '..', 'workflows');
  const { loaded, warnings } = wfRegistry.load(wfDir);
  console.log(`Workflows loaded: ${loaded.join(', ') || 'none'}`);

  const goalRegistry = new GoalRegistry();
  const goalsDir = join(__dirname, '..', '..', 'goals');
  const { loaded: goalsLoaded, warnings: goalWarnings } = goalRegistry.load(goalsDir);
  console.log(`Goals loaded: ${goalsLoaded.join(', ') || 'none'}`);
  for (const w of warnings) console.warn(`Workflow warning: ${w}`);

  const wfEngine = new WorkflowEngine(wfTracker, router, sessionMgr, agents, eventBuffer);
  const decomposer = new NLDecomposer();
  const costTracker = new CostTracker(config.costs || {});
  sessionMgr.setCostTracker(costTracker);

  // Goal scheduler
  const goalScheduler = new GoalScheduler(wfRegistry, wfEngine, eventBuffer, sessionMgr, agents);
  goalScheduler.start(goalRegistry.list());
  process.on('SIGTERM', () => goalScheduler.stop());
  process.on('SIGINT', () => goalScheduler.stop());

  // Build API
  const app = new Hono();
  const wsInject = await setupWebSocket(app, eventBuffer);
  if (wsInject) console.log('WebSocket endpoint ready');

  app.route('/', healthRoute);
  app.route('/api/v1/projects', createProjectsRoute(config));
  app.route('/api/v1/agents', createAgentsRoute(agents, sessionMgr));
  app.route('/api/v1/tasks', createTasksRoute(tracker, agents, sessionMgr, eventBuffer));
  app.route('/api/v1/workflows', createWorkflowsRoute(wfRegistry, wfEngine, wfTracker));
  app.route('/api/v1/nl', createNLRoutes(decomposer, agents, wfEngine));
  app.route('/api/v1/cost', createCostRoute(costTracker));
  app.route('/api/v1/goals', createGoalsRoute(goalRegistry));
  app.route('/api/v1/gates', createGatesRoute());
  app.route('/api/v1/memory', createMemoryRoute(memory));

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

  const serveOptions: any = { fetch: app.fetch, port, hostname: host };
  const service = serve(serveOptions, (info) => {
    console.log(`pragents ready — listening on http://${host}:${info.port}`);
  });

  if (wsInject) {
    wsInject(service);
    console.log('WebSocket upgrade injected');
  }

  const shutdown = async () => {
    console.log('\nShutting down...');
    await sessionMgr.disposeAll();
    closeDb();
    console.log('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Periodic idle session cleanup
  setInterval(() => { sessionMgr.disposeIdle(); }, 60000);

  return { app, config, agents, tracker, sessionMgr, memory, eventBuffer, wfRegistry, wfEngine };
}

startServer().catch((err) => {
  console.error('Failed to start pragents server:', err);
  process.exit(1);
});
