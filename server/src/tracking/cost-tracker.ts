import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

interface CostEntry {
  projectId: string;
  agentId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

// Approximate costs per 1M tokens (USD)
const MODEL_COSTS: Record<string, { in: number; out: number }> = {
  'anthropic/claude-sonnet-4-20250514': { in: 3.0, out: 15.0 },
  'anthropic/claude-sonnet-4': { in: 3.0, out: 15.0 },
  'anthropic/claude-haiku-3-5-20241022': { in: 0.8, out: 4.0 },
  'anthropic/claude-opus-4-20250514': { in: 15.0, out: 75.0 },
  default: { in: 3.0, out: 15.0 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS.default;
  return (tokensIn / 1_000_000) * rates.in + (tokensOut / 1_000_000) * rates.out;
}

export class CostTracker {
  record(entry: CostEntry): void {
    const db = getDb();
    const id = randomUUID();
    const cost = estimateCost(entry.model, entry.tokensIn, entry.tokensOut);
    db.prepare(
      'INSERT INTO cost_log (id, project_id, agent_id, model, tokens_in, tokens_out, cost_estimate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, entry.projectId, entry.agentId, entry.model, entry.tokensIn, entry.tokensOut, cost, new Date().toISOString());
  }

  getProjectCost(projectId: string, since?: string): { tokensIn: number; tokensOut: number; cost: number; calls: number } {
    const db = getDb();
    const row = db.prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as tokensIn, COALESCE(SUM(tokens_out), 0) as tokensOut,
              COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as calls
       FROM cost_log WHERE project_id = ? ${since ? "AND created_at >= ?" : ''}`,
    ).get(projectId, ...(since ? [since] : [])) as any;
    return row;
  }

  getAgentCost(agentId: string): { tokensIn: number; tokensOut: number; cost: number; calls: number } {
    const db = getDb();
    const row = db.prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as tokensIn, COALESCE(SUM(tokens_out), 0) as tokensOut,
              COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as calls
       FROM cost_log WHERE agent_id = ?`,
    ).get(agentId) as any;
    return row;
  }

  getMonthlyReport(): any[] {
    const db = getDb();
    return db.prepare(
      `SELECT project_id, strftime('%Y-%m', created_at) as month,
              SUM(tokens_in) as tokensIn, SUM(tokens_out) as tokensOut,
              SUM(cost_estimate) as cost, COUNT(*) as calls
       FROM cost_log GROUP BY project_id, month ORDER BY month DESC, project_id`,
    ).all();
  }
}
