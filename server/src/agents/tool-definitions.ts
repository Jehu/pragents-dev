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
    description: 'List tasks for a project. Optionally filter by status (pending, running, complete, failed).',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID to query tasks for' },
        status: { type: 'string', description: 'Filter by task status', enum: ['pending', 'running', 'complete', 'failed'] },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task and dispatch it to an agent. The agent will work on it asynchronously.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        agentId: { type: 'string', description: 'Agent ID (e.g., dev@project-name)' },
        description: { type: 'string', description: 'Task description — what the agent should do' },
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
];
