import { Hono } from 'hono';
import type { TaskTracker } from '../../tasks/tracker.js';
import type { AgentSessionManager } from '../../agents/manager.js';
import type { PragentsConfig, ResolvedAgent } from '../../config/schema.js';

export function createTasksRoute(tracker: TaskTracker, agents: ResolvedAgent[], sessionMgr: AgentSessionManager) {
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

    // Dispatch asynchronously
    tracker.setRunning(task.id);
    sessionMgr.dispatch(agent, description.trim()).then(() => {
      tracker.setComplete(task.id, 'Task completed');
    }).catch((err: Error) => {
      tracker.setFailed(task.id, err.message);
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
