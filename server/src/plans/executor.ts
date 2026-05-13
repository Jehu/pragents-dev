import type { WorkflowEngine } from '../workflows/engine.js';
import { WorkflowDef } from '../workflows/schema.js';
import type { PlanStore } from './store.js';
import type { Plan } from './schema.js';
import { logger } from '../logging/index.js';

/**
 * Canonical plan executor used by every entry door (NL, Chat plan_proposal,
 * direct /plans/:id/approve). Wraps the existing WorkflowEngine — a plan is
 * compiled into an ad-hoc WorkflowDef and dispatched the same way #18 did,
 * so behaviour stays identical; only the bookkeeping moves into PlanStore.
 *
 * The executor manages plan lifecycle bookkeeping:
 *   - setExecuting on entry
 *   - setDone({ runId }) on workflow success
 *   - setFailed(error) on workflow failure
 *
 * Status precondition: the plan MUST already be `approved`. Callers approve
 * via PlanStore.approve() before invoking; this keeps the approval step
 * explicit (and auditable) in every path.
 */
export class PlanExecutor {
  constructor(
    private store: PlanStore,
    private wfEngine: WorkflowEngine,
  ) {}

  async executePlan(plan: Plan): Promise<{ runId: string }> {
    if (plan.status !== 'approved' && plan.status !== 'executing') {
      throw new Error(
        `Plan ${plan.id} must be approved before execution (got "${plan.status}")`,
      );
    }

    this.store.setExecuting(plan.id);

    // Build the workflow def via Zod parsing so step/workflow-level
    // `onStepFailure` defaults are filled in (matches the legacy nl/execute
    // code path: each step is an ad-hoc agent step with no failure policy).
    const wfDef = WorkflowDef.parse({
      name: `plan-${plan.id.substring(0, 8)}`,
      description: plan.prompt || 'Plan',
      steps: plan.steps.map((s: any, i: number) => ({
        id: `step-${i}`,
        agent: s.agentId,
        prompt: s.description,
        output: `step-${i}-output`,
        ...(s.dependsOn != null
          ? {
              input: `step-${Array.isArray(s.dependsOn) ? s.dependsOn[0] : s.dependsOn}-output`,
            }
          : {}),
      })),
    });

    try {
      const runId = await this.wfEngine.execute(wfDef);
      this.store.setDone(plan.id, { runId });
      logger.info({ planId: plan.id, runId }, 'PlanExecutor: plan completed');
      return { runId };
    } catch (err: any) {
      const message = err?.message || String(err);
      this.store.setFailed(plan.id, message);
      logger.warn({ planId: plan.id, err: message }, 'PlanExecutor: plan failed');
      throw err;
    }
  }
}
