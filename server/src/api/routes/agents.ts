import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { AgentSessionManager } from '../../agents/manager.js';
import type { EventBuffer } from '../../events/buffer.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { TaskTracker } from '../../tasks/tracker.js';
import { logger } from '../../logging/index.js';

/** Per-agent in-memory cache entry. */
interface CacheEntry {
  data: AgentDetailResponse;
  expiresAt: number;
}

interface AgentDetailResponse {
  id: string;
  type: string;
  projectId: string;
  model: string;
  skills: string[];
  status: 'busy' | 'idle' | 'offline';
  session: { id: string; startedAt: string; idleTimeoutMs: number; msUntilIdle: number } | null;
  stats: {
    tasksToday: number;
    tasksTodayComplete: number;
    avgLatencyP50Ms: number | null;
    costToday: number;
  };
  skillsLoaded: { name: string; jit: boolean }[];
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

function buildDetail(agent: ResolvedAgent, sessionMgr: AgentSessionManager): AgentDetailResponse {
  const db = getDb();

  // Today's task stats
  const taskStats = db.prepare(
    `SELECT
       COUNT(*) as tasksToday,
       COALESCE(SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END), 0) as tasksTodayComplete
     FROM tasks
     WHERE agent_id = ? AND date(created_at) = date('now')`,
  ).get(agent.id) as { tasksToday: number; tasksTodayComplete: number };

  // P50 latency from completed tasks today (durationMs via julianday diff)
  const latencyRows = db.prepare(
    `SELECT CAST((julianday(completed_at) - julianday(started_at)) * 86400000 AS INTEGER) as durationMs
     FROM tasks
     WHERE agent_id = ?
       AND date(created_at) = date('now')
       AND started_at IS NOT NULL
       AND completed_at IS NOT NULL
     ORDER BY durationMs`,
  ).all(agent.id) as { durationMs: number }[];

  let avgLatencyP50Ms: number | null = null;
  if (latencyRows.length > 0) {
    const mid = Math.floor(latencyRows.length / 2);
    avgLatencyP50Ms = latencyRows[mid].durationMs;
  }

  // Today's cost for this agent
  const costRow = db.prepare(
    `SELECT COALESCE(SUM(cost_estimate), 0) as costToday
     FROM cost_log
     WHERE agent_id = ? AND date(created_at) = date('now')`,
  ).get(agent.id) as { costToday: number };

  const session = sessionMgr.getSessionInfo(agent.id);

  // Skills loaded — map config skill names; none are JIT by default
  const skillsLoaded = agent.skills.map((name) => ({ name, jit: false }));

  return {
    id: agent.id,
    type: agent.type,
    projectId: agent.projectId,
    model: agent.model,
    skills: agent.skills,
    status: sessionMgr.getAgentStatus(agent.id),
    session,
    stats: {
      tasksToday: taskStats.tasksToday,
      tasksTodayComplete: taskStats.tasksTodayComplete,
      avgLatencyP50Ms,
      costToday: costRow.costToday,
    },
    skillsLoaded,
  };
}

export function createAgentDetailRoute(
  agents: ResolvedAgent[],
  sessionMgr: AgentSessionManager,
  eventBuffer: EventBuffer,
  tracker: TaskTracker,
) {
  const r = new Hono();

  // GET /api/v1/agents/:id
  r.get('/:id', (c) => {
    const agentId = c.req.param('id');
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json({ error: `Agent "${agentId}" not found` }, 404);

    const cached = cache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) {
      return c.json(cached.data);
    }

    const data = buildDetail(agent, sessionMgr);
    cache.set(agentId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return c.json(data);
  });

  // POST /api/v1/agents/:id/stop  (#63)
  r.post('/:id/stop', async (c) => {
    const agentId = c.req.param('id');
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return c.json({ error: `Agent "${agentId}" not found` }, 404);

    const status = sessionMgr.getAgentStatus(agentId);
    if (status === 'offline') {
      return c.json({ stopped: false, reason: 'no_active_session' });
    }

    // Mark any running tasks for this agent as failed
    const db = getDb();
    const runningTasks = db.prepare(
      "SELECT id FROM tasks WHERE agent_id = ? AND status = 'running'",
    ).all(agentId) as { id: string }[];

    for (const { id } of runningTasks) {
      tracker.setFailed(id, 'agent_stopped');
      eventBuffer.push(agent.projectId, agentId, 'task.failed', { taskId: id, error: 'agent_stopped' }, id);
    }

    // Invalidate cache
    cache.delete(agentId);

    const sessionId = await sessionMgr.stopAgent(agentId);

    eventBuffer.push(agent.projectId, agentId, 'agent.session_stopped', { agentId, sessionId });

    logger.info({ agentId, sessionId, runningTasksAborted: runningTasks.length }, 'Agent stopped via API');
    return c.json({ stopped: true, sessionId });
  });

  return r;
}
