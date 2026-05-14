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

  getProjectCost(projectId: string, since?: string): { tokensIn: number; tokensOut: number; cost: number; calls: number } {
    const db = getDb();
    return db.prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as tokensIn, COALESCE(SUM(tokens_out), 0) as tokensOut,
              COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as calls
       FROM cost_log WHERE project_id = ? ${since ? "AND created_at >= ?" : ''}`,
    ).get(projectId, ...(since ? [since] : [])) as any;
  }

  getAgentCost(agentId: string): { tokensIn: number; tokensOut: number; cost: number; calls: number } {
    return getDb().prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as tokensIn, COALESCE(SUM(tokens_out), 0) as tokensOut,
              COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as calls FROM cost_log WHERE agent_id = ?`,
    ).get(agentId) as any;
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
