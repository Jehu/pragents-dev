import { describe, it, expect } from 'vitest';
import { DirectRouter } from '../direct-router.js';

describe('DirectRouter', () => {
  const router = new DirectRouter();

  describe('tryRoute', () => {
    // ---- query_tasks ----
    it('routes "Zeig alle failed Tasks" → query_tasks with status: failed', () => {
      const result = router.tryRoute('Zeig alle failed Tasks');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('query_tasks');
      expect(result!.args).toHaveProperty('status', 'failed');
    });

    it('routes "welche tasks sind pending" → query_tasks with status: pending', () => {
      const result = router.tryRoute('welche tasks sind pending');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('query_tasks');
      expect(result!.args).toHaveProperty('status', 'pending');
    });

    it('routes "tasks von agent dev" → query_tasks', () => {
      const result = router.tryRoute('tasks von agent dev');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('query_tasks');
    });

    it('routes "Welche Tasks sind failed?" → query_tasks (AE1)', () => {
      const result = router.tryRoute('Welche Tasks sind failed?');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('query_tasks');
      expect(result!.args).toHaveProperty('status', 'failed');
    });

    it('routes "blocked tasks" → query_tasks', () => {
      const result = router.tryRoute('blocked tasks');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('query_tasks');
    });

    it('routes "needs review" → query_tasks', () => {
      const result = router.tryRoute('needs review');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('query_tasks');
    });

    // ---- create_task ----
    it('routes "erstell einen task" → create_task', () => {
      const result = router.tryRoute('erstell einen task');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('create_task');
    });

    it('routes "neuer task für dev" → create_task', () => {
      const result = router.tryRoute('neuer task für dev');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('create_task');
    });

    // ---- run_workflow ----
    it('routes "start den weekly-article Workflow" → run_workflow', () => {
      const result = router.tryRoute('start den weekly-article Workflow');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('run_workflow');
      expect(result!.args).toHaveProperty('name', 'weekly-article');
    });

    it('routes "führ workflow aus" → run_workflow', () => {
      const result = router.tryRoute('führ workflow aus');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('run_workflow');
    });

    it('routes "trigger deployment" → run_workflow', () => {
      const result = router.tryRoute('trigger deployment');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('run_workflow');
    });

    it('routes "deploy content-pipeline" → run_workflow', () => {
      const result = router.tryRoute('deploy content-pipeline');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('run_workflow');
    });

    // ---- list_workflows ----
    it('routes "welche workflows gibt es" → list_workflows', () => {
      const result = router.tryRoute('welche workflows gibt es');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_workflows');
    });

    it('routes "zeig workflows" → list_workflows', () => {
      const result = router.tryRoute('zeig workflows');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_workflows');
    });

    // ---- search_memory ----
    it('routes "was weißt du über den Bug" → search_memory', () => {
      const result = router.tryRoute('was weißt du über den Bug');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('search_memory');
    });

    it('routes "erinner mich an den Bug von letzter Woche" → search_memory', () => {
      const result = router.tryRoute('erinner mich an den Bug von letzter Woche');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('search_memory');
      // Should extract the topic
      expect(result!.args).toHaveProperty('query');
    });

    it('routes "memory facts about api" → search_memory', () => {
      const result = router.tryRoute('memory facts about api');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('search_memory');
    });

    // ---- remember_fact ----
    it('routes "merk dir den API key" → remember_fact', () => {
      const result = router.tryRoute('merk dir den API key');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('remember_fact');
    });

    it('routes "speicher diese Info" → remember_fact', () => {
      const result = router.tryRoute('speicher diese Info');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('remember_fact');
    });

    // ---- list_agents ----
    it('routes "welche agents gibt es" → list_agents', () => {
      const result = router.tryRoute('welche agents gibt es');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_agents');
    });

    it('routes "agent status" → list_agents', () => {
      const result = router.tryRoute('agent status');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_agents');
    });

    it('routes "zeig agents" → list_agents', () => {
      const result = router.tryRoute('zeig agents');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_agents');
    });

    // ---- get_cost_summary ----
    it('routes "wie sind die kosten" → get_cost_summary', () => {
      const result = router.tryRoute('wie sind die kosten');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('get_cost_summary');
    });

    it('routes "token verbrauch" → get_cost_summary', () => {
      const result = router.tryRoute('token verbrauch');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('get_cost_summary');
    });

    it('routes "cost summary" → get_cost_summary', () => {
      const result = router.tryRoute('cost summary');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('get_cost_summary');
    });

    // ---- list_skills ----
    it('routes "welche skills" → list_skills', () => {
      const result = router.tryRoute('welche skills');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_skills');
    });

    it('routes "zeig skills" → list_skills', () => {
      const result = router.tryRoute('zeig skills');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_skills');
    });

    // ---- delete_fact ----
    it('routes "lösch den fact" → delete_fact', () => {
      const result = router.tryRoute('lösch den fact');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('delete_fact');
    });

    it('routes "vergiss das" → delete_fact', () => {
      const result = router.tryRoute('vergiss das');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('delete_fact');
    });

    it('routes "delete memory" → delete_fact', () => {
      const result = router.tryRoute('delete memory');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('delete_fact');
    });

    // ---- list_pending_gates ----
    it('routes "welche gates sind offen" → list_pending_gates', () => {
      const result = router.tryRoute('welche gates sind offen');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_pending_gates');
    });

    it('routes "genehmigungen" → list_pending_gates', () => {
      const result = router.tryRoute('genehmigungen');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_pending_gates');
    });

    it('routes "approval pending" → list_pending_gates', () => {
      const result = router.tryRoute('approval pending');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_pending_gates');
    });

    // ---- list_goals ----
    it('routes "welche ziele" → list_goals', () => {
      const result = router.tryRoute('welche ziele');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_goals');
    });

    it('routes "goals" → list_goals', () => {
      const result = router.tryRoute('goals');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_goals');
    });

    // ---- list_events ----
    it('routes "was ist passiert" → list_events', () => {
      const result = router.tryRoute('was ist passiert');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_events');
    });

    it('routes "zeig aktivität" → list_events', () => {
      const result = router.tryRoute('zeig aktivität');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_events');
    });

    it('routes "events" → list_events', () => {
      const result = router.tryRoute('events');
      expect(result).toBeTruthy();
      expect(result!.tool).toBe('list_events');
    });

    // ---- null returns (fall through to NL Decomposer) ----
    it('returns null for ambiguous message "Was ist kaputt?"', () => {
      const result = router.tryRoute('Was ist kaputt?');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = router.tryRoute('');
      expect(result).toBeNull();
    });

    it('returns null for "Deploy" without workflow name (incomplete)', () => {
      const result = router.tryRoute('deploy');
      expect(result).toBeNull();
    });

    it('returns null for vague greeting "hallo"', () => {
      const result = router.tryRoute('hallo');
      expect(result).toBeNull();
    });

    it('returns null for complex briefing "Bau mir eine Landing Page für mein Startup"', () => {
      const result = router.tryRoute('Bau mir eine Landing Page für mein Startup');
      expect(result).toBeNull();
    });

    // ---- English keywords ----
    it('matches English keywords equally', () => {
      expect(router.tryRoute('show tasks')!.tool).toBe('query_tasks');
      expect(router.tryRoute('list agents')!.tool).toBe('list_agents');
      expect(router.tryRoute('cost')!.tool).toBe('get_cost_summary');
      expect(router.tryRoute('remember this')!.tool).toBe('remember_fact');
    });
  });
});
