import { Hono } from 'hono';
import type { TaskTracker } from '../../tasks/tracker.js';
import type { AgentSessionManager } from '../../agents/manager.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { EventBuffer } from '../../events/buffer.js';
import { logger } from '../../logging/index.js';
export function createTasksRoute(tracker: TaskTracker, agents: ResolvedAgent[], sessionMgr: AgentSessionManager, eventBuffer: EventBuffer) {
  const r = new Hono();

  r.post('/', async (c) => {
    const body = await c.req.json();
    const { projectId, agentId, description } = body;

    if (!description?.trim()) {
      return c.json({ error: 'Description is required' }, 400);
    }

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) {
      return c.json({ error: `Agent "${agentId}" not found in configuration` }, 400);
    }

    const task = tracker.create({ projectId, agentId, description: description.trim() });

    // Dispatch with lifecycle events + capture agent result.
    // Dispatch first: if it throws, task state is untouched (stays pending).
    // Only mark running after a successful dispatch handoff.
    const dispatchPromise = sessionMgr.dispatch(agent, description.trim());

    try {
      tracker.setRunning(task.id);
      eventBuffer.push(projectId, agentId, 'task.running', { taskId: task.id }, task.id);
    } catch (err) {
      logger.error({ taskId: task.id, err }, 'tasks: setRunning failed after successful dispatch — marking task as error');
      try { tracker.setFailed(task.id, 'State update failed after dispatch'); } catch { /* best-effort */ }
    }

    dispatchPromise.then((result) => {
      tracker.setComplete(task.id, result);
      eventBuffer.push(projectId, agentId, 'task.complete', { taskId: task.id, result }, task.id);
    }).catch((err: Error) => {
      tracker.setFailed(task.id, err.message);
      eventBuffer.push(projectId, agentId, 'task.failed', { taskId: task.id, error: err.message }, task.id);
    });

    return c.json(task, 201);
  });

  r.get('/', (c) => {
    const projectId = c.req.query('project');
    const status = c.req.query('status');
    const agent = c.req.query('agent');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);

    let tasks = tracker.list(projectId || undefined);

    // Server-side filtering
    if (status) {
      tasks = tasks.filter((t) => t.status === status);
    }
    if (agent) {
      tasks = tasks.filter((t) => t.agentId === agent);
    }

    // Sort by creation time (newest first)
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = tasks.length;
    const offset = (page - 1) * limit;
    const paginated = tasks.slice(offset, offset + limit);

    return c.json({ tasks: paginated, total, page, limit });
  });

  r.get('/:id', (c) => {
    const task = tracker.get(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
  });

  r.post('/:id/unblock', (c) => {
    const task = tracker.get(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (task.status !== 'blocked') return c.json({ error: 'Task is not blocked' }, 400);
    tracker.setPending(task.id);
    eventBuffer.push(task.projectId, task.agentId, 'task.unblocked', { taskId: task.id }, task.id);
    return c.json({ status: 'pending' });
  });

  // Retry a needs_review or failed task
  r.post('/:id/retry', async (c) => {
    const task = tracker.get(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (task.status === 'running' || task.status === 'complete') {
      return c.json({ error: `Task is already ${task.status}` }, 409);
    }

    const agent = agents.find((a) => a.id === task.agentId);
    if (!agent) {
      return c.json({ error: `Agent "${task.agentId}" not found in configuration` }, 400);
    }

    // Dispatch first; only mark running after successful handoff.
    const retryDispatchPromise = sessionMgr.dispatch(agent, task.description);

    try {
      tracker.setRunning(task.id);
      eventBuffer.push(task.projectId, task.agentId, 'task.retried', { taskId: task.id }, task.id);
    } catch (err) {
      logger.error({ taskId: task.id, err }, 'tasks: setRunning failed after successful retry dispatch — marking task as error');
      try { tracker.setFailed(task.id, 'State update failed after retry dispatch'); } catch { /* best-effort */ }
    }

    retryDispatchPromise.then((result) => {
      tracker.setComplete(task.id, result);
      eventBuffer.push(task.projectId, task.agentId, 'task.complete', { taskId: task.id, result }, task.id);
    }).catch((err: Error) => {
      tracker.setFailed(task.id, err.message);
      eventBuffer.push(task.projectId, task.agentId, 'task.failed', { taskId: task.id, error: err.message }, task.id);
    });

    return c.json({ ...task, status: 'running' });
  });

  // Manually mark a task as complete
  r.post('/:id/complete', (c) => {
    const task = tracker.get(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    tracker.setComplete(task.id, 'Manually marked complete by operator');
    eventBuffer.push(task.projectId, task.agentId, 'task.manual_complete', { taskId: task.id }, task.id);
    return c.json({ status: 'complete' });
  });

  // Soft-delete a task (marks as failed with deletion note)
  r.delete('/:id', (c) => {
    const task = tracker.get(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    tracker.setFailed(task.id, 'Manually deleted by operator');
    eventBuffer.push(task.projectId, task.agentId, 'task.deleted', { taskId: task.id }, task.id);
    return c.json({ status: 'failed', reason: 'Manually deleted by operator' });
  });

  return r;
}
