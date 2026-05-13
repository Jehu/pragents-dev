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
    };
  }

  setRunning(taskId: string): void {
    getDb()
      .prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), taskId);
  }

  setComplete(taskId: string, result: string): void {
    getDb()
      .prepare("UPDATE tasks SET status = 'complete', result = ?, updated_at = ? WHERE id = ?")
      .run(result, new Date().toISOString(), taskId);
  }

  setFailed(taskId: string, error: string): void {
    getDb()
      .prepare("UPDATE tasks SET status = 'failed', result = ?, updated_at = ? WHERE id = ?")
      .run(error, new Date().toISOString(), taskId);
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

  get(taskId: string): Task | null {
    const row = getDb()
      .prepare(
        `SELECT id, project_id as projectId, agent_id as agentId, status, type, description, result, reason, external_ref as externalRef,
                created_at as createdAt, updated_at as updatedAt FROM tasks WHERE id = ?`,
      )
      .get(taskId) as Task | undefined;
    return row ?? null;
  }

  list(projectId?: string): Task[] {
    if (projectId) {
      return getDb()
        .prepare(
          `SELECT id, project_id as projectId, agent_id as agentId, status, type, description, result, reason, external_ref as externalRef,
                  created_at as createdAt, updated_at as updatedAt FROM tasks WHERE project_id = ?
           ORDER BY created_at DESC`,
        )
        .all(projectId) as Task[];
    }
    return getDb()
      .prepare(
        `SELECT id, project_id as projectId, agent_id as agentId, status, type, description, result, reason, external_ref as externalRef,
                created_at as createdAt, updated_at as updatedAt FROM tasks ORDER BY created_at DESC`,
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
