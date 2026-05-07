import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: 'running' | 'complete' | 'failed' | 'interrupted';
  params: any;
  triggerSourceRunId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowStepRow {
  id: string;
  runId: string;
  stepId: string;
  agentId: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export class WorkflowTracker {
  createRun(name: string, params?: any, triggerSourceRunId?: string): WorkflowRun {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO workflow_runs (id, workflow_name, status, params, trigger_source_run_id, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, name, 'running', params ? JSON.stringify(params) : null, triggerSourceRunId || null, now);
    return { id, workflowName: name, status: 'running', params, triggerSourceRunId: triggerSourceRunId || null, startedAt: now, completedAt: null };
  }

  createStep(runId: string, stepId: string, agentId?: string): WorkflowStepRow {
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO workflow_steps (id, run_id, step_id, agent_id, status) VALUES (?, ?, ?, ?, ?)',
    ).run(id, runId, stepId, agentId || null, 'pending');
    return { id, runId, stepId, agentId: agentId || null, status: 'pending', output: null, startedAt: null, completedAt: null };
  }

  startStep(stepId: string): void {
    getDb().prepare(
      "UPDATE workflow_steps SET status = 'running', started_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), stepId);
  }

  completeStep(stepId: string, output: string): void {
    getDb().prepare(
      "UPDATE workflow_steps SET status = 'complete', output = ?, completed_at = ? WHERE id = ?",
    ).run(output, new Date().toISOString(), stepId);
  }

  failStep(stepId: string, error: string): void {
    getDb().prepare(
      "UPDATE workflow_steps SET status = 'failed', output = ?, completed_at = ? WHERE id = ?",
    ).run(error, new Date().toISOString(), stepId);
  }

  skipStep(stepId: string): void {
    getDb().prepare(
      "UPDATE workflow_steps SET status = 'skipped' WHERE id = ?",
    ).run(stepId);
  }

  completeRun(runId: string): void {
    getDb().prepare(
      "UPDATE workflow_runs SET status = 'complete', completed_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), runId);
  }

  failRun(runId: string): void {
    getDb().prepare(
      "UPDATE workflow_runs SET status = 'failed', completed_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), runId);
  }

  getRun(runId: string): WorkflowRun | null {
    const row = getDb().prepare(
      `SELECT id, workflow_name as workflowName, status, params, trigger_source_run_id as triggerSourceRunId,
              started_at as startedAt, completed_at as completedAt FROM workflow_runs WHERE id = ?`,
    ).get(runId) as any;
    if (!row) return null;
    if (row.params) row.params = JSON.parse(row.params);
    return row;
  }

  getSteps(runId: string): WorkflowStepRow[] {
    return getDb().prepare(
      `SELECT id, run_id as runId, step_id as stepId, agent_id as agentId, status, output,
              started_at as startedAt, completed_at as completedAt FROM workflow_steps WHERE run_id = ? ORDER BY started_at`,
    ).all(runId) as any[];
  }

  listRuns(limit: number = 20): WorkflowRun[] {
    return getDb().prepare(
      `SELECT id, workflow_name as workflowName, status, params, trigger_source_run_id as triggerSourceRunId,
              started_at as startedAt, completed_at as completedAt FROM workflow_runs ORDER BY started_at DESC LIMIT ?`,
    ).all(limit) as any[];
  }

  recoverStaleRuns(): number {
    const db = getDb();
    const result = db.prepare(
      "UPDATE workflow_runs SET status = 'interrupted' WHERE status = 'running'",
    ).run();
    db.prepare(
      "UPDATE workflow_steps SET status = 'failed' WHERE status = 'running'",
    ).run();
    return result.changes;
  }
}
