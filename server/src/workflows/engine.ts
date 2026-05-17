import type { WorkflowDef, WorkflowStep } from './schema.js';
import { WorkflowTracker } from './tracker.js';
import { SkillRouter } from '../routing/router.js';
import type { AgentSessionManager } from '../agents/manager.js';
import type { ResolvedAgent } from '../config/schema.js';
import type { EventBuffer } from '../events/buffer.js';
import { getDb } from '../db/sqlite.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../logging/index.js';

/**
 * Minimal step shape accepted by resolveAgent/buildPrompt.
 * Both WorkflowStep and ParallelStep share these fields.
 */
type StepLike = { agent?: WorkflowStep['agent']; prompt?: string; input?: string; output?: string; timeout?: number; condition?: string };

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
      await this.executeSteps(def, run.id, {});
      this.tracker.completeRun(run.id);
      this.emit('workflow.completed', { runId: run.id, workflow: def.name });
      return run.id;
    } catch (err: any) {
      this.tracker.failRun(run.id);
      this.emit('workflow.failed', { runId: run.id, workflow: def.name, error: err.message });
      throw err;
    }
  }

  /**
   * Fire-and-forget variant of execute(). Returns the runId immediately after
   * the run row is created in the tracker; the workflow then executes in the
   * background. Errors are logged but not propagated — observe via events.
   */
  executeAsync(def: WorkflowDef, params?: any, triggerSourceRunId?: string): string {
    const run = this.tracker.createRun(def.name, params, triggerSourceRunId);
    this.emit('workflow.step_started', { runId: run.id, workflow: def.name });

    void (async () => {
      let stepsSucceeded = false;
      try {
        await this.executeSteps(def, run.id, {});
        stepsSucceeded = true;
      } catch (err: any) {
        // Real workflow failure — steps did not complete successfully.
        try { this.tracker.failRun(run.id); } catch { /* swallow — already-logged */ }
        this.emit('workflow.failed', { runId: run.id, workflow: def.name, error: err?.message });
        logger.error({ runId: run.id, workflow: def.name, err: err?.message }, 'workflow async execution failed');
        return;
      }

      // Post-run bookkeeping — runs ONLY on success. Failures here must not
      // re-label the run as failed: the steps completed correctly. A DB lock
      // or transient I/O error in completeRun() is observability noise, not
      // a workflow-level failure.
      try {
        this.tracker.completeRun(run.id);
        this.emit('workflow.completed', { runId: run.id, workflow: def.name });
      } catch (bookErr: any) {
        logger.error(
          { runId: run.id, workflow: def.name, err: bookErr?.message, stepsSucceeded },
          'workflow bookkeeping failed after successful steps — run stays in current status',
        );
        this.emit('workflow.bookkeeping_failed', { runId: run.id, workflow: def.name, error: bookErr?.message });
      }
    })();

    return run.id;
  }

  private async executeSteps(def: WorkflowDef, runId: string, outputs: Record<string, string>): Promise<void> {
    const steps = def.steps;
    for (const step of steps) {
      // Conditional step
      if (step.condition) {
        const result = evaluateCondition(step.condition, outputs);
        if (!result) continue; // skip this step
      }

      // Parallel group
      if (step.parallel?.length) {
        // Resolve effective failure policy: step-level overrides workflow-level default.
        const failurePolicy = step.onStepFailure ?? def.onStepFailure ?? 'abort';

        const stepRows = step.parallel.map((s) => this.tracker.createStep(runId, s.id));
        const stepContexts: Array<{ agentId?: string; projectId?: string }> = [];
        const results = await Promise.allSettled(step.parallel.map(async (s, i) => {
          this.tracker.startStep(stepRows[i].id);
          const agentId = await this.resolveAgent(s);
          const agent = this.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error(`Agent "${agentId}" not found`);
          stepContexts[i] = { agentId: agent.id, projectId: agent.projectId };
          this.emit('workflow.step_started', {
            runId,
            stepId: s.id,
            workflow: def.name,
            agentId: agent.id,
            projectId: agent.projectId,
          });
          const prompt = this.buildPrompt(s, outputs);
          const result = await this.sessionMgr.dispatch(agent, prompt);
          this.tracker.completeStep(stepRows[i].id, result);
          if (s.output) outputs[s.output] = result;
          this.emit('workflow.step_completed', {
            runId,
            stepId: s.id,
            workflow: def.name,
            agentId: agent.id,
            projectId: agent.projectId,
          });
          return { stepId: s.id, value: result };
        }));

        const failures = results.filter(r => r.status === 'rejected');

        // Always record failed steps in the tracker and event buffer.
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'rejected') {
            const err = (results[i] as PromiseRejectedResult).reason;
            this.tracker.failStep(stepRows[i].id, err?.message || String(err));
            this.emit('workflow.step_failed', {
              runId,
              stepId: step.parallel[i].id,
              workflow: def.name,
              agentId: stepContexts[i]?.agentId,
              projectId: stepContexts[i]?.projectId,
              error: err?.message,
            });
          }
        }

        if (failures.length > 0) {
          if (failurePolicy === 'abort') {
            throw new Error(`Parallel group failed: ${failures.length} step(s) failed`);
          }

          if (failurePolicy === 'resume-later') {
            // TODO: full resume-later implementation — persist partial results to DB
            // and emit a human_gate event so an operator can decide to continue or abort.
            // For now this falls through to 'continue' behaviour and logs a warning.
            logger.warn(
              { runId, stepId: step.id, failures: failures.length },
              'onStepFailure=resume-later is not yet fully implemented; treating as continue',
            );
          }

          // 'continue' (and stub resume-later): collect all results into a JSON blob
          // and expose it as `<step.id>.results` in the outputs map so downstream
          // steps can inspect which sub-steps succeeded/failed.
          const collected: Record<string, { ok: boolean; value?: string; error?: string }> = {};
          for (let i = 0; i < results.length; i++) {
            const s = step.parallel[i];
            if (results[i].status === 'fulfilled') {
              const val = (results[i] as PromiseFulfilledResult<{ stepId: string; value: string }>).value;
              collected[s.id] = { ok: true, value: val.value };
            } else {
              const err = (results[i] as PromiseRejectedResult).reason;
              collected[s.id] = { ok: false, error: err?.message || String(err) };
            }
          }
          outputs[`${step.id}.results`] = JSON.stringify(collected);
          logger.info(
            { runId, stepId: step.id, failures: failures.length, policy: failurePolicy },
            'Parallel group had failures; continuing with partial results',
          );
        }
        continue;
      }

      // Single step
      if (!step.id) continue;

      // Human gate
      if (step.type === 'human_gate') {
        const db = getDb();
        const timeoutMs = (step.timeout || 14400) * 1000;

        // Create initial gate
        let gateId = randomUUID();
        let timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
        db.prepare(
          'INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at) VALUES (?, ?, ?, ?, ?)',
        ).run(gateId, runId, step.id, step.label || 'Approval required', timeoutAt);

        this.emit('workflow.human_gate_pending', { runId, stepId: step.id, gateId, label: step.label, timeoutAt });
        const stepRow = this.tracker.createStep(runId, step.id);
        this.tracker.startStep(stepRow.id);

        // Gate resolution loop — supports revision_requested for feedback loops
        while (true) {
          const resolution = await this.waitForGate(gateId, timeoutMs, step.id, runId);

          if (resolution === 'approved') {
            this.tracker.completeStep(stepRow.id, 'approved');
            break;
          }

          if (resolution === 'revision_requested') {
            // Get feedback from the gate
            const gate = db.prepare('SELECT feedback FROM human_gates WHERE id = ?').get(gateId) as any;
            const feedback = gate?.feedback || '';

            // Find previous step's agent to re-dispatch
            const stepIndex = def.steps.findIndex(s => s.id === step.id);
            const prevStep = stepIndex > 0 ? def.steps[stepIndex - 1] : null;

            if (!prevStep || prevStep.type === 'human_gate') {
              // Cannot revise — no previous agent step
              this.tracker.failStep(stepRow.id, 'revision requested but no previous agent step to re-dispatch');
              throw new Error(`Human gate "${step.label}" revision failed: no previous agent step`);
            }

            // Build revision prompt with feedback and previous output
            const revisionPrompt = this.buildRevisionPrompt(prevStep, feedback, outputs);

            // Re-dispatch the previous step's agent
            const prevAgentId = await this.resolveAgent(prevStep);
            const prevAgent = this.agents.find(a => a.id === prevAgentId);
            if (!prevAgent) {
              this.tracker.failStep(stepRow.id, `Agent "${prevAgentId}" not found for revision`);
              throw new Error(`Human gate "${step.label}" revision failed: agent "${prevAgentId}" not found`);
            }

            const revisedOutput = await this.sessionMgr.dispatch(prevAgent, revisionPrompt);

            // Store revised output in the outputs map (for downstream steps)
            if (prevStep.output) outputs[prevStep.output] = revisedOutput;

            // Update the previous step's row so the revised output is visible in the UI
            const prevStepRow = db.prepare(
              'SELECT id FROM workflow_steps WHERE run_id = ? AND step_id = ? ORDER BY started_at DESC LIMIT 1',
            ).get(runId, prevStep.id) as any;
            if (prevStepRow) {
              db.prepare(
                "UPDATE workflow_steps SET output = ?, completed_at = ? WHERE id = ?",
              ).run(revisedOutput, new Date().toISOString(), prevStepRow.id);
            }

            // Create a new gate for re-review (carry feedback forward for context)
            gateId = randomUUID();
            timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
            db.prepare(
              'INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at, feedback) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(gateId, runId, step.id, step.label || 'Approval required', timeoutAt, feedback);

            this.emit('workflow.human_gate_pending', { runId, stepId: step.id, gateId, label: step.label, timeoutAt });
            // Loop continues — polls the new gate
            continue;
          }

          // rejected or timed_out
          this.tracker.failStep(stepRow.id, `gate ${resolution}`);
          throw new Error(`Human gate "${step.label}" was ${resolution}`);
        }
        continue;
      }

      if (!step.prompt) continue;
      const stepRow = this.tracker.createStep(runId, step.id);
      let stepAgent: ResolvedAgent | undefined;
      try {
        this.tracker.startStep(stepRow.id);
        const agentId = await this.resolveAgent(step);
        const agent = this.agents.find((a) => a.id === agentId);
        if (!agent) throw new Error(`Agent "${agentId}" not found`);
        stepAgent = agent;
        this.emit('workflow.step_started', {
          runId,
          stepId: step.id,
          workflow: def.name,
          agentId: agent.id,
          projectId: agent.projectId,
        });

        const prompt = this.buildPrompt(step, outputs);
        const result = await this.sessionMgr.dispatch(agent, prompt);
        this.tracker.completeStep(stepRow.id, result);
        if (step.output) outputs[step.output] = result;
        this.emit('workflow.step_completed', {
          runId,
          stepId: step.id,
          workflow: def.name,
          agentId: agent.id,
          projectId: agent.projectId,
        });
      } catch (err: any) {
        this.tracker.failStep(stepRow.id, err.message);
        this.emit('workflow.step_failed', {
          runId,
          stepId: step.id,
          workflow: def.name,
          agentId: stepAgent?.id,
          projectId: stepAgent?.projectId,
          error: err.message,
        });
        throw err;
      }
    }
  }

  private async resolveAgent(step: StepLike): Promise<string> {
    if (!step.agent) throw new Error('Step has no agent configured');
    if (typeof step.agent === 'string') return step.agent;
    return this.router.resolveAgent(step.prompt || '', this.projectId, step.agent.prefer);
  }

  private buildPrompt(step: StepLike, outputs: Record<string, string>): string {
    let prompt = step.prompt || '';
    if (step.input && outputs[step.input]) {
      prompt = `Context from previous step:\n${outputs[step.input]}\n\n---\n\nTask:\n${prompt}`;
    }
    return prompt;
  }

  private buildRevisionPrompt(prevStep: StepLike, feedback: string, outputs: Record<string, string>): string {
    const prevOutput = (prevStep.output && outputs[prevStep.output]) ? outputs[prevStep.output] : '(no previous output)';
    return `## Revision Request

Your previous output:
${prevOutput}

### Reviewer Feedback
${feedback}

---

Please revise your work based on the feedback above.

Original task:
${prevStep.prompt || '(no original task)'}`;
  }

  private emit(type: string, data: any): void {
    this.eventBuffer.push(data.projectId || 'workflow', data.agentId, type, data);
  }

  private async waitForGate(
    gateId: string,
    timeoutMs: number,
    stepId: string,
    runId: string,
  ): Promise<'approved' | 'rejected' | 'timed_out' | 'revision_requested'> {
    const db = getDb();
    const start = Date.now();
    let delay = 2000;
    while (Date.now() - start < timeoutMs) {
      const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
      if (gate?.status === 'approved' || gate?.status === 'rejected' || gate?.status === 'revision_requested') {
        return gate.status;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 30000);
    }
    db.prepare("UPDATE human_gates SET status = 'timed_out' WHERE id = ?").run(gateId);
    this.emit('gate.timed_out', { gateId, workflowRunId: runId, stepId, projectId: this.projectId });
    return 'timed_out';
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
    logger.warn({ condition }, 'evaluateCondition: cannot parse condition — step will be skipped');
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
