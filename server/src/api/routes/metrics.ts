import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import { logger } from '../../logging/index.js';

/**
 * GET /api/v1/metrics — live-aggregated KPI dashboard (issue #22).
 *
 * Four objective KPIs, computed from existing tables (events, tasks, goal_runs, cost_log)
 * over a rolling 7-day window. Results are cached in-memory for 30 seconds to avoid
 * hammering SQLite on every UI poll.
 *
 * Returns `null` for any metric that genuinely cannot be computed (e.g. no signal events
 * in the window). Reasons surface via the `notes` map.
 */

const CACHE_TTL_MS = 30_000;
const WINDOW_DAYS = 7;

export interface MetricsResponse {
  skillSuccessRate: number | null;
  memoryHitRate: number | null;
  escalationsPerGoalRun: number | null;
  tokensPerCompletedTask: number | null;
  windowDays: number;
  computedAt: string;
  notes: Record<string, string>;
}

let cache: { value: MetricsResponse; expiresAt: number } | null = null;

/** Test-only: clear the cache between runs. */
export function _resetMetricsCacheForTests(): void {
  cache = null;
}

function computeMetrics(): MetricsResponse {
  const db = getDb();
  const notes: Record<string, string> = {};
  const windowExpr = `datetime('now', '-${WINDOW_DAYS} days')`;

  // 1) skillSuccessRate: fraction of skill.used events whose parent task ended 'complete'.
  //    Skill events lacking a task_id (best-effort emissions) count toward the denominator
  //    only when they can be linked — otherwise we mark them unattributable.
  let skillSuccessRate: number | null = null;
  try {
    const row = db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN t.status = 'complete' THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN e.task_id IS NULL THEN 1 ELSE 0 END) AS unlinked
       FROM events e
       LEFT JOIN tasks t ON t.id = e.task_id
       WHERE e.type = 'skill.used' AND e.timestamp > ${windowExpr}`,
    ).get() as { total: number; successes: number | null; unlinked: number | null };

    const total = row.total ?? 0;
    const linked = total - (row.unlinked ?? 0);
    if (linked > 0) {
      skillSuccessRate = (row.successes ?? 0) / linked;
    } else if (total > 0) {
      notes.skillSuccessRate = 'skill.used events present but none linked to a task — needs task_id propagation';
    } else {
      notes.skillSuccessRate = 'no skill.used events in window';
    }
  } catch (err) {
    logger.warn({ err }, 'metrics: skillSuccessRate query failed');
    notes.skillSuccessRate = 'query failed — see logs';
  }

  // 2) memoryHitRate: fraction of memory.recall events that returned >= 1 result.
  let memoryHitRate: number | null = null;
  try {
    const row = db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN json_extract(data, '$.hit') = 1 THEN 1 ELSE 0 END) AS hits
       FROM events
       WHERE type = 'memory.recall' AND timestamp > ${windowExpr}`,
    ).get() as { total: number; hits: number | null };

    const total = row.total ?? 0;
    if (total > 0) {
      memoryHitRate = (row.hits ?? 0) / total;
    } else {
      notes.memoryHitRate = 'no memory.recall events in window';
    }
  } catch (err) {
    logger.warn({ err }, 'metrics: memoryHitRate query failed');
    notes.memoryHitRate = 'query failed — see logs';
  }

  // 3) escalationsPerGoalRun: escalation-type tasks created vs. total goal_runs in window.
  let escalationsPerGoalRun: number | null = null;
  try {
    const escRow = db.prepare(
      `SELECT COUNT(*) AS escalations FROM tasks
       WHERE type = 'escalation' AND created_at > ${windowExpr}`,
    ).get() as { escalations: number };
    const grRow = db.prepare(
      `SELECT COUNT(*) AS runs FROM goal_runs
       WHERE triggered_at > ${windowExpr}`,
    ).get() as { runs: number };

    if ((grRow.runs ?? 0) > 0) {
      escalationsPerGoalRun = (escRow.escalations ?? 0) / grRow.runs;
    } else {
      notes.escalationsPerGoalRun = 'no goal_runs in window';
    }
  } catch (err) {
    logger.warn({ err }, 'metrics: escalationsPerGoalRun query failed');
    notes.escalationsPerGoalRun = 'query failed — see logs';
  }

  // 4) tokensPerCompletedTask: avg tokens (in+out) per completed task.
  //    cost_log doesn't carry a task_id, so we approximate by averaging cost_log rows
  //    over completed tasks in the same window — gives a meaningful per-task token cost.
  let tokensPerCompletedTask: number | null = null;
  try {
    const completed = db.prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE status = 'complete' AND updated_at > ${windowExpr}`,
    ).get() as { n: number };
    const tokens = db.prepare(
      `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total
       FROM cost_log WHERE created_at > ${windowExpr}`,
    ).get() as { total: number };

    if ((completed.n ?? 0) > 0) {
      tokensPerCompletedTask = Math.round((tokens.total ?? 0) / completed.n);
    } else {
      notes.tokensPerCompletedTask = 'no completed tasks in window';
    }
  } catch (err) {
    logger.warn({ err }, 'metrics: tokensPerCompletedTask query failed');
    notes.tokensPerCompletedTask = 'query failed — see logs';
  }

  return {
    skillSuccessRate,
    memoryHitRate,
    escalationsPerGoalRun,
    tokensPerCompletedTask,
    windowDays: WINDOW_DAYS,
    computedAt: new Date().toISOString(),
    notes,
  };
}

export function createMetricsRoute() {
  const r = new Hono();

  r.get('/', (c) => {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return c.json(cache.value);
    }
    const value = computeMetrics();
    cache = { value, expiresAt: now + CACHE_TTL_MS };
    return c.json(value);
  });

  return r;
}
