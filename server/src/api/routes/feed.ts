import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { TaskTracker } from '../../tasks/tracker.js';
import type { EventBuffer } from '../../events/buffer.js';
import type { WorkflowTracker } from '../../workflows/tracker.js';
import type { WorkflowRegistry } from '../../workflows/loader.js';

export function createFeedRoute(
  tracker: TaskTracker,
  eventBuffer: EventBuffer,
  wfTracker: WorkflowTracker,
  registry: WorkflowRegistry,
) {
  const r = new Hono();

  r.get('/', (c) => {
    const project = c.req.query('project');
    const agent = c.req.query('agent');
    const intent = c.req.query('intent'); // 'gates' | 'review' | 'blocked' | 'completed'

    const db = getDb();

    // Build project/agent filter clauses for tasks
    const taskProjectClause = project ? 'AND project_id = ?' : '';
    const taskAgentClause = agent ? 'AND agent_id = ?' : '';

    const queryParams: string[] = [];
    if (project) queryParams.push(project);
    if (agent) queryParams.push(agent);

    const result: any = {};

    // --- Pending Gates ---
    if (!intent || intent === 'gates') {
      const gatesSql = `
        SELECT h.id, h.workflow_run_id as workflowRunId, h.step_id as stepId,
               h.label, h.created_at as createdAt, h.timeout_at as timeoutAt
        FROM human_gates h
        WHERE h.status = 'pending'
        ORDER BY h.created_at DESC
        LIMIT 20
      `;
      const rawGates = db.prepare(gatesSql).all() as any[];

      // Enrich gates with workflow context: name, previous step outputs, next steps
      result.gates = rawGates.map((gate: any) => {
        try {
          const run = wfTracker.getRun(gate.workflowRunId);
          const workflowName = run?.workflowName || null;
          const steps = run ? wfTracker.getSteps(gate.workflowRunId) : [];

          // Get workflow definition for step ordering
          let previousStepOutputs: any[] = [];
          let nextSteps: any[] = [];
          if (workflowName) {
            const def = registry.get(workflowName);
            if (def) {
              const gateIndex = def.steps.findIndex((s: any) => s.id === gate.stepId);
              if (gateIndex >= 0) {
                // Previous steps: all steps before the gate
                previousStepOutputs = def.steps
                  .slice(0, gateIndex)
                  .map((s: any) => {
                    const stepRow = steps.find((st: any) => st.stepId === s.id);
                    return {
                      stepId: s.id,
                      type: s.type || 'agent',
                      label: s.label || s.id,
                      agentId: stepRow?.agentId || null,
                      status: stepRow?.status || 'unknown',
                      output: stepRow?.output || null,
                      completedAt: stepRow?.completedAt || null,
                    };
                  });

                // Next steps: steps after the gate
                nextSteps = def.steps
                  .slice(gateIndex + 1)
                  .map((s: any) => ({
                    stepId: s.id,
                    type: s.type || 'agent',
                    label: s.label || s.id,
                  }));
              }
            }
          }

          return {
            ...gate,
            workflowName,
            previousStepOutputs,
            nextSteps,
          };
        } catch {
          // Graceful degradation: return gate without enrichment on any error
          return {
            ...gate,
            workflowName: null,
            previousStepOutputs: [],
            nextSteps: [],
          };
        }
      });
    }

    // --- Pending Skills (M5: extracted proposals waiting for approval) ---
    if (!intent || intent === 'gates') {
      const pendingSkillsSql = `
        SELECT name, description, source_session as extractedFromSession,
               source_agent as sourceAgent, created_at as extractedAt,
               tags, tools, extraction_metadata_yaml as extractionMetadata
        FROM skills
        WHERE status = 'proposed'
        ORDER BY created_at DESC
        LIMIT 20
      `;
      const skills = db.prepare(pendingSkillsSql).all() as any[];
      result.pendingSkills = skills.map((s: any) => ({
        ...s,
        tags: s.tags ? JSON.parse(s.tags) : [],
        tools: s.tools ? JSON.parse(s.tools) : [],
        extractionMetadata: s.extractionMetadata ? (() => {
          try { return JSON.parse(s.extractionMetadata); } catch { return s.extractionMetadata; }
        })() : null,
      }));
    }

    // --- Needs Review Tasks ---
    if (!intent || intent === 'review') {
      const reviewTaskParams = [...queryParams];
      const reviewSql = `
        SELECT id, project_id as projectId, agent_id as agentId, status,
               description, reason, created_at as createdAt, updated_at as updatedAt
        FROM tasks
        WHERE status = 'needs_review' ${taskProjectClause} ${taskAgentClause}
        ORDER BY created_at DESC
        LIMIT 30
      `;
      result.needsReview = db.prepare(reviewSql).all(...reviewTaskParams);
    }

    // --- Blocked Tasks ---
    if (!intent || intent === 'blocked') {
      const blockedParams = [...queryParams];
      const blockedSql = `
        SELECT id, project_id as projectId, agent_id as agentId, status,
               description, reason, created_at as createdAt, updated_at as updatedAt
        FROM tasks
        WHERE status = 'blocked' ${taskProjectClause} ${taskAgentClause}
        ORDER BY created_at DESC
        LIMIT 30
      `;
      result.blocked = db.prepare(blockedSql).all(...blockedParams);
    }

    // --- Completed Tasks ---
    if (!intent || intent === 'completed') {
      const completedTaskParams = [...queryParams];
      const completedTasksSql = `
        SELECT id, project_id as projectId, agent_id as agentId, status,
               description, result, created_at as createdAt, updated_at as updatedAt
        FROM tasks
        WHERE status IN ('complete', 'failed') ${taskProjectClause} ${taskAgentClause}
        ORDER BY updated_at DESC
        LIMIT 20
      `;
      result.completedTasks = db.prepare(completedTasksSql).all(...completedTaskParams);

      // --- Completed Gates (rejected / timed_out) ---
      const completedGatesSql = `
        SELECT h.id, h.workflow_run_id as workflowRunId, h.step_id as stepId,
               h.label, h.status,
               CASE WHEN h.status = 'rejected' THEN h.approved_at ELSE h.timeout_at END as resolvedAt
        FROM human_gates h
        WHERE h.status IN ('rejected', 'timed_out')
        ORDER BY h.approved_at DESC, h.timeout_at DESC
        LIMIT 20
      `;
      result.completedGates = db.prepare(completedGatesSql).all();
    }

    return c.json(result);
  });

  return r;
}
