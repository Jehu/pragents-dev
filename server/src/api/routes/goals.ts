import { Hono } from 'hono';
import type { Context } from 'hono';
import cron from 'croner';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { getDb } from '../../db/sqlite.js';
import type { GoalRegistry } from '../../goals/loader.js';
import type { GoalScheduler } from '../../goals/scheduler.js';
import { GoalDef } from '../../goals/schema.js';
import { computeEtag, EtagMismatchError } from '../../config/yaml-rw.js';
import { suppressWatcherChange } from '../../config/loader.js';
import { assertWithinRoot, PathOutOfBoundsError } from '../../security/paths.js';
import { logger } from '../../logging/index.js';

function nextRun(expr?: string): string | null {
  if (!expr) return null;
  try {
    const job = cron(expr, () => {});
    const next = job.nextRun();
    job.stop();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

function goalToJson(g: GoalDef) {
  return {
    id: g.id,
    description: g.description,
    cadence: g.cadence,
    deadline: g.deadline,
    workflow: g.workflow,
    acceptance: g.acceptance,
    warnBeforeMs: g.warn_before_ms,
    nextTriggerAt: nextRun(g.cadence),
    nextDeadlineAt: nextRun(g.deadline),
  };
}

function goalRunToJson(row: any) {
  return {
    id: row.id,
    goalId: row.goal_id,
    workflowRunId: row.workflow_run_id,
    status: row.status,
    triggeredAt: row.triggered_at,
    completedAt: row.completed_at,
  };
}

/** Goal ids double as filenames (`goals/<id>.yaml`) — same shape rule as workflow names. */
const GOAL_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

class GoalNotFoundError extends Error {
  constructor(id: string) {
    super(`Goal "${id}" not found`);
    this.name = 'GoalNotFoundError';
  }
}

/** Strip a UTF-8 BOM from operator-supplied YAML (same rationale as workflowFiles). */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function mapWriteError(c: Context, err: unknown) {
  if (err instanceof GoalNotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof EtagMismatchError) {
    return c.json({ error: err.message, expected: err.expected, actual: err.actual }, 412);
  }
  if (err instanceof PathOutOfBoundsError) {
    return c.json({ error: 'Goal id is not within the goals directory' }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'goals route failed');
  return c.json({ error: message }, 500);
}

/** Parse + schema-validate a YAML body; returns the def or a 400 response. */
function validateGoalContent(c: Context, content: string): { def: GoalDef } | { response: Response } {
  let parsedDoc: unknown;
  try {
    parsedDoc = parseYaml(content);
  } catch (err) {
    return {
      response: c.json(
        { error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` },
        400,
      ),
    };
  }
  const validated = GoalDef.safeParse(parsedDoc);
  if (!validated.success) {
    return { response: c.json({ error: 'Invalid goal definition', issues: validated.error.issues }, 400) };
  }
  return { def: validated.data };
}

export interface GoalsCrudOptions {
  /** Absolute path to the goals directory (repo-level `goals/`). */
  goalsDir: string;
  /**
   * Reloads the registry AND restarts the scheduler. Invoked after every
   * successful write so cron jobs never keep firing stale definitions.
   */
  reloadGoals: () => string[];
}

export function createGoalsRoute(registry: GoalRegistry, scheduler?: GoalScheduler, crud?: GoalsCrudOptions) {
  const r = new Hono();

  r.get('/', (c) => {
    const goals = registry.list().map(goalToJson);
    return c.json(goals);
  });

  // /runs must come before /:id
  r.get('/runs', (c) => {
    const goalId = c.req.query('goal');
    const db = getDb();
    const rows = goalId
      ? db.prepare('SELECT * FROM goal_runs WHERE goal_id = ? ORDER BY triggered_at DESC LIMIT 30').all(goalId)
      : db.prepare('SELECT * FROM goal_runs ORDER BY triggered_at DESC LIMIT 30').all();
    return c.json(rows.map(goalRunToJson));
  });

  r.get('/:id', (c) => {
    const goal = registry.get(c.req.param('id'));
    if (!goal) return c.json({ error: 'Goal not found' }, 404);
    return c.json(goalToJson(goal));
  });

  // ── File CRUD (only mounted when the server passes goalsDir + reloadGoals) ──
  if (crud) {
    const { goalsDir, reloadGoals } = crud;

    /** Resolve the on-disk path for a goal file, contained within goalsDir. */
    const goalPath = (filename: string): string =>
      assertWithinRoot(filename, goalsDir, { followSymlinks: existsSync(goalsDir) });

    // GET /:id/raw — original YAML text + ETag for the editor.
    r.get('/:id/raw', (c) => {
      const id = c.req.param('id');
      try {
        const file = registry.getFile(id);
        if (!file) throw new GoalNotFoundError(id);
        const filePath = goalPath(file);
        if (!existsSync(filePath)) throw new GoalNotFoundError(id);
        const content = readFileSync(filePath, 'utf8');
        const etag = computeEtag(content);
        c.header('ETag', etag);
        return c.json({ id, file, content, etag });
      } catch (err) {
        return mapWriteError(c, err);
      }
    });

    // POST / — body { content }. Filename derives from the validated goal id.
    r.post('/', async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== 'object') return c.json({ error: 'Body must be JSON' }, 400);
      const rawContent = (body as any).content;
      if (typeof rawContent !== 'string') return c.json({ error: '`content` must be a YAML string' }, 400);
      const content = stripBom(rawContent);
      const result = validateGoalContent(c, content);
      if ('response' in result) return result.response;
      const { def } = result;
      if (!GOAL_ID_RE.test(def.id)) {
        return c.json({ error: 'Invalid goal id (lowercase kebab-case identifier)' }, 400);
      }
      if (registry.get(def.id)) {
        return c.json({ error: `Goal "${def.id}" already exists` }, 409);
      }
      try {
        const filePath = goalPath(`${def.id}.yaml`);
        if (existsSync(filePath)) {
          return c.json({ error: `Goal file "${def.id}.yaml" already exists` }, 409);
        }
        suppressWatcherChange(filePath, 250);
        writeFileSync(filePath, content, 'utf8');
        reloadGoals();
        const etag = computeEtag(content);
        c.header('ETag', etag);
        logger.info({ goalId: def.id }, 'Goal created via API');
        return c.json({ id: def.id, etag }, 201);
      } catch (err) {
        return mapWriteError(c, err);
      }
    });

    // PUT /:id — body { content }, If-Match enforced. Renames are delete+create.
    r.put('/:id', async (c) => {
      const id = c.req.param('id');
      const ifMatch = c.req.header('If-Match');
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== 'object') return c.json({ error: 'Body must be JSON' }, 400);
      const rawContent = (body as any).content;
      if (typeof rawContent !== 'string') return c.json({ error: '`content` must be a YAML string' }, 400);
      const content = stripBom(rawContent);
      const result = validateGoalContent(c, content);
      if ('response' in result) return result.response;
      if (result.def.id !== id) {
        return c.json(
          { error: `Goal id in content ("${result.def.id}") must match the URL id ("${id}") — rename via delete + create` },
          400,
        );
      }
      try {
        const file = registry.getFile(id);
        if (!file) throw new GoalNotFoundError(id);
        const filePath = goalPath(file);
        if (!existsSync(filePath)) throw new GoalNotFoundError(id);
        if (ifMatch !== undefined) {
          const currentEtag = computeEtag(readFileSync(filePath, 'utf8'));
          if (currentEtag !== ifMatch) throw new EtagMismatchError(filePath, ifMatch, currentEtag);
        }
        suppressWatcherChange(filePath, 250);
        writeFileSync(filePath, content, 'utf8');
        reloadGoals();
        const etag = computeEtag(content);
        c.header('ETag', etag);
        logger.info({ goalId: id }, 'Goal updated via API');
        return c.json({ id, etag });
      } catch (err) {
        return mapWriteError(c, err);
      }
    });

    // DELETE /:id — If-Match enforced. goal_runs history rows are kept.
    r.delete('/:id', (c) => {
      const id = c.req.param('id');
      const ifMatch = c.req.header('If-Match');
      try {
        const file = registry.getFile(id);
        if (!file) throw new GoalNotFoundError(id);
        const filePath = goalPath(file);
        if (!existsSync(filePath)) throw new GoalNotFoundError(id);
        if (ifMatch !== undefined) {
          const currentEtag = computeEtag(readFileSync(filePath, 'utf8'));
          if (currentEtag !== ifMatch) throw new EtagMismatchError(filePath, ifMatch, currentEtag);
        }
        suppressWatcherChange(filePath, 250);
        unlinkSync(filePath);
        reloadGoals();
        logger.info({ goalId: id }, 'Goal deleted via API');
        return c.json({ deleted: true, id });
      } catch (err) {
        return mapWriteError(c, err);
      }
    });
  }

  r.post('/:id/run', async (c) => {
    if (!scheduler) return c.json({ error: 'Scheduler not available' }, 503);
    const id = c.req.param('id');
    try {
      const { goalRunId, workflowRunId } = await scheduler.runGoalById(id);
      return c.json({ goalRunId, workflowRunId, status: 'started' }, 202);
    } catch (err: any) {
      const msg = err?.message ?? 'unknown';
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      if (msg.includes('Cooldown') || msg.includes('already running')) return c.json({ error: msg }, 429);
      return c.json({ error: msg }, 500);
    }
  });

  return r;
}
