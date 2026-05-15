/**
 * Tool definitions for agent-native tooling (M6).
 *
 * Each tool wraps an existing service class method and exposes it
 * as a callable function for agents via the pi SDK's customTools system.
 *
 * Parameter schemas are TypeBox-compatible objects validated by the pi SDK.
 */

export interface ToolParamSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParamSchema;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'query_tasks',
    description: 'List tasks for a project. Optionally filter by status (pending, running, complete, failed, needs_review, blocked).',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID to query tasks for' },
        status: { type: 'string', description: 'Filter by task status', enum: ['pending', 'running', 'complete', 'failed', 'needs_review', 'blocked'] },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task and dispatch it to an agent. The agent will work on it asynchronously. Set status=needs_review to create a task that signals the human for review without dispatching to an agent.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        agentId: { type: 'string', description: 'Agent ID (e.g., dev@project-name)' },
        description: { type: 'string', description: 'Task description — what the agent should do' },
        status: { type: 'string', description: 'Task status (default: pending, which triggers dispatch)', enum: ['pending', 'needs_review'] },
      },
      required: ['projectId', 'agentId', 'description'],
    },
  },
  {
    name: 'run_workflow',
    description: 'Trigger a workflow by name. Optionally pass parameters.',
    parameters: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Name of the workflow to run (e.g., content-pipeline)' },
        projectId: { type: 'string', description: 'Project ID' },
        params: { type: 'object', description: 'Optional workflow parameters as key-value pairs' },
      },
      required: ['workflowName', 'projectId'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List all available workflows with their names and descriptions.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'approve_gate',
    description: 'Approve a pending human gate. This allows the workflow to continue.',
    parameters: {
      type: 'object',
      properties: {
        gateId: { type: 'string', description: 'Gate ID to approve' },
      },
      required: ['gateId'],
    },
  },
  {
    name: 'reject_gate',
    description: 'Reject a pending human gate. The workflow step will fail.',
    parameters: {
      type: 'object',
      properties: {
        gateId: { type: 'string', description: 'Gate ID to reject' },
        reason: { type: 'string', description: 'Why the gate was rejected' },
      },
      required: ['gateId'],
    },
  },
  {
    name: 'search_memory',
    description: 'Search the knowledge base for relevant facts. Supports project-scoped and company-scoped search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        scope: { type: 'string', description: 'Memory scope (project, company)', enum: ['project', 'company'] },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember_fact',
    description: 'Persist a fact to the knowledge base for future recall.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember' },
        category: { type: 'string', description: 'Category (convention, decision, pattern, constraint, architecture, error_pattern, dependency)' },
        scope: { type: 'string', description: 'Scope (project or company)', enum: ['project', 'company'] },
      },
      required: ['content', 'category', 'scope'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all available extracted skills with their names and descriptions.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_cost_summary',
    description: 'Get token usage and cost summary for a project.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_agents',
    description: 'List all configured agents with their types, capabilities, and project assignments.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_goals',
    description: 'List all configured goals with their cadence, workflow, and deadline settings.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_goal_runs',
    description: 'Get recent goal runs — check which goals triggered and their status.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'list_pending_gates',
    description: 'List all pending human gates that need approval or rejection.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_pending_attention',
    description: 'List all items waiting for human attention: pending gates, needs_review tasks, and your own blocked tasks. Use this before asking the human for input to avoid duplicates.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID to scope the attention check' },
        agentId: { type: 'string', description: 'Your agent ID — used to filter blocked tasks to only your own' },
      },
      required: ['projectId', 'agentId'],
    },
  },
  {
    name: 'get_workflow_runs',
    description: 'Get recent workflow runs — check workflow status, steps, and results.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'list_events',
    description: 'Get recent platform events — task starts, workflow steps, gate changes.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'decompose_task',
    description: 'Decompose a complex task description into a structured plan with steps and agent assignments.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task to decompose into a plan' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'delete_fact',
    description: 'Remove a fact from the knowledge base by its ID.',
    parameters: {
      type: 'object',
      properties: {
        factId: { type: 'string', description: 'ID of the fact to delete' },
      },
      required: ['factId'],
    },
  },
];
