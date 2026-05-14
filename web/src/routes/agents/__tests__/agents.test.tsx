import { describe, it, expect } from 'vitest';

// ─── Helpers defined inline (extracted logic) ─────────────────────────────────

type AgentStatus = 'busy' | 'idle' | 'offline';

interface AgentSummary {
  id: string;
  type: string;
  projectId: string;
  model: string;
  skills: string[];
  status: AgentStatus;
}

const STATUS_ORDER: Record<AgentStatus, number> = { busy: 0, idle: 1, offline: 2 };

function sortAgents(agents: AgentSummary[]): AgentSummary[] {
  return [...agents].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3),
  );
}

function agentInitials(id: string): string {
  return id
    .split(/[-_]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function makeAgent(id: string, status: AgentStatus = 'idle'): AgentSummary {
  return { id, type: 'agent', projectId: 'proj', model: 'claude', skills: [], status };
}

// ─── sortAgents ───────────────────────────────────────────────────────────────

describe('sortAgents', () => {
  it('sorts busy before idle before offline', () => {
    const agents = [
      makeAgent('c', 'offline'),
      makeAgent('a', 'idle'),
      makeAgent('b', 'busy'),
    ];
    const sorted = sortAgents(agents);
    expect(sorted[0].id).toBe('b');
    expect(sorted[1].id).toBe('a');
    expect(sorted[2].id).toBe('c');
  });

  it('does not mutate original array', () => {
    const agents = [makeAgent('a', 'offline'), makeAgent('b', 'busy')];
    sortAgents(agents);
    expect(agents[0].id).toBe('a');
  });

  it('keeps order stable for same status', () => {
    const agents = [makeAgent('a', 'idle'), makeAgent('b', 'idle'), makeAgent('c', 'idle')];
    const sorted = sortAgents(agents);
    expect(sorted.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });
});

// ─── agentInitials ────────────────────────────────────────────────────────────

describe('agentInitials', () => {
  it('generates initials from hyphen-separated id', () => {
    expect(agentInitials('research-lead')).toBe('RL');
  });

  it('generates initials from underscore-separated id', () => {
    expect(agentInitials('code_reviewer')).toBe('CR');
  });

  it('handles single-word id', () => {
    expect(agentInitials('orchestrator')).toBe('O');
  });

  it('uses only first two segments', () => {
    expect(agentInitials('a-b-c-d')).toBe('AB');
  });
});

// ─── Routing: first agent selection ───────────────────────────────────────────

describe('agent auto-select logic', () => {
  it('selects the busy agent first when agents are listed', () => {
    const agents = [
      makeAgent('idle-agent', 'idle'),
      makeAgent('busy-agent', 'busy'),
      makeAgent('offline-agent', 'offline'),
    ];
    const first = sortAgents(agents)[0];
    expect(first.id).toBe('busy-agent');
  });

  it('returns no agent to navigate to when list is empty', () => {
    expect(sortAgents([])).toHaveLength(0);
  });
});

// ─── Events tab filter ────────────────────────────────────────────────────────

describe('events tab agent filter', () => {
  interface Event {
    type: string;
    agentId?: string;
    ts: number;
  }

  function filterEventsForAgent(events: Event[], agentId: string): Event[] {
    return events.filter((e) => e.agentId === agentId);
  }

  it('returns only events for the specified agent', () => {
    const events: Event[] = [
      { type: 'task.running', agentId: 'agent-a', ts: 1 },
      { type: 'task.complete', agentId: 'agent-b', ts: 2 },
      { type: 'agent.started', agentId: 'agent-a', ts: 3 },
    ];
    const filtered = filterEventsForAgent(events, 'agent-a');
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.agentId === 'agent-a')).toBe(true);
  });

  it('returns empty array if agent has no events', () => {
    const events: Event[] = [
      { type: 'task.running', agentId: 'agent-b', ts: 1 },
    ];
    expect(filterEventsForAgent(events, 'agent-a')).toHaveLength(0);
  });
});
