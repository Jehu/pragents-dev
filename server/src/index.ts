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
import { createAgentDetailRoute } from './api/routes/agents.js';
import { createWorkflowsRoute } from './api/routes/workflows.js';
import { NLDecomposer } from './nl/decomposer.js';
import { createNLRoutes } from './api/routes/nl.js';
import { PlanStore } from './plans/store.js';
import { PlanExecutor } from './plans/executor.js';
import { createPlansRoute } from './api/routes/plans.js';
import { CostTracker } from './tracking/cost-tracker.js';
import { createCostRoute } from './api/routes/cost.js';
import { GoalRegistry } from './goals/loader.js';
import { GoalScheduler } from './goals/scheduler.js';
import { createGoalsRoute } from './api/routes/goals.js';
import { createGatesRoute } from './api/routes/gates.js';
import { createFeedRoute } from './api/routes/feed.js';
import { createMemoryRoute } from './api/routes/memory.js';
import { createMetricsRoute } from './api/routes/metrics.js';
import { SkillRegistry } from './skills/registry.js';
import { SkillExtractor } from './skills/extractor.js';
import { SkillAutoExtractor, createSemanticCompareFn } from './skills/auto-extractor.js';
import { createSkillsRoute } from './api/routes/skills.js';
import { createSettingsRoute } from './api/routes/settings.js';
import { createWorkflowFilesRoute } from './api/routes/workflowFiles.js';
import { createFilesRoute } from './api/routes/files.js';
import { createChatRoute } from './api/routes/chat.js';
import { authMiddleware, getOrCreateApiToken } from './api/middleware/auth.js';
import { ConversationManager } from './chat/manager.js';
import { IntentClassifier, shutdownClassifierSessions } from './chat/intent-classifier.js';
import { shutdownDecomposerSessions } from './nl/decomposer.js';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { expandHome } from './util/paths.js';
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

  // Ensure an API token exists (generates + persists if missing)
  const apiToken = getOrCreateApiToken(envPath);

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
  const maxWarmSessions = config.pool?.maxWarmSessions ?? 10;
  const sessionMgr = new AgentSessionManager(memory, undefined, maxWarmSessions);
  const router = new SkillRouter(agents);

  sessionMgr.setEventCallback((event: any) => {
    const evt = eventBuffer.push(event.projectId, event.agentId, event.type, event.data);
    broadcast(evt);
    broadcastSSE(evt);
    goalScheduler?.onEvent(evt);
  });

  // Workflow system. The registry loads from two kinds of roots:
  //   1) the repo-level `<repo>/workflows/` directory (projectId = null)
  //   2) each configured project's `<projectDir>/<workflowDirectory>/`
  // Project-tagged entries let the global Workflows view link to the
  // per-project editor.
  const wfRegistry = new WorkflowRegistry();
  const wfDir = join(__dirname, '..', '..', 'workflows');
  const { loaded, warnings } = wfRegistry.load(wfDir, null);
  logger.info({ loaded: loaded.join(', ') || 'none' }, 'Workflows loaded');

  function projectWorkflowDir(projectId: string): string | null {
    const projectCfg = config.projects[projectId];
    if (!projectCfg) return null;
    return join(expandHome(projectCfg.directory), projectCfg.workflowDirectory);
  }

  function loadProjectWorkflows(projectId: string): void {
    const dir = projectWorkflowDir(projectId);
    if (!dir) return;
    wfRegistry.unloadProject(projectId);
    const { loaded: pLoaded, warnings: pWarn } = wfRegistry.load(dir, projectId);
    if (pLoaded.length > 0) {
      logger.info({ projectId, loaded: pLoaded.join(', ') }, 'Project workflows loaded');
    }
    for (const w of pWarn) logger.warn({ projectId, warning: w }, 'Project workflow warning');
  }

  for (const projectId of Object.keys(config.projects)) {
    loadProjectWorkflows(projectId);
  }

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
      wfRegistry.unloadRepo();
      const { loaded: wf } = wfRegistry.load(wfDir, null);
      for (const projectId of Object.keys(config.projects)) {
        loadProjectWorkflows(projectId);
      }
      const { loaded: gl } = goalRegistry.load(goalsDir);
      skillRegistry.load();
      logger.info({ workflows: wf.join(', ') || 'none', goals: gl.join(', ') || 'none' }, 'Registries reloaded');
    }, 1000);
  };
  for (const dir of [wfDir, goalsDir, skillsDir]) {
    try { watch(dir, debouncedReload); } catch {}
  }
  for (const projectId of Object.keys(config.projects)) {
    const dir = projectWorkflowDir(projectId);
    if (dir) {
      try { watch(dir, debouncedReload); } catch { /* dir may not exist yet */ }
    }
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
  const planStore = new PlanStore();
  const planExecutor = new PlanExecutor(planStore, wfEngine);
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

  // Boot-time safety: a config with zero projects collapses the chat route
  // into legacy-mode (no project-scope enforcement), which silently re-opens
  // the C1/C3 cross-project leak. Refuse to boot unless the operator has
  // explicitly acknowledged the no-projects setup via PRAGENTS_ALLOW_NO_PROJECTS=1.
  const configuredProjectIds = Object.keys(config.projects);
  if (configuredProjectIds.length === 0 && process.env.PRAGENTS_ALLOW_NO_PROJECTS !== '1') {
    logger.fatal(
      'config.projects is empty — chat/memory scope enforcement would be disabled. ' +
        'Add at least one project to pragents.yaml or set PRAGENTS_ALLOW_NO_PROJECTS=1 to opt into the legacy single-tenant fallback.',
    );
    process.exit(1);
  }

  const chatRoute = createChatRoute(
    conversationManager,
    classifier,
    decomposer,
    toolExecutor,
    agents,
    eventBuffer,
    tracker,
    planStore,
    configuredProjectIds,
  );

  // Build API
  const app = new Hono();

  // API token auth — guards /api/* (covers SSE at /api/v1/events/stream).
  // Localhost requests bypass. WebSocket has its own check (see setupWebSocket).
  const auth = authMiddleware(() => process.env.PRAGENTS_API_TOKEN || apiToken);
  app.use('/api/*', auth);

  const wsInject = await setupWebSocket(app, eventBuffer, () => process.env.PRAGENTS_API_TOKEN || apiToken);
  if (wsInject) logger.info('WebSocket endpoint ready');

  app.route('/api/v1', createHealthRoute(memory));
  const configPath = process.env.PRAGENTS_CONFIG_PATH || join(homedir(), '.pragents', 'pragents.yaml');
  app.route('/api/v1/projects', createProjectsRoute({ configPath, sessionMgr }));
  // Slice 4 / U11: per-project workflow files — mounted on the projects
  // sub-tree so URLs read `/api/v1/projects/:projectId/workflows[/:name]`.
  app.route(
    '/api/v1/projects',
    createWorkflowFilesRoute({
      configPath,
      onProjectWorkflowsChanged: (projectId) => loadProjectWorkflows(projectId),
    }),
  );
  const agentsRouter = createAgentsRoute(agents, sessionMgr);
  agentsRouter.route('/', createAgentDetailRoute(agents, sessionMgr, eventBuffer, tracker));
  app.route('/api/v1/agents', agentsRouter);
  app.route('/api/v1/tasks', createTasksRoute(tracker, agents, sessionMgr, eventBuffer));
  app.route('/api/v1/workflows', createWorkflowsRoute(wfRegistry, wfEngine, wfTracker));
  app.route('/api/v1/nl', createNLRoutes(decomposer, agents, planStore, planExecutor));
  app.route('/api/v1/plans', createPlansRoute(planStore, planExecutor));
  app.route('/api/v1/cost', createCostRoute(costTracker));
  app.route('/api/v1/goals', createGoalsRoute(goalRegistry, goalScheduler));
  app.route('/api/v1/gates', createGatesRoute(eventBuffer));
  app.route('/api/v1/feed', createFeedRoute(tracker, eventBuffer, wfTracker, wfRegistry, skillRegistry));
  app.route('/api/v1/memory', createMemoryRoute(memory, config));
  app.route('/api/v1/metrics', createMetricsRoute());
  app.route('/api/v1/skills', createSkillsRoute(skillRegistry, skillExtractor, eventBuffer));
  app.route('/api/v1/settings', createSettingsRoute({ configPath }));
  // Config-UI: file-metadata read for conflict detection (R12 / R18).
  // Allow-list includes the pragents config file, the skills root, and
  // each project's *workflow* subdirectory only — never the bare
  // project directory. Probing meta on arbitrary project files is not
  // a feature pragents needs to expose, and a `directory: ~` config
  // would otherwise widen the allow-list to the operator's whole
  // home tree.
  const workflowRoots: string[] = [];
  for (const projectCfg of Object.values(config.projects)) {
    const expandedDir = expandHome(projectCfg.directory);
    workflowRoots.push(join(expandedDir, projectCfg.workflowDirectory));
  }
  app.route(
    '/api/v1/files',
    createFilesRoute({
      allowedRoots: [configPath, skillsDir, ...workflowRoots],
    }),
  );
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

    if (taskId) {
      // Full UUID: exact match. 8+ char prefix: LIKE-prefix match (uses index).
      // Shorter prefixes are rejected to prevent bulk enumeration (SL-6).
      if (taskId.length >= 36) {
        sql += ' AND task_id = ?';
        params.push(taskId);
      } else if (taskId.length >= 8) {
        sql += ' AND task_id LIKE ?';
        params.push(taskId + '%');
      } else {
        return c.json({ error: 'taskId must be a full UUID or at least 8 characters' }, 400);
      }
    }
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

  // Pre-spawn keepWarm agent sessions (best-effort). Sequential awaits inside
  // the method avoid a RAM spike from many parallel pi sessions. Failures of
  // individual agents are logged but do not block server startup.
  sessionMgr.prewarmKeepWarmAgents(agents).catch((err) => {
    logger.warn({ err: err?.message || String(err) }, 'KeepWarm pre-spawn loop failed');
  });

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
