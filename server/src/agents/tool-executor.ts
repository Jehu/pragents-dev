import type { TaskTracker } from '../tasks/tracker.js';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { MemoryEngine } from '../memory/engine.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { CostTracker } from '../tracking/cost-tracker.js';
import type { WorkflowRegistry } from '../workflows/loader.js';
import type { WorkflowTracker } from '../workflows/tracker.js';
import type { GoalRegistry } from '../goals/loader.js';
import type { EventBuffer } from '../events/buffer.js';
import type { ResolvedAgent } from '../config/schema.js';
import type { NLDecomposer } from '../nl/decomposer.js';
import { getDb } from '../db/sqlite.js';

export interface ToolExecutorDeps {
  tracker: TaskTracker;
  wfEngine: WorkflowEngine;
  wfRegistry: WorkflowRegistry;
  wfTracker: WorkflowTracker;
  memory: MemoryEngine;
  skills: SkillRegistry;
  costTracker: CostTracker;
  agents: ResolvedAgent[];
  goalRegistry: GoalRegistry;
  eventBuffer: EventBuffer;
  decomposer: NLDecomposer;
  /** Callback to dispatch a task to an agent */
  dispatchTask: (projectId: string, agentId: string, description: string) => Promise<string>;
}

export class ToolExecutor {
  constructor(private deps: ToolExecutorDeps) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (toolName) {
        case 'query_tasks': {
          const { projectId, status } = args as { projectId: string; status?: string };
          const tasks = this.deps.tracker.list(projectId);
          const filtered = status ? tasks.filter((t: any) => t.status === status) : tasks;
          return JSON.stringify(filtered.slice(0, 20));
        }
        case 'create_task': {
          const { projectId, agentId, description, status } = args as { projectId: string; agentId: string; description: string; status?: string };
          const taskStatus = status === 'needs_review' ? 'needs_review' : 'pending';
          const task = this.deps.tracker.create({ projectId, agentId, description, status: taskStatus });
          if (taskStatus === 'needs_review') {
            this.deps.tracker.setNeedsReview(task.id, description);
            return JSON.stringify({ taskId: task.id, status: 'needs_review', note: 'Not dispatched — human review requested' });
          }
          this.deps.dispatchTask(projectId, agentId, description).then(
            (result) => this.deps.tracker.setComplete(task.id, result),
            (err) => this.deps.tracker.setFailed(task.id, err?.message || String(err)),
          );
          return JSON.stringify({ taskId: task.id, status: 'dispatched' });
        }
        case 'run_workflow': {
          const { workflowName, projectId, params } = args as { workflowName: string; projectId: string; params?: any };
          const wfDef = this.deps.wfRegistry.get(workflowName);
          if (!wfDef) return `Error: Workflow "${workflowName}" not found`;
          const runId = await this.deps.wfEngine.execute(wfDef, params);
          return JSON.stringify({ runId, workflow: workflowName, status: 'started' });
        }
        case 'list_workflows': {
          const workflows = this.deps.wfRegistry.list();
          return JSON.stringify(workflows.map((w: any) => ({ name: w.name, description: w.description || '' })));
        }
        case 'approve_gate': {
          const { gateId } = args as { gateId: string };
          const db = getDb();
          const result = db.transaction(() => {
            const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
            if (!gate) return `Error: Gate "${gateId}" not found`;
            if (gate.status !== 'pending') return `Error: Gate "${gateId}" is already ${gate.status}`;
            db.prepare("UPDATE human_gates SET status = 'approved' WHERE id = ?").run(gateId);
            return JSON.stringify({ gateId, status: 'approved' });
          })();
          return result;
        }
        case 'reject_gate': {
          const { gateId, reason } = args as { gateId: string; reason?: string };
          const db = getDb();
          const result = db.transaction(() => {
            const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
            if (!gate) return `Error: Gate "${gateId}" not found`;
            if (gate.status !== 'pending') return `Error: Gate "${gateId}" is already ${gate.status}`;
            db.prepare("UPDATE human_gates SET status = 'rejected' WHERE id = ?").run(gateId);
            return JSON.stringify({ gateId, status: 'rejected', reason: reason || 'No reason provided' });
          })();
          return result;
        }
        case 'search_memory': {
          const { query, scope, limit } = args as { query: string; scope?: string; limit?: number };
          const facts = await this.deps.memory.recall(query, scope || 'project', limit || 10);
          return JSON.stringify(facts);
        }
        case 'remember_fact': {
          const { content, category, scope } = args as { content: string; category: string; scope: string };
          const id = await (this.deps.memory.remember as any)(scope || 'project', category, content, 'tool');
          return JSON.stringify({ id, status: 'remembered' });
        }
        case 'list_skills': {
          const skills = this.deps.skills.list();
          return JSON.stringify(skills.map((s: any) => ({ name: s.name, description: s.description || '' })));
        }
        case 'get_cost_summary': {
          const { projectId } = args as { projectId: string };
          const cost = this.deps.costTracker.getProjectCost(projectId);
          return JSON.stringify(cost);
        }
        case 'list_agents': {
          return JSON.stringify(this.deps.agents.map(a => ({
            id: a.id, type: a.type, projectId: a.projectId, skills: a.skills,
          })));
        }
        case 'list_goals': {
          const goals = this.deps.goalRegistry.list();
          return JSON.stringify(goals.map((g: any) => ({ id: g.id, cadence: g.cadence, workflow: g.workflow, deadline: g.deadline })));
        }
        case 'get_goal_runs': {
          const { limit } = args as { limit?: number };
          const db = getDb();
          const runs = db.prepare('SELECT id, goal_id, workflow_run_id, status, triggered_at FROM goal_runs ORDER BY triggered_at DESC LIMIT ?').all(limit || 20);
          return JSON.stringify(runs);
        }
        case 'list_pending_gates': {
          const db = getDb();
          const gates = db.prepare("SELECT id, workflow_run_id, step_id, label, created_at, timeout_at FROM human_gates WHERE status = 'pending' ORDER BY created_at ASC").all();
          return JSON.stringify(gates);
        }
        case 'list_pending_attention': {
          const { projectId, agentId } = args as { projectId: string; agentId: string };
          const db = getDb();
          const gates = db.prepare("SELECT id, workflow_run_id as workflowRunId, step_id as stepId, label, created_at as createdAt, timeout_at as timeoutAt FROM human_gates WHERE status = 'pending' ORDER BY created_at ASC").all();
          const needsReview = this.deps.tracker.list(projectId).filter((t: any) => t.status === 'needs_review');
          const ownBlocked = this.deps.tracker.list(projectId).filter((t: any) => t.status === 'blocked' && t.agentId === agentId);
          return JSON.stringify({ gates, needsReview, blocked: ownBlocked });
        }
        case 'get_workflow_runs': {
          const { limit } = args as { limit?: number };
          const runs = this.deps.wfTracker.listRuns(limit || 20);
          return JSON.stringify(runs.map((r: any) => ({ id: r.id, workflowName: r.workflowName, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt })));
        }
        case 'list_events': {
          const { limit } = args as { limit?: number };
          const events = this.deps.eventBuffer.getRecent(limit || 20);
          return JSON.stringify(events);
        }
        case 'decompose_task': {
          const { prompt } = args as { prompt: string };
          const plan = await this.deps.decomposer.decompose(prompt, this.deps.agents);
          return JSON.stringify(plan);
        }
        case 'delete_fact': {
          const { factId } = args as { factId: string };
          await this.deps.memory.forget(factId);
          return JSON.stringify({ status: 'deleted', factId });
        }
        default:
          return `Error: Unknown tool "${toolName}". Available tools: query_tasks, create_task, run_workflow, list_workflows, approve_gate, reject_gate, search_memory, remember_fact, list_skills, get_cost_summary, list_agents, list_goals, get_goal_runs, list_pending_gates, list_pending_attention, get_workflow_runs, list_events, decompose_task, delete_fact`;
      }
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`;
    }
  }
}
