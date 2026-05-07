import type { WorkflowDef, WorkflowStep } from './schema.js';
import { WorkflowTracker } from './tracker.js';
import { SkillRouter } from '../routing/router.js';
import type { AgentSessionManager } from '../agents/manager.js';
import type { ResolvedAgent } from '../config/schema.js';
import type { EventBuffer } from '../events/buffer.js';
import { getDb } from '../db/sqlite.js';
import { randomUUID } from 'node:crypto';

export class WorkflowEngine {
  private projectId: string;

  constructor(
    private tracker: WorkflowTracker,
    private router: SkillRouter,
    private sessionMgr: AgentSessionManager,
    private agents: ResolvedAgent[],
    private eventBuffer: EventBuffer,
    projectId?: string,
  ) {
    this.projectId = projectId || 'default';
  }

  async execute(def: WorkflowDef, params?: any, triggerSourceRunId?: string): Promise<string> {
    const run = this.tracker.createRun(def.name, params, triggerSourceRunId);
    this.emit('workflow.step_started', { runId: run.id, workflow: def.name });

    try {
      await this.executeSteps(def.steps, run.id, {});
      this.tracker.completeRun(run.id);
      this.emit('workflow.completed', { runId: run.id, workflow: def.name });
      return run.id;
    } catch (err: any) {
      this.tracker.failRun(run.id);
      this.emit('workflow.failed', { runId: run.id, workflow: def.name, error: err.message });
      throw err;
    }
  }

  private async executeSteps(steps: WorkflowStep[], runId: string, outputs: Record<string, string>): Promise<void> {
    for (const step of steps) {
      // Conditional step
      if (step.condition) {
        const result = evaluateCondition(step.condition, outputs);
        if (!result) continue; // skip this step
      }

      // Parallel group
      if (step.parallel?.length) {
        const stepRows = step.parallel.map((s) => this.tracker.createStep(runId, s.id));
        const results = await Promise.allSettled(step.parallel.map(async (s, i) => {
          this.tracker.startStep(stepRows[i].id);
          this.emit('workflow.step_started', { runId, stepId: s.id });
          const agentId = await this.resolveAgent(s);
          const agent = this.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error(`Agent "${agentId}" not found`);
          const prompt = this.buildPrompt(s, outputs);
          const result = await this.sessionMgr.dispatch(agent, prompt);
          this.tracker.completeStep(stepRows[i].id, result);
          if (s.output) outputs[s.output] = result;
          this.emit('workflow.step_completed', { runId, stepId: s.id });
        }));
        // Check for failures and fail-fast
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
          for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'rejected') {
              const err = (results[i] as PromiseRejectedResult).reason;
              this.tracker.failStep(stepRows[i].id, err?.message || String(err));
              this.emit('workflow.step_failed', { runId, stepId: step.parallel[i].id, error: err?.message });
            }
          }
          throw new Error(`Parallel group failed: ${failures.length} step(s) failed`);
        }
        continue;
      }

      // Single step
      if (!step.id) continue;

      // Human gate
      if (step.type === 'human_gate') {
        const gateId = randomUUID();
        const db = getDb();
        const timeoutMs = (step.timeout || 14400) * 1000;
        const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
        db.prepare(
          'INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)',
        ).run(gateId, runId, step.id, step.label || 'Approval required', timeoutAt);

        this.emit('workflow.human_gate_pending', { runId, stepId: step.id, gateId, label: step.label, timeoutAt });
        const stepRow = this.tracker.createStep(runId, step.id);
        this.tracker.startStep(stepRow.id);

        // Wait for gate resolution (polled via API)
        await this.waitForGate(gateId, timeoutMs);
        const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
        if (gate?.status === 'approved') {
          this.tracker.completeStep(stepRow.id, 'approved');
        } else {
          this.tracker.failStep(stepRow.id, 'rejected or timed out');
          throw new Error(`Human gate "${step.label}" was rejected or timed out`);
        }
        continue;
      }

      if (!step.prompt) continue;
      const stepRow = this.tracker.createStep(runId, step.id);
      try {
        this.tracker.startStep(stepRow.id);
        this.emit('workflow.step_started', { runId, stepId: step.id });
        const agentId = await this.resolveAgent(step);
        const agent = this.agents.find((a) => a.id === agentId);
        if (!agent) throw new Error(`Agent "${agentId}" not found`);

        const prompt = this.buildPrompt(step, outputs);
        const result = await this.sessionMgr.dispatch(agent, prompt);
        this.tracker.completeStep(stepRow.id, result);
        if (step.output) outputs[step.output] = result;
        this.emit('workflow.step_completed', { runId, stepId: step.id });
      } catch (err: any) {
        this.tracker.failStep(stepRow.id, err.message);
        this.emit('workflow.step_failed', { runId, stepId: step.id, error: err.message });
        throw err;
      }
    }
  }

  private async resolveAgent(step: WorkflowStep): Promise<string> {
    if (!step.agent) throw new Error(`Step "${step.id}" has no agent configured`);
    if (typeof step.agent === 'string') return step.agent;
    return this.router.resolveAgent(step.prompt || '', this.projectId, step.agent.prefer);
  }

  private buildPrompt(step: WorkflowStep, outputs: Record<string, string>): string {
    let prompt = step.prompt || '';
    if (step.input && outputs[step.input]) {
      prompt = `Context from previous step:\n${outputs[step.input]}\n\n---\n\nTask:\n${prompt}`;
    }
    return prompt;
  }

  private emit(type: string, data: any): void {
    this.eventBuffer.push(data.projectId || 'workflow', data.agentId, type, data);
  }

  private async waitForGate(gateId: string, timeoutMs: number): Promise<void> {
    const db = getDb();
    const start = Date.now();
    let delay = 2000;
    while (Date.now() - start < timeoutMs) {
      const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
      if (gate?.status === 'approved' || gate?.status === 'rejected') return;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 30000); // backoff with jitter: 2s → 3s → 4.5s → ... → 30s
    }
    // Timed out
    db.prepare("UPDATE human_gates SET status = 'timed_out' WHERE id = ?").run(gateId);
  }
}

/**
 * Evaluate a workflow step condition against step outputs.
 *
 * Supported DSL:
 *   step_id.output includes 'text'    — check if output contains string
 *   step_id.status == 'completed'     — check if step produced output
 *   step_id.status != 'completed'     — check if step has no output
 *
 * Also supports optional $ prefix: $step_id.output includes 'text'
 * Unknown conditions log a warning and return false (step is skipped).
 */
function evaluateCondition(condition: string, outputs: Record<string, string>): boolean {
  // Simple DSL: step_id.status == 'completed' or step_id.output includes 'text'
  // Also supports $step_id syntax: $step_id.output includes 'text'
  const match = condition.match(/^\$?(\w+)\.(\w+)\s*(==|!=|includes)\s*['"](.+?)['"]$/);
  if (!match) {
    console.warn(`evaluateCondition: cannot parse condition "${condition}" — step will be skipped`);
    return false;
  }

  const [, stepId, field, op, value] = match;
  const key = `${stepId}.${field}`;

  if (field === 'status' && op === '==' && value === 'completed') {
    return outputs[stepId] !== undefined;
  }
  if (field === 'status' && op === '!=' && value === 'completed') {
    return outputs[stepId] === undefined;
  }
  if (field === 'output' && op === 'includes') {
    return (outputs[stepId] || '').includes(value);
  }

  return false;
}
