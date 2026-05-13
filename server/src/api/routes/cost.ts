import { Hono } from 'hono';
import type { CostTracker } from '../../tracking/cost-tracker.js';

export function createCostRoute(costTracker: CostTracker) {
  const r = new Hono();

  r.get('/summary', (c) => {
    const projectId = c.req.query('project');
    if (projectId) {
      const stats = costTracker.getProjectCost(projectId);
      return c.json(stats);
    }
    const report = costTracker.getMonthlyReport();
    return c.json(report);
  });

  r.get('/agent/:id', (c) => {
    const stats = costTracker.getAgentCost(c.req.param('id'));
    return c.json(stats);
  });

  r.get('/today', (c) => {
    const projectId = c.req.query('project') || undefined;
    const result = costTracker.getDailyCost(undefined, projectId);
    return c.json(result);
  });

  r.get('/by-model', (c) => {
    const since = c.req.query('since') || undefined;
    const result = costTracker.getCostByModel(since);
    return c.json(result);
  });

  return r;
}
