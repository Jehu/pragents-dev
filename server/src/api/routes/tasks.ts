import { Hono } from 'hono';
import type { TaskTracker } from '../../tasks/tracker.js';
import type { AgentSessionManager } from '../../agents/manager.js';
import type { ResolvedAgent } from '../../config/schema.js';
import type { EventBuffer } from '../../events/buffer.js';

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

    // Dispatch with lifecycle events + capture agent result
    tracker.setRunning(task.id);
    eventBuffer.push(projectId, agentId, 'task.running', { taskId: task.id });

    sessionMgr.dispatch(agent, description.trim()).then((result) => {
      tracker.setComplete(task.id, result);
      eventBuffer.push(projectId, agentId, 'task.complete', { taskId: task.id, result });
    }).catch((err: Error) => {
      tracker.setFailed(task.id, err.message);
      eventBuffer.push(projectId, agentId, 'task.failed', { taskId: task.id, error: err.message });
    });

    return c.json(task, 201);
  });

  r.get('/', (c) => {
    const projectId = c.req.query('project');
    const tasks = tracker.list(projectId || undefined);
    return c.json(tasks);
  });

  r.get('/:id', (c) => {
    const task = tracker.get(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
  });

  return r;
}
