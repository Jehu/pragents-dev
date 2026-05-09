import { Hono } from 'hono';
import { getDb } from '../../db/sqlite.js';
import type { TaskTracker } from '../../tasks/tracker.js';
import type { EventBuffer } from '../../events/buffer.js';

export function createFeedRoute(tracker: TaskTracker, eventBuffer: EventBuffer) {
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
      result.gates = db.prepare(gatesSql).all();
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
