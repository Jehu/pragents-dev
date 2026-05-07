import type { WorkflowDef, WorkflowStep } from './schema.js';
import { WorkflowTracker } from './tracker.js';
import { SkillRouter } from '../routing/router.js';
import type { AgentSessionManager } from '../agents/manager.js';
import type { ResolvedAgent } from '../config/schema.js';
import type { EventBuffer } from '../events/buffer.js';

export class WorkflowEngine {
  constructor(
    private tracker: WorkflowTracker,
    private router: SkillRouter,
    private sessionMgr: AgentSessionManager,
    private agents: ResolvedAgent[],
    private eventBuffer: EventBuffer,
  ) {}

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
        const promises = step.parallel.map(async (s, i) => {
          try {
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
          } catch (err: any) {
            this.tracker.failStep(stepRows[i].id, err.message);
            this.emit('workflow.step_failed', { runId, stepId: s.id, error: err.message });
            throw err; // fail-fast
          }
        });
        await Promise.all(promises);
        continue;
      }

      // Single step
      if (!step.id || !step.prompt) continue; // skip placeholder steps
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
    return this.router.resolveAgent(step.prompt || '', 'kunde-webshop', step.agent.prefer);
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
}

function evaluateCondition(condition: string, outputs: Record<string, string>): boolean {
  // Simple DSL: step_id.status == 'completed' or step_id.output includes 'text'
  const match = condition.match(/^(\w+)\.(\w+)\s*(==|!=|includes)\s*['"](.+?)['"]$/);
  if (!match) return false;

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
