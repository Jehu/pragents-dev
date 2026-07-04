import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { Plan, PlanCreate, PlanOrigin, PlanStatus } from './schema.js';

/**
 * Canonical row shape coming back from the `plans` table.
 * JSON columns are still strings here — the store unmarshals at the boundary.
 */
interface PlanRow {
  id: string;
  status: PlanStatus;
  origin: PlanOrigin;
  agent_id: string | null;
  project_id: string | null;
  conversation_id: string | null;
  prompt: string;
  steps_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

function rowToPlan(row: PlanRow): Plan {
  let steps: any[] = [];
  try {
    steps = JSON.parse(row.steps_json);
  } catch {
    steps = [];
  }
  let result: any = null;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = row.result_json;
    }
  }
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    agentId: row.agent_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    prompt: row.prompt,
    steps,
    result,
    error: row.error,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export interface ListPlansOptions {
  status?: PlanStatus;
  origin?: PlanOrigin;
  conversationId?: string;
  /**
   * Scope to one project. Plans without a project (e.g. chat-origin drafts)
   * are still included — same semantics as the event feed's scope filter,
   * where unscoped items belong to every scope.
   */
  projectId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Synchronous CRUD wrapper around the `plans` table. All callers MUST go
 * through this module — direct SQL against `plans` is forbidden so that the
 * status lifecycle invariants stay enforced in one place.
 */
export class PlanStore {
  private db() {
    return getDb();
  }

  create(input: PlanCreate): Plan {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db()
      .prepare(
        `INSERT INTO plans
          (id, status, origin, agent_id, project_id, conversation_id, prompt, steps_json, created_at)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.origin,
        input.agentId ?? null,
        input.projectId ?? null,
        input.conversationId ?? null,
        input.prompt,
        JSON.stringify(input.steps),
        now,
      );
    return this.get(id)!;
  }

  get(id: string): Plan | null {
    const row = this.db()
      .prepare('SELECT * FROM plans WHERE id = ?')
      .get(id) as PlanRow | undefined;
    return row ? rowToPlan(row) : null;
  }

  list(opts: ListPlansOptions = {}): Plan[] {
    const clauses: string[] = [];
    const params: any[] = [];
    if (opts.status) {
      clauses.push('status = ?');
      params.push(opts.status);
    }
    if (opts.origin) {
      clauses.push('origin = ?');
      params.push(opts.origin);
    }
    if (opts.conversationId) {
      clauses.push('conversation_id = ?');
      params.push(opts.conversationId);
    }
    if (opts.projectId) {
      clauses.push('(project_id = ? OR project_id IS NULL)');
      params.push(opts.projectId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const rows = this.db()
      .prepare(
        `SELECT * FROM plans ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as PlanRow[];
    return rows.map(rowToPlan);
  }

  /**
   * Transition a plan from draft -> approved. Returns the updated plan or
   * throws when the plan does not exist / is in a non-draft state.
   */
  approve(id: string): Plan {
    const existing = this.get(id);
    if (!existing) throw new Error(`Plan ${id} not found`);
    if (existing.status !== 'draft') {
      throw new Error(
        `Plan ${id} cannot be approved from status "${existing.status}" (expected draft)`,
      );
    }
    const now = new Date().toISOString();
    this.db()
      .prepare(
        "UPDATE plans SET status = 'approved', approved_at = ? WHERE id = ?",
      )
      .run(now, id);
    return this.get(id)!;
  }

  setExecuting(id: string): Plan {
    const now = new Date().toISOString();
    this.db()
      .prepare(
        "UPDATE plans SET status = 'executing', started_at = COALESCE(started_at, ?) WHERE id = ?",
      )
      .run(now, id);
    const out = this.get(id);
    if (!out) throw new Error(`Plan ${id} not found`);
    return out;
  }

  setDone(id: string, result: unknown): Plan {
    const now = new Date().toISOString();
    this.db()
      .prepare(
        "UPDATE plans SET status = 'done', result_json = ?, ended_at = ? WHERE id = ?",
      )
      .run(result == null ? null : JSON.stringify(result), now, id);
    const out = this.get(id);
    if (!out) throw new Error(`Plan ${id} not found`);
    return out;
  }

  setFailed(id: string, error: string, result?: unknown): Plan {
    const now = new Date().toISOString();
    this.db()
      .prepare(
        "UPDATE plans SET status = 'failed', error = ?, result_json = ?, ended_at = ? WHERE id = ?",
      )
      .run(error, result == null ? null : JSON.stringify(result), now, id);
    const out = this.get(id);
    if (!out) throw new Error(`Plan ${id} not found`);
    return out;
  }

  setCancelled(id: string): Plan {
    const now = new Date().toISOString();
    this.db()
      .prepare(
        "UPDATE plans SET status = 'cancelled', ended_at = ? WHERE id = ?",
      )
      .run(now, id);
    const out = this.get(id);
    if (!out) throw new Error(`Plan ${id} not found`);
    return out;
  }
}
