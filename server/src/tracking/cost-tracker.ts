import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

interface CostEntry {
  projectId: string;
  agentId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  taskId?: string;
}

export class CostTracker {
  private rates: Record<string, { in: number; out: number }>;

  constructor(rates?: Record<string, { in: number; out: number }>) {
    this.rates = rates || {};
  }

  private estimateCost(model: string, tokensIn: number, tokensOut: number): number {
    // Match by longest key first — prevents prefix over-matching (gpt-4o-mini vs gpt-4o)
    const sorted = Object.entries(this.rates).sort((a, b) => b[0].length - a[0].length);
    for (const [key, rate] of sorted) {
      if (model === key || model.startsWith(key + '/') || model.startsWith(key + '-')) {
        return (tokensIn / 1_000_000) * rate.in + (tokensOut / 1_000_000) * rate.out;
      }
    }
    return 0; // Unknown model = no cost estimate
  }

  record(entry: CostEntry): void {
    const db = getDb();
    const id = randomUUID();
    const cost = this.estimateCost(entry.model, entry.tokensIn, entry.tokensOut);
    db.prepare(
      'INSERT INTO cost_log (id, project_id, agent_id, model, tokens_in, tokens_out, cost_estimate, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, entry.projectId, entry.agentId, entry.model, entry.tokensIn, entry.tokensOut, cost, entry.taskId ?? null, new Date().toISOString());
  }

  // `since`, where supported, is exclusive (`created_at > since`) — it is a
  // budget-window boundary, and an operator reset must not count the usage
  // that triggered the lock as still being "after" the reset. Kept identical
  // across getProjectCost/getAgentCost so the two parallel methods can't drift
  // into off-by-one divergence when the pattern is reused.
  getProjectCost(projectId: string, since?: string): { tokensIn: number; tokensOut: number; cost: number; calls: number } {
    const db = getDb();
    return db.prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as tokensIn, COALESCE(SUM(tokens_out), 0) as tokensOut,
              COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as calls
       FROM cost_log WHERE project_id = ? ${since ? "AND created_at > ?" : ''}`,
    ).get(projectId, ...(since ? [since] : [])) as any;
  }

  /** See getProjectCost for the exclusive-`since` semantics shared by both. */
  getAgentCost(agentId: string, since?: string): { tokensIn: number; tokensOut: number; cost: number; calls: number } {
    return getDb().prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as tokensIn, COALESCE(SUM(tokens_out), 0) as tokensOut,
              COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as calls
       FROM cost_log WHERE agent_id = ? ${since ? 'AND created_at > ?' : ''}`,
    ).get(agentId, ...(since ? [since] : [])) as any;
  }

  /** Start of the current calendar-month budget window (UTC). */
  private currentMonthStart(): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }

  /**
   * Effective start of an agent's token-budget window: the later of the
   * current calendar month and any operator-triggered reset (#100 — a
   * lifetime-cumulative budget locked an agent out forever with no way
   * back in once crossed).
   */
  getBudgetWindowStart(agentId: string): string {
    const monthStart = this.currentMonthStart();
    const row = getDb()
      .prepare('SELECT reset_at FROM budget_resets WHERE agent_id = ?')
      .get(agentId) as { reset_at: string } | undefined;
    if (row && row.reset_at > monthStart) return row.reset_at;
    return monthStart;
  }

  /** Operator action: unblock an agent immediately instead of waiting for the monthly rollover. */
  resetAgentBudget(agentId: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO budget_resets (agent_id, reset_at) VALUES (?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET reset_at = excluded.reset_at`,
      )
      .run(agentId, now);
  }

  /** Usage vs. limit for an agent's current budget window — used by dispatch enforcement and the Agents UI. */
  getAgentBudgetStatus(
    agentId: string,
    tokenBudget: number,
  ): {
    used: number;
    tokensIn: number;
    tokensOut: number;
    calls: number;
    budget: number;
    remaining: number;
    percentUsed: number;
    windowStart: string;
    locked: boolean;
  } {
    const windowStart = this.getBudgetWindowStart(agentId);
    const usage = this.getAgentCost(agentId, windowStart);
    const used = (usage.tokensIn ?? 0) + (usage.tokensOut ?? 0);
    return {
      used,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      calls: usage.calls,
      budget: tokenBudget,
      remaining: Math.max(0, tokenBudget - used),
      percentUsed: tokenBudget > 0 ? Math.min(100, (used / tokenBudget) * 100) : 0,
      windowStart,
      locked: used >= tokenBudget,
    };
  }

  /**
   * Batch budget-lock check for the agents list, where only `.locked` is
   * needed. Avoids the per-agent getAgentBudgetStatus fan-out (2 queries
   * each): bounded to 1 + (distinct window starts) queries — normally 2
   * total, since resets are rare and most agents share the calendar-month
   * window. Returns only budgeted agents; callers default the rest to false.
   */
  getBudgetLockedMap(agents: { id: string; tokenBudget?: number }[]): Map<string, boolean> {
    const locked = new Map<string, boolean>();
    const budgeted = agents.filter(
      (a): a is { id: string; tokenBudget: number } => !!a.tokenBudget && a.tokenBudget > 0,
    );
    if (budgeted.length === 0) return locked;

    const db = getDb();
    const monthStart = this.currentMonthStart();
    const resets = new Map(
      (
        db.prepare('SELECT agent_id, reset_at FROM budget_resets').all() as {
          agent_id: string;
          reset_at: string;
        }[]
      ).map((r) => [r.agent_id, r.reset_at] as const),
    );

    // Group agents by their effective window start (month start, or a later
    // reset) so each distinct window costs one grouped SUM.
    const byWindow = new Map<string, { id: string; tokenBudget: number }[]>();
    for (const a of budgeted) {
      const reset = resets.get(a.id);
      const windowStart = reset && reset > monthStart ? reset : monthStart;
      const bucket = byWindow.get(windowStart);
      if (bucket) bucket.push(a);
      else byWindow.set(windowStart, [a]);
    }

    for (const [windowStart, group] of byWindow) {
      const placeholders = group.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT agent_id as agentId, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) as used
           FROM cost_log WHERE created_at > ? AND agent_id IN (${placeholders}) GROUP BY agent_id`,
        )
        .all(windowStart, ...group.map((a) => a.id)) as { agentId: string; used: number }[];
      const usedById = new Map(rows.map((r) => [r.agentId, r.used] as const));
      for (const a of group) {
        locked.set(a.id, (usedById.get(a.id) ?? 0) >= a.tokenBudget);
      }
    }

    return locked;
  }

  getMonthlyReport(): any[] {
    return getDb().prepare(
      `SELECT project_id, strftime('%Y-%m', created_at) as month,
              SUM(tokens_in) as tokensIn, SUM(tokens_out) as tokensOut,
              SUM(cost_estimate) as cost, COUNT(*) as calls
       FROM cost_log GROUP BY project_id, month ORDER BY month DESC, project_id`,
    ).all();
  }

  getDailyCost(date?: string, projectId?: string): { date: string; costEur: number; calls: number; tokensIn: number; tokensOut: number } {
    const db = getDb();
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const params: any[] = [targetDate];
    let where = "date(created_at) = ?";
    if (projectId) {
      where += ' AND project_id = ?';
      params.push(projectId);
    }
    const row = db.prepare(
      `SELECT COALESCE(SUM(cost_estimate), 0) as costEur,
              COUNT(*) as calls,
              COALESCE(SUM(tokens_in), 0) as tokensIn,
              COALESCE(SUM(tokens_out), 0) as tokensOut
       FROM cost_log WHERE ${where}`,
    ).get(...params) as any;
    return { date: targetDate, costEur: row.costEur, calls: row.calls, tokensIn: row.tokensIn, tokensOut: row.tokensOut };
  }

  getCostByModel(since?: string): { items: { model: string; costEur: number; calls: number; tokensIn: number; tokensOut: number }[] } {
    const db = getDb();
    const params: any[] = [];
    let where = '';
    if (since) {
      where = 'WHERE created_at >= ?';
      params.push(since);
    }
    const rows = db.prepare(
      `SELECT model,
              COALESCE(SUM(cost_estimate), 0) as costEur,
              COUNT(*) as calls,
              COALESCE(SUM(tokens_in), 0) as tokensIn,
              COALESCE(SUM(tokens_out), 0) as tokensOut
       FROM cost_log ${where}
       GROUP BY model ORDER BY costEur DESC`,
    ).all(...params) as any[];
    return { items: rows };
  }
}
