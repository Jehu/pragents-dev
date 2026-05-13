import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadConfig, watchConfig } from './config/loader.js';
import { initDb, closeDb, getDb } from './db/sqlite.js';
import { MemoryEngine } from './memory/engine.js';
import { AgentSessionManager } from './agents/manager.js';
import { ToolExecutor } from './agents/tool-executor.js';
import { TaskTracker } from './tasks/tracker.js';
import { EventBuffer } from './events/buffer.js';
import { WorkflowRegistry } from './workflows/loader.js';
import { WorkflowTracker } from './workflows/tracker.js';
import { WorkflowEngine } from './workflows/engine.js';
import { SkillRouter } from './routing/router.js';
import { setupWebSocket, broadcast } from './api/ws.js';
import { createEventsRoute, broadcastSSE } from './api/routes/events.js';
import { createHealthRoute } from './api/routes/health.js';
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
import { createFeedRoute } from './api/routes/feed.js';
import { createMemoryRoute } from './api/routes/memory.js';
import { SkillRegistry } from './skills/registry.js';
import { SkillExtractor } from './skills/extractor.js';
import { SkillAutoExtractor, createSemanticCompareFn } from './skills/auto-extractor.js';
import { createSkillsRoute } from './api/routes/skills.js';
import { createChatRoute } from './api/routes/chat.js';
import { ConversationManager } from './chat/manager.js';
import { IntentClassifier, shutdownClassifierSessions } from './chat/intent-classifier.js';
import { shutdownDecomposerSessions } from './nl/decomposer.js';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync, existsSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from './logging/index.js';

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
    logger.info({ path: envPath }, 'Env loaded');
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
  if (recovered > 0) logger.warn({ recovered }, 'Stale tasks recovered');
  if (wfRecovered > 0) logger.warn({ recovered: wfRecovered }, 'Stale workflow runs recovered');

  // Core services
  const memoryConfig = {
    maxEntries: config.company.memory?.short_term?.max_entries ?? 100,
    vectorStore: config.company.memory?.vectorStore ?? 'simple',
    embeddings: config.company.memory?.embeddings ? {
      apiKey: config.company.memory.embeddings.apiKey,
      baseUrl: config.company.memory.embeddings.baseUrl,
      model: config.company.memory.embeddings.model,
      dimensions: config.company.memory.embeddings.dimensions,
    } : undefined,
  };
  const memory = new MemoryEngine(memoryConfig);
  const eventBuffer = new EventBuffer(1000);
  const sessionMgr = new AgentSessionManager(memory);
  const router = new SkillRouter(agents);

  sessionMgr.setEventCallback((event: any) => {
    const evt = eventBuffer.push(event.projectId, event.agentId, event.type, event.data);
    broadcast(evt);
    broadcastSSE(evt);
    goalScheduler?.onEvent(evt);
  });

  // Workflow system
  const wfRegistry = new WorkflowRegistry();
  const wfDir = join(__dirname, '..', '..', 'workflows');
  const { loaded, warnings } = wfRegistry.load(wfDir);
  logger.info({ loaded: loaded.join(', ') || 'none' }, 'Workflows loaded');

  const goalRegistry = new GoalRegistry();
  const goalsDir = join(__dirname, '..', '..', 'goals');
  const { loaded: goalsLoaded, warnings: goalWarnings } = goalRegistry.load(goalsDir);
  logger.info({ loaded: goalsLoaded.join(', ') || 'none' }, 'Goals loaded');
  for (const w of warnings) logger.warn({ warning: w }, 'Workflow warning');

  // Skills system
  const skillsDir = process.env.PRAGENTS_SKILLS_DIR || join(homedir(), '.pragents', 'skills');
  const skillRegistry = new SkillRegistry(skillsDir);
  const { loaded: skillsLoaded, warnings: skillWarnings } = skillRegistry.load();
  logger.info({ loaded: skillsLoaded.join(', ') || 'none' }, 'Skills loaded');
  for (const w of skillWarnings) logger.warn({ warning: w }, 'Skill warning');
  const skillExtractor = new SkillExtractor(sessionMgr, agents);

  // Hot-reload: watch file changes and reload registries
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedReload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      logger.info('Hot-reload: file change detected, reloading registries...');
      const { loaded: wf } = wfRegistry.load(wfDir);
      const { loaded: gl } = goalRegistry.load(goalsDir);
      skillRegistry.load();
      logger.info({ workflows: wf.join(', ') || 'none', goals: gl.join(', ') || 'none' }, 'Registries reloaded');
    }, 1000);
  };
  for (const dir of [wfDir, goalsDir, skillsDir]) {
    try { watch(dir, debouncedReload); } catch {}
  }
  logger.info('Hot-reload watchers active');

  // Config hot-reload: mark affected agent sessions as stale on pragents.yaml change
  try {
    watchConfig((_agents, changedAgentIds) => {
      for (const agentId of changedAgentIds) {
        sessionMgr.markStale(agentId);
      }
      if (changedAgentIds.size > 0) {
        logger.info({ agentIds: [...changedAgentIds] }, 'Config reloaded — sessions marked stale');
      }
    });
  } catch {
    // Config file may not exist yet (e.g. in tests) — skip watcher
  }

  const wfEngine = new WorkflowEngine(wfTracker, router, sessionMgr, agents, eventBuffer);
  const decomposer = new NLDecomposer();
  const costTracker = new CostTracker(config.costs || {});
  sessionMgr.setCostTracker(costTracker);

  // Agent-native tooling (M6)
  const toolExecutor = new ToolExecutor({
    tracker,
    wfEngine,
    wfRegistry,
    wfTracker,
    memory,
    skills: skillRegistry,
    costTracker,
    agents,
    goalRegistry,
    eventBuffer,
    decomposer,
    sessionMgr,
  });
  sessionMgr.setToolExecutor(toolExecutor);

  // Goal scheduler
  const goalScheduler = new GoalScheduler(wfRegistry, wfEngine, eventBuffer, sessionMgr, agents);
  goalScheduler.start(goalRegistry.list());
  process.on('SIGTERM', () => goalScheduler.stop());
  process.on('SIGINT', () => goalScheduler.stop());

  // Auto-extraction: hooks into session disposal and PM monitor
  const autoApprove = config.company.autoApproveSkills ?? false;
  const similarityThreshold = config.company.similarityThreshold ?? 0.8;
  const skillApprovalCfg = config.company.skillApproval
    ? {
        confidenceThreshold: config.company.skillApproval.confidenceThreshold,
        blockedTools: config.company.skillApproval.blockedTools,
      }
    : undefined;
  const semanticCompare = createSemanticCompareFn(createAgentSession, DefaultResourceLoader, SessionManager);
  const skillAutoExtractor = new SkillAutoExtractor(
    skillExtractor,
    skillRegistry,
    eventBuffer,
    autoApprove,
    semanticCompare,
    similarityThreshold,
    skillApprovalCfg,
  );
  sessionMgr.setAutoExtractor(skillAutoExtractor);
  goalScheduler.setAutoExtractor(skillAutoExtractor);
  logger.info(`Auto-extraction enabled (autoApproveSkills: ${autoApprove})`);

  // Chat Protocol
  const conversationManager = new ConversationManager();
  const classifierModel = config.chat?.classifierModel;
  const classifierThreshold = config.chat?.classifierThreshold;
  if (classifierModel) {
    logger.info({ model: classifierModel }, 'IntentClassifier model override active');
  }
  if (classifierThreshold !== undefined) {
    logger.info({ threshold: classifierThreshold }, 'IntentClassifier confidence threshold configured');
  }
  const classifier = new IntentClassifier(agents, classifierModel, classifierThreshold);
  const chatRoute = createChatRoute(
    conversationManager,
    classifier,
    decomposer,
    toolExecutor,
    agents,
    eventBuffer,
    tracker,
  );

  // Build API
  const app = new Hono();
  const wsInject = await setupWebSocket(app, eventBuffer);
  if (wsInject) logger.info('WebSocket endpoint ready');

  app.route('/', createHealthRoute(memory));
  app.route('/api/v1/projects', createProjectsRoute(config));
  app.route('/api/v1/agents', createAgentsRoute(agents, sessionMgr));
  app.route('/api/v1/tasks', createTasksRoute(tracker, agents, sessionMgr, eventBuffer));
  app.route('/api/v1/workflows', createWorkflowsRoute(wfRegistry, wfEngine, wfTracker));
  app.route('/api/v1/nl', createNLRoutes(decomposer, agents, wfEngine));
  app.route('/api/v1/cost', createCostRoute(costTracker));
  app.route('/api/v1/goals', createGoalsRoute(goalRegistry));
  app.route('/api/v1/gates', createGatesRoute(eventBuffer));
  app.route('/api/v1/feed', createFeedRoute(tracker, eventBuffer, wfTracker, wfRegistry, skillRegistry));
  app.route('/api/v1/memory', createMemoryRoute(memory));
  app.route('/api/v1/skills', createSkillsRoute(skillRegistry, skillExtractor, eventBuffer));
  app.route('/api/v1/events', createEventsRoute(eventBuffer));
  app.route('/api/v1/chat', chatRoute);

  // Traces (read from persisted events table)
  app.get('/api/v1/traces', (c) => {
    const db = getDb();
    const taskId = c.req.query('taskId');
    const project = c.req.query('project');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
    const since = c.req.query('since');

    let sql = 'SELECT id, project_id as projectId, agent_id as agentId, task_id as taskId, type, data, timestamp FROM events WHERE 1=1';
    const params: any[] = [];

    if (taskId) { sql += ' AND task_id = ?'; params.push(taskId); }
    if (project) { sql += ' AND project_id = ?'; params.push(project); }
    if (since) { sql += ' AND timestamp > ?'; params.push(since); }

    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as any[];
    const events = rows.map((r: any) => ({
      ...r,
      data: r.data ? JSON.parse(r.data) : null,
    }));
    // Return in chronological order
    events.reverse();
    return c.json(events);
  });

  app.get('/api/v1/traces/:id', (c) => {
    const db = getDb();
    const row = db.prepare(
      'SELECT id, project_id as projectId, agent_id as agentId, task_id as taskId, type, data, timestamp FROM events WHERE id = ?',
    ).get(c.req.param('id')) as any;

    if (!row) return c.json({ error: 'Trace not found' }, 404);
    return c.json({
      ...row,
      data: row.data ? JSON.parse(row.data) : null,
    });
  });

  // Startup
  const port = config.interfaces.web.port;
  const host = config.interfaces.web.host;
  logger.info({ url: `http://${host}:${port}` }, 'pragents server starting');
  logger.info({ count: agents.length }, 'Agents loaded');

  const serveOptions: any = { fetch: app.fetch, port, hostname: host };
  const service = serve(serveOptions, (info) => {
    logger.info({ port: info.port, host }, 'Server ready');
  });

  if (wsInject) {
    wsInject(service);
    logger.info('WebSocket upgrade injected');
  }

  const shutdown = async () => {
    logger.info('Shutting down...');
    // Drain in-flight dispatches (up to 15s)
    const deadline = Date.now() + 15000;
    while (sessionMgr.getActiveAgents().length > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
    }
    await sessionMgr.disposeAll();
    await shutdownClassifierSessions();
    await shutdownDecomposerSessions();
    closeDb();
    logger.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Periodic idle session cleanup
  setInterval(() => { sessionMgr.disposeIdle(); }, 60000);

  // Periodic session_messages TTL cleanup (30 days)
  setInterval(() => {
    try {
      const db = getDb();
      const result = db.prepare(
        "DELETE FROM session_messages WHERE created_at < datetime('now', '-30 days')",
      ).run();
      if (result.changes > 0) {
        logger.info({ deleted: result.changes }, 'Session messages TTL cleanup');
      }
    } catch {}
  }, 6 * 60 * 60 * 1000);

  // Periodic events TTL cleanup (30 days)
  setInterval(() => {
    try {
      const db = getDb();
      const result = db.prepare(
        "DELETE FROM events WHERE timestamp < datetime('now', '-30 days')",
      ).run();
      if (result.changes > 0) {
        logger.info({ deleted: result.changes }, 'Events TTL cleanup');
      }
    } catch {}
  }, 6 * 60 * 60 * 1000);

  // Periodic chat conversation TTL cleanup (hourly)
  setInterval(() => {
    try {
      const deleted = conversationManager.expireStale();
      if (deleted > 0) {
        logger.info({ deleted }, 'Chat conversations TTL cleanup');
      }
    } catch {}
  }, 60 * 60 * 1000);

  return {
    app, config, agents, tracker, sessionMgr, memory, eventBuffer,
    wfRegistry, wfEngine, conversationManager,
  };
}

startServer().catch((err) => {
  logger.error({ err }, 'Failed to start pragents server');
  process.exit(1);
});
