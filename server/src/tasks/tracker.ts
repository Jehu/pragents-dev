import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export type TaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'needs_review' | 'blocked';

export type TaskType = 'agent' | 'escalation';

export interface Task {
  id: string;
  projectId: string;
  agentId: string;
  status: TaskStatus;
  type: TaskType;
  description: string;
  result: string | null;
  reason: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  costEur: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number | null;
}

export interface TaskCreate {
  projectId: string;
  agentId: string;
  description: string;
  status?: TaskStatus;
  type?: TaskType;
}

export class TaskTracker {
  create(input: TaskCreate): Task {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const status = input.status ?? 'pending';
    const type = input.type ?? 'agent';

    db.prepare(
      'INSERT INTO tasks (id, project_id, agent_id, status, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.projectId, input.agentId, status, type, input.description, now, now);

    return {
      id,
      projectId: input.projectId,
      agentId: input.agentId,
      status,
      type,
      description: input.description,
      result: null,
      reason: null,
      externalRef: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      costEur: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: null,
    };
  }

  setRunning(taskId: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare("UPDATE tasks SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
      .run(now, now, taskId);
  }

  setComplete(taskId: string, result: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare("UPDATE tasks SET status = 'complete', result = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(result, now, now, taskId);
  }

  setFailed(taskId: string, error: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare("UPDATE tasks SET status = 'failed', result = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(error, now, now, taskId);
  }

  setNeedsReview(taskId: string, reason: string): void {
    getDb()
      .prepare("UPDATE tasks SET status = 'needs_review', reason = ?, updated_at = ? WHERE id = ?")
      .run(reason, new Date().toISOString(), taskId);
  }

  setBlocked(taskId: string, reason: string): void {
    getDb()
      .prepare("UPDATE tasks SET status = 'blocked', reason = ?, updated_at = ? WHERE id = ?")
      .run(reason, new Date().toISOString(), taskId);
  }

  setPending(taskId: string): void {
    getDb()
      .prepare("UPDATE tasks SET status = 'pending', reason = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), taskId);
  }

  private static readonly SELECT_COLS = `
    t.id, t.project_id as projectId, t.agent_id as agentId, t.status, t.type,
    t.description, t.result, t.reason, t.external_ref as externalRef,
    t.created_at as createdAt, t.updated_at as updatedAt,
    t.started_at as startedAt, t.completed_at as completedAt,
    COALESCE(c.costEur, 0) as costEur,
    COALESCE(c.tokensIn, 0) as tokensIn,
    COALESCE(c.tokensOut, 0) as tokensOut,
    CASE
      WHEN t.started_at IS NOT NULL AND t.completed_at IS NOT NULL
      THEN CAST((julianday(t.completed_at) - julianday(t.started_at)) * 86400000 AS INTEGER)
      ELSE NULL
    END as durationMs`;

  private static readonly COST_JOIN = `
    LEFT JOIN (
      SELECT task_id,
             COALESCE(SUM(cost_estimate), 0) as costEur,
             COALESCE(SUM(tokens_in), 0) as tokensIn,
             COALESCE(SUM(tokens_out), 0) as tokensOut
      FROM cost_log WHERE task_id IS NOT NULL GROUP BY task_id
    ) c ON c.task_id = t.id`;

  get(taskId: string): Task | null {
    const row = getDb()
      .prepare(
        `SELECT ${TaskTracker.SELECT_COLS} FROM tasks t ${TaskTracker.COST_JOIN} WHERE t.id = ?`,
      )
      .get(taskId) as Task | undefined;
    return row ?? null;
  }

  list(projectId?: string): Task[] {
    if (projectId) {
      return getDb()
        .prepare(
          `SELECT ${TaskTracker.SELECT_COLS} FROM tasks t ${TaskTracker.COST_JOIN}
           WHERE t.project_id = ? ORDER BY t.created_at DESC`,
        )
        .all(projectId) as Task[];
    }
    return getDb()
      .prepare(
        `SELECT ${TaskTracker.SELECT_COLS} FROM tasks t ${TaskTracker.COST_JOIN}
         ORDER BY t.created_at DESC`,
      )
      .all() as Task[];
  }

  recoverStaleTasks(): number {
    const db = getDb();
    const now = new Date().toISOString();
    const reason = `Server restarted at ${now}`;
    const result = db
      .prepare(
        "UPDATE tasks SET status = 'needs_review', reason = ?, updated_at = ? WHERE status = 'running'",
      )
      .run(reason, now);
    return result.changes;
  }
}
