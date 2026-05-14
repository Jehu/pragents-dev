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
import { TaskTracker } from '../tasks/tracker.js';

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
    this.pruneCooldownMap();
    for (const goal of goals) {
      const job = cron(goal.cadence, () => this.trigger(goal));
      this.jobs.push(job);
      logger.info({ goalId: goal.id, cadence: goal.cadence, workflow: goal.workflow }, 'Goal scheduled');
    }

    // PM monitor: check every 5 minutes
    cron('*/5 * * * *', () => this.pmCheck());
  }

  /**
   * Drop cooldown entries for goals that are no longer in the active config.
   * Called from start() on every (re)load so a long-running scheduler that
   * sees frequent goal renames/deletions does not accumulate dead entries.
   * Also enforces a hard cap (1000) to bound pathological growth.
   */
  private pruneCooldownMap(): void {
    const liveIds = new Set(this.goals.map((g) => g.id));
    for (const id of this.lastManualTrigger.keys()) {
      if (!liveIds.has(id)) this.lastManualTrigger.delete(id);
    }
    if (this.lastManualTrigger.size > 1000) {
      // Last-resort cap: drop oldest entries (Map preserves insertion order).
      const excess = this.lastManualTrigger.size - 1000;
      const it = this.lastManualTrigger.keys();
      for (let i = 0; i < excess; i++) {
        const next = it.next();
        if (next.done) break;
        this.lastManualTrigger.delete(next.value);
      }
    }
  }

  /** Called by the orchestrator on every event — used to clean up completed goal runs. */
  onEvent(evt: any): void {
    if ((evt.type === 'workflow.completed' || evt.type === 'workflow.failed') && evt.runId) {
      this.activeGoalRuns.delete(evt.runId);
    }
  }

  /**
   * Manually trigger a goal by id. Returns the goal_run id on success.
   * Rejects if the goal is unknown, has no workflow, a run is already active,
   * or the per-goal cooldown has not elapsed since the last manual trigger.
   */
  private lastManualTrigger: Map<string, number> = new Map();
  private readonly manualTriggerCooldownMs = 30_000;

  async runGoalById(id: string): Promise<{ goalRunId: string; workflowRunId: string }> {
    const goal = this.goals?.find((g) => g.id === id);
    if (!goal) throw new Error(`Goal "${id}" not found`);

    const last = this.lastManualTrigger.get(id);
    if (last && Date.now() - last < this.manualTriggerCooldownMs) {
      const wait = Math.ceil((this.manualTriggerCooldownMs - (Date.now() - last)) / 1000);
      throw new Error(`Cooldown active — retry in ${wait}s`);
    }
    const existingRun = [...this.activeGoalRuns.values()].find((r) => r.goalId === id);
    if (existingRun) {
      throw new Error(`Goal "${id}" already running (goal_run ${existingRun.goalRunId})`);
    }

    const wfDef = this.wfRegistry.get(goal.workflow);
    if (!wfDef) throw new Error(`Workflow "${goal.workflow}" not found`);

    this.lastManualTrigger.set(id, Date.now());

    const goalRunId = randomUUID();
    const db = getDb();
    db.prepare('INSERT INTO goal_runs (id, goal_id, status) VALUES (?, ?, ?)').run(goalRunId, id, 'triggered');

    // Insert → executeAsync → update is one logical transaction at the row
    // level: if any step throws, the row must not stay in 'triggered'
    // forever. Capture the error, mark the run as failed, and re-throw so
    // the API surface returns the right status code.
    try {
      const workflowRunId = this.wfEngine.executeAsync(wfDef, { goalId: id, goalRunId, manual: true }, goalRunId);
      db.prepare('UPDATE goal_runs SET workflow_run_id = ?, status = ? WHERE id = ?').run(workflowRunId, 'running', goalRunId);
      this.activeGoalRuns.set(workflowRunId, {
        goalRunId,
        deadline: goal.deadline ? this.nextDeadline(goal.deadline) : new Date(Date.now() + 86400000),
        goalId: id,
      });
      return { goalRunId, workflowRunId };
    } catch (err: any) {
      try {
        db.prepare('UPDATE goal_runs SET status = ? WHERE id = ?').run('failed', goalRunId);
      } catch (markErr: any) {
        logger.error({ goalRunId, err: markErr?.message }, 'failed to mark goal_run as failed after dispatch error');
      }
      throw err;
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
    const tracker = new TaskTracker();
    const now = Date.now();
    for (const [wfRunId, info] of this.activeGoalRuns) {
      const goal = this.goals?.find(g => g.id === info.goalId);
      if (!goal) continue;
      if (now > info.deadline.getTime()) {
        // Escalate to PM agent
        if (this.pmAgent) {
          const db = getDb();
          db.prepare("UPDATE goal_runs SET status = 'escalated' WHERE id = ?").run(info.goalRunId);

          const escalationMsg = `Goal "${goal.id}" has passed its deadline. Workflow run ${wfRunId} may need attention. Check and take appropriate action.`;
          const task = tracker.create({
            projectId: this.pmAgent.projectId,
            agentId: this.pmAgent.id,
            description: escalationMsg,
            type: 'escalation',
          });
          tracker.setRunning(task.id);

          this.sessionMgr.dispatch(this.pmAgent, escalationMsg, task.id)
            .then(() => {
              tracker.setComplete(task.id, 'Escalation dispatched to PM agent');
              logger.info({ goalId: goal.id, goalRunId: info.goalRunId, taskId: task.id }, 'Goal escalation dispatched successfully');
            })
            .catch((err: any) => {
              tracker.setFailed(task.id, err?.message ?? 'Unknown error');
              logger.error({ goalId: goal.id, goalRunId: info.goalRunId, taskId: task.id, err: err?.message }, 'Goal escalation dispatch failed');
              this.eventBuffer.push(
                this.pmAgent!.projectId,
                this.pmAgent!.id,
                'escalation.failed',
                { goalId: goal.id, goalRunId: info.goalRunId, taskId: task.id, error: err?.message ?? 'Unknown error' },
                task.id,
              );
            });
        }
        this.activeGoalRuns.delete(wfRunId);
      } else if (now > info.deadline.getTime() - (goal.warn_before_ms || 7200000)) {
        // Warning: deadline approaching — only warn once per hour
        if (this.pmAgent && (!info.warnedAt || now - info.warnedAt > 3600000)) {
          info.warnedAt = now;
          this.sessionMgr.dispatch(this.pmAgent,
            `Warning: Goal "${goal.id}" deadline approaching in ${Math.round((info.deadline.getTime() - now) / 60000)} minutes. Workflow run ${wfRunId} is active.`
          ).catch((err) => logger.warn({ goalId: goal.id, err: err?.message }, 'Goal warning dispatch failed'));
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
          logger.error({ sessionId: row.id, err: err?.message || err }, 'PM auto-extract error for session'),
        );

        // Mark as checked regardless of extraction success
        db.prepare('UPDATE sessions SET auto_extract_checked = 1 WHERE id = ?').run(row.id);
      }

      if (rows.length > 0) {
        logger.info({ count: rows.length }, 'PM auto-extract checked sessions');
      }
    } catch (err: any) {
      logger.error({ err: err?.message || err }, 'PM auto-extract check failed');
    }
  }

  private goals: GoalDef[] = [];

  stop(): void {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
  }
}
