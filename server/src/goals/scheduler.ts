import cron from 'croner';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { GoalDef } from './schema.js';
import type { WorkflowRegistry } from '../workflows/loader.js';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { EventBuffer } from '../events/buffer.js';
import type { AgentSessionManager } from '../agents/manager.js';
import type { ResolvedAgent } from '../config/schema.js';

export class GoalScheduler {
  private jobs: cron[] = [];
  private pmAgent: ResolvedAgent | null = null;
  private activeGoalRuns: Map<string, { goalRunId: string; deadline: Date; goalId: string }> = new Map();

  constructor(
    private wfRegistry: WorkflowRegistry,
    private wfEngine: WorkflowEngine,
    private eventBuffer: EventBuffer,
    private sessionMgr: AgentSessionManager,
    agents: ResolvedAgent[],
  ) {
    this.pmAgent = agents.find(a => a.type === 'pm') || agents[0] || null;
  }

  start(goals: GoalDef[]): void {
    this.goals = goals;
    for (const goal of goals) {
      const job = cron(goal.cadence, () => this.trigger(goal));
      this.jobs.push(job);
      console.log(`Goal "${goal.id}" scheduled: ${goal.cadence} → ${goal.workflow}`);
    }

    // PM monitor: check every 5 minutes
    cron('*/5 * * * *', () => this.pmCheck());
  }

  private async trigger(goal: GoalDef): Promise<void> {
    const wfDef = this.wfRegistry.get(goal.workflow);
    if (!wfDef) { console.warn(`Goal "${goal.id}": workflow "${goal.workflow}" not found`); return; }

    const goalRunId = randomUUID();
    const db = getDb();
    db.prepare('INSERT INTO goal_runs (id, goal_id, status) VALUES (?, ?, ?)').run(goalRunId, goal.id, 'triggered');

    try {
      const runId = await this.wfEngine.execute(wfDef, { goalId: goal.id, goalRunId }, goalRunId);
      db.prepare('UPDATE goal_runs SET workflow_run_id = ?, status = ? WHERE id = ?').run(runId, 'running', goalRunId);
      this.activeGoalRuns.set(runId, {
        goalRunId,
        deadline: goal.deadline ? this.nextDeadline(goal.deadline) : new Date(Date.now() + 86400000),
        goalId: goal.id,
      });
    } catch (err: any) {
      db.prepare('UPDATE goal_runs SET status = ? WHERE id = ?').run('failed', goalRunId);
    }
  }

  private async pmCheck(): Promise<void> {
    const now = Date.now();
    for (const [wfRunId, info] of this.activeGoalRuns) {
      const goal = this.goals?.find(g => g.id === info.goalId);
      if (!goal) continue;
      if (now > info.deadline.getTime()) {
        // Escalate to PM agent
        this.activeGoalRuns.delete(wfRunId);
        if (this.pmAgent) {
          const db = getDb();
          db.prepare("UPDATE goal_runs SET status = 'escalated' WHERE id = ?").run(info.goalRunId);
          this.sessionMgr.dispatch(this.pmAgent, 
            `Goal "${goal.id}" has passed its deadline. Workflow run ${wfRunId} may need attention. Check and take appropriate action.`
          ).catch(() => {});
        }
      } else if (now > info.deadline.getTime() - (goal.warn_before_ms || 7200000)) {
        // Warning: deadline approaching
        if (this.pmAgent) {
          this.sessionMgr.dispatch(this.pmAgent,
            `Warning: Goal "${goal.id}" deadline approaching in ${Math.round((info.deadline.getTime() - now) / 60000)} minutes. Workflow run ${wfRunId} is active.`
          ).catch(() => {});
        }
      }
    }

    // Clean up completed runs
    for (const [wfRunId] of this.activeGoalRuns) {
      const db = getDb();
      const row = db.prepare('SELECT goal_run_id FROM goal_runs WHERE workflow_run_id = ? AND status = ?').get(wfRunId, 'running') as any;
      if (!row) this.activeGoalRuns.delete(wfRunId);
    }
  }

  private nextDeadline(cronExpr: string): Date {
    const job = cron(cronExpr, () => {});
    const next = job.nextRun();
    job.stop();
    return next || new Date(Date.now() + 86400000);
  }

  private goals: GoalDef[] = [];

  stop(): void {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
  }
}
