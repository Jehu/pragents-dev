import cron from 'croner';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logging/index.js';
import type { GoalDef } from './schema.js';
import type { WorkflowRegistry } from '../workflows/loader.js';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { EventBuffer } from '../events/buffer.js';
import type { AgentSessionManager } from '../agents/manager.js';
import type { ResolvedAgent } from '../config/schema.js';
import type { SkillAutoExtractor } from '../skills/auto-extractor.js';

export class GoalScheduler {
  private jobs: cron[] = [];
  private pmAgent: ResolvedAgent | null = null;
  private activeGoalRuns: Map<string, { goalRunId: string; deadline: Date; goalId: string; warnedAt?: number }> = new Map();
  private autoExtractor: SkillAutoExtractor | null = null;

  constructor(
    private wfRegistry: WorkflowRegistry,
    private wfEngine: WorkflowEngine,
    private eventBuffer: EventBuffer,
    private sessionMgr: AgentSessionManager,
    agents: ResolvedAgent[],
  ) {
    this.pmAgent = agents.find(a => a.type === 'pm') || agents[0] || null;
  }

  setAutoExtractor(ae: SkillAutoExtractor): void {
    this.autoExtractor = ae;
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

  /** Called by the orchestrator on every event — used to clean up completed goal runs. */
  onEvent(evt: any): void {
    if ((evt.type === 'workflow.completed' || evt.type === 'workflow.failed') && evt.runId) {
      this.activeGoalRuns.delete(evt.runId);
    }
  }

  private async trigger(goal: GoalDef): Promise<void> {
    // Skip if a run for this goal is already active (overlap protection)
    const existingRun = [...this.activeGoalRuns.values()].find(r => r.goalId === goal.id);
    if (existingRun) {
      logger.warn({ goalId: goal.id, goalRunId: existingRun.goalRunId }, 'Skipping goal trigger — run already active');
      return;
    }

    const wfDef = this.wfRegistry.get(goal.workflow);
    if (!wfDef) { logger.warn({ goalId: goal.id, workflow: goal.workflow }, `Goal "${goal.id}": workflow "${goal.workflow}" not found`); return; }

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
        if (this.pmAgent) {
          const db = getDb();
          db.prepare("UPDATE goal_runs SET status = 'escalated' WHERE id = ?").run(info.goalRunId);
          this.sessionMgr.dispatch(this.pmAgent, 
            `Goal "${goal.id}" has passed its deadline. Workflow run ${wfRunId} may need attention. Check and take appropriate action.`
          ).catch((err) => console.warn(`Goal escalation dispatch failed for "${goal.id}":`, err?.message));
        }
        this.activeGoalRuns.delete(wfRunId);
      } else if (now > info.deadline.getTime() - (goal.warn_before_ms || 7200000)) {
        // Warning: deadline approaching — only warn once per hour
        if (this.pmAgent && (!info.warnedAt || now - info.warnedAt > 3600000)) {
          info.warnedAt = now;
          this.sessionMgr.dispatch(this.pmAgent,
            `Warning: Goal "${goal.id}" deadline approaching in ${Math.round((info.deadline.getTime() - now) / 60000)} minutes. Workflow run ${wfRunId} is active.`
          ).catch((err) => console.warn(`Goal warning dispatch failed for "${goal.id}":`, err?.message));
        }
      }
    }

    // Clean up completed runs
    for (const [wfRunId] of this.activeGoalRuns) {
      const db = getDb();
      const row = db.prepare('SELECT id as goal_run_id FROM goal_runs WHERE workflow_run_id = ? AND status = ?').get(wfRunId, 'running') as any;
      if (!row) this.activeGoalRuns.delete(wfRunId);
    }

    // Auto-extraction scan: check recently ended sessions (R3)
    if (this.autoExtractor) {
      this.pmAutoExtractCheck(this.autoExtractor);
    }
  }

  private nextDeadline(cronExpr: string): Date {
    const job = cron(cronExpr, () => {});
    const next = job.nextRun();
    job.stop();
    return next || new Date(Date.now() + 86400000);
  }

  /**
   * PM auto-extraction check: scans recently ended sessions for
   * extraction potential. Acts as backup for the session-end hook (U2)
   * when sessions weren't caught at dispose time (server restart, etc.).
   *
   * Queries sessions with auto_extract_checked = 0, limits to 10 most
   * recent, and delegates to SkillAutoExtractor for eligibility check
   * and extraction.
   */
  private async pmAutoExtractCheck(autoExtractor: SkillAutoExtractor): Promise<void> {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT id FROM sessions WHERE auto_extract_checked = 0 ORDER BY created_at DESC LIMIT 10',
      ).all() as Array<{ id: string }>;

      for (const row of rows) {
        // Let autoExtractor handle eligibility (409, <10 messages, etc.)
        // Messages are loaded by autoExtractor internally
        autoExtractor.tryExtract(row.id).catch((err: any) =>
          console.error(`[pragents] PM auto-extract error for session ${row.id}:`, err?.message || err),
        );

        // Mark as checked regardless of extraction success
        db.prepare('UPDATE sessions SET auto_extract_checked = 1 WHERE id = ?').run(row.id);
      }

      if (rows.length > 0) {
        console.log(`[pragents] PM auto-extract checked ${rows.length} sessions`);
      }
    } catch (err: any) {
      console.error('[pragents] PM auto-extract check failed:', err?.message || err);
    }
  }

  private goals: GoalDef[] = [];

  stop(): void {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
  }
}
