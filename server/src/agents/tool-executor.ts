import type { TaskTracker } from '../tasks/tracker.js';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { MemoryEngine } from '../memory/engine.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { CostTracker } from '../tracking/cost-tracker.js';
import type { WorkflowRegistry } from '../workflows/loader.js';
import { getDb } from '../db/sqlite.js';

export interface ToolExecutorDeps {
  tracker: TaskTracker;
  wfEngine: WorkflowEngine;
  wfRegistry: WorkflowRegistry;
  memory: MemoryEngine;
  skills: SkillRegistry;
  costTracker: CostTracker;
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
          const { projectId, agentId, description } = args as { projectId: string; agentId: string; description: string };
          const task = this.deps.tracker.create({ projectId, agentId, description });
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
          const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
          if (!gate) return `Error: Gate "${gateId}" not found`;
          if (gate.status !== 'pending') return `Error: Gate "${gateId}" is already ${gate.status}`;
          db.prepare("UPDATE human_gates SET status = 'approved' WHERE id = ?").run(gateId);
          return JSON.stringify({ gateId, status: 'approved' });
        }
        case 'reject_gate': {
          const { gateId, reason } = args as { gateId: string; reason?: string };
          const db = getDb();
          const gate = db.prepare('SELECT status FROM human_gates WHERE id = ?').get(gateId) as any;
          if (!gate) return `Error: Gate "${gateId}" not found`;
          if (gate.status !== 'pending') return `Error: Gate "${gateId}" is already ${gate.status}`;
          db.prepare("UPDATE human_gates SET status = 'rejected' WHERE id = ?").run(gateId);
          return JSON.stringify({ gateId, status: 'rejected', reason: reason || 'No reason provided' });
        }
        case 'search_memory': {
          const { query, scope, limit } = args as { query: string; scope?: string; limit?: number };
          const facts = await this.deps.memory.recall(query, scope || 'project', limit || 10);
          return JSON.stringify(facts);
        }
        case 'remember_fact': {
          const { content, category, scope } = args as { content: string; category: string; scope: string };
          const id = await this.deps.memory.remember({
            content,
            category,
            scope: scope || 'project',
            agentId: 'tool',
          } as any);
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
        default:
          return `Error: Unknown tool "${toolName}". Available tools: query_tasks, create_task, run_workflow, list_workflows, approve_gate, reject_gate, search_memory, remember_fact, list_skills, get_cost_summary`;
      }
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`;
    }
  }
}
