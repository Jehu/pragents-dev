---
title: Agent-Native Task Feed — Inbox Pattern for Agent Orchestration
date: 2026-05-08
category: architecture-patterns
module: agent-platform
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - Building agent orchestration platforms where agents need to signal for human attention
  - Adding human-in-the-loop gates, review requests, or blocked-state signaling
  - Consolidating scattered agent intents into a single operator view
tags: [agent-native, task-feed, inbox, human-in-the-loop, event-driven]
---

# Agent-Native Task Feed — Inbox Pattern for Agent Orchestration

## Context

pragents had tasks, gates, and events scattered across separate views — a flat task list in one place, a gate list in another, event traces in a third. For a one-person agency owner managing multiple specialized agents (Dev, SEO, Content, PM, Office), there was no single place that answered: *"Which agents need my attention right now?"*

The core gap was structural: the system had signals (agents could set `needs_review`, workflows could stop at human gates, agents could get stuck on external dependencies) but no aggregation layer. The operator had to manually poll each view and mentally triage. Agents had no way to check what was already pending before asking the human again.

## Guidance

The implementation follows a five-layer pattern, each building on the one below:

### Layer 1 — Data Model: dedicated `reason` column and `blocked` status

Two schema changes in `server/src/db/migrations/008_task_feed.sql`:

- **New `reason TEXT` column on `tasks`**: Instead of overloading the `result` column (which holds task outputs), a dedicated column stores the *human-readable reason* an agent provides when signaling for attention. The migration backfills existing `needs_review` rows by moving `result` → `reason` where appropriate.

- **New `blocked` status in CHECK constraint**: Extended `TaskStatus` from `'pending','running','complete','failed','needs_review'` to include `'blocked'`. The table was rebuilt (SQLite doesn't support `ALTER TABLE` for CHECK changes) using the CREATE-INSERT-DROP-RENAME pattern inside a transaction.

- **Optional `external_ref TEXT` column**: Laid groundwork for a future issue tracker adapter (Plane, Linear) — the feed is designed as an abstraction boundary, not tied to a specific storage backend.

On the service layer, `TaskTracker` (`server/src/tasks/tracker.ts`) gained `setBlocked()`, `setPending()`, and `setNeedsReview()` was extended to accept a dedicated `reason` parameter. `create()` was extended to allow an initial `status` parameter — so agents can create tasks directly in `needs_review` status, effectively sending messages to the human without queuing work.

**Key design decision: `blocked → pending` only.** From `blocked`, only `pending`, `needs_review`, or `failed` are valid targets. `blocked → complete` is forbidden — blocked work hasn't been executed, so it can't be "completed."

### Layer 2 — Event System: gate and task state changes emit events

When a human acts on a gate or unblocks a task, the server emits events through the `EventBuffer` so the UI updates immediately — without waiting for the next poll cycle:

```typescript
// server/src/api/routes/gates.ts — approve/reject
eventBuffer.push('workflow', undefined, 'gate.approved', {
  gateId, workflowRunId, stepId, label });

// server/src/api/routes/tasks.ts — unblock
eventBuffer.push(task.projectId, task.agentId, 'task.unblocked', { taskId });
```

The `EventBuffer` (`server/src/events/buffer.ts`) is a ring buffer (max 1000 events) with auto-incrementing IDs. The Web UI connects via SSE (`web/src/hooks/useSSE.ts`) and invalidates the feed query cache on every event — triggering a fresh REST fetch. New event types: `gate.approved`, `gate.rejected`, `gate.timed_out`, `task.blocked`, `task.unblocked`.

### Layer 3 — Feed API: single endpoint aggregating gates + tasks

`server/src/api/routes/feed.ts` exposes `GET /api/v1/feed` — a single endpoint that queries gates and tasks separately, assembles a pre-grouped response:

```json
{
  "gates":         [...],
  "needsReview":   [...],
  "blocked":       [...],
  "completedTasks": [...],
  "completedGates": [...]
}
```

Query parameters: `?project=<id>`, `?agent=<id>`, `?intent=gates|review|blocked|completed`. Each group is independently SQL-queried with `ORDER BY created_at DESC` and its own LIMIT. This server-side aggregation avoids N+1 REST calls from the client and keeps the feed endpoint as a single abstraction point for future data sources.

### Layer 4 — Feed UI: grouped inbox with inline actions

`web/src/components/FeedView.tsx` renders the feed as stacked, labeled groups in priority order:

1. **⏳ Waiting for You** — pending human gates with Approve/Reject buttons
2. **👀 Needs Review** — tasks flagged for human review
3. **🚫 Blocked** — tasks waiting on external conditions (with Unblock button)
4. **✅ Recently Completed** — completed tasks + resolved gates

Data fetching uses TanStack Query with two-layer freshness: polling (`refetchInterval: 5000`) plus SSE invalidation. Filter state is managed via Zustand (`web/src/stores/feed.ts`). Loading skeletons render during initial fetch.

### Layer 5 — Agent Tools: `list_pending_attention`

`server/src/agents/tool-definitions.ts` registers a new tool:

```typescript
{
  name: 'list_pending_attention',
  description: 'List all items waiting for human attention: pending gates,
    needs_review tasks, and your own blocked tasks. Use this before asking
    the human for input to avoid duplicates.',
  parameters: {
    properties: {
      projectId: { type: 'string' },
      agentId: { type: 'string' },
    },
    required: ['projectId', 'agentId'],
  },
}
```

Scope: pending gates and needs_review tasks are project-wide (the agent needs awareness of what the human already sees), but blocked tasks are filtered to only the calling agent. This prevents multiple agents from independently signaling the same issue.

## Why This Matters

**For the operator:** The feed collapses three mental polling operations into one glance — prioritized by urgency with inline actions. In under 5 seconds after opening, know which agents need attention without manual searching.

**For the agents:** `list_pending_attention` eliminates duplicate signaling. The tool description explicitly encodes the workflow: *"Use this before asking the human for input to avoid duplicates."*

**For the architecture:** The feed endpoint is an abstraction boundary. When a future issue tracker adapter is implemented, it slots in behind `GET /api/v1/feed` without changing UI or agent tools. The `external_ref` column is ready.

**For the event system:** Gate event emissions close the loop between user action and visual confirmation. The SSE→invalidation→refetch pipeline is now available to all UI components.

## When to Apply

- **Building agent orchestration platforms** — Any system where multiple autonomous agents produce work requiring human oversight benefits from a unified attention feed. The five-layer pattern transfers directly.
- **Adding human-in-the-loop workflows** — When workflows have approval gates, the feed pattern prevents gates from getting lost. Gate cards with inline actions keep the decision surface compact.
- **Systems where agents need structured human signaling** — If agents can signal multiple intent types (review, blocked, question, approval), the grouped feed pattern gives the human a mental model that matches what the agent communicates. The `reason` column pattern keeps agent intents semantically distinct from agent outputs.
- **Preventing duplicate agent requests** — The `list_pending_attention` tool pattern applies whenever multiple agents share a human operator.

## Examples

### Dedicated `reason` column

```sql
-- server/src/db/migrations/008_task_feed.sql
ALTER TABLE tasks ADD COLUMN reason TEXT;
UPDATE tasks SET reason = result WHERE status = 'needs_review' AND result IS NOT NULL;
```

### Event-driven gate actions

```typescript
// server/src/api/routes/gates.ts
r.post('/:id/approve', (c) => {
  // ... update DB ...
  eventBuffer.push('workflow', undefined, 'gate.approved', {
    gateId: gate.id, workflowRunId: gate.workflow_run_id,
    stepId: gate.step_id, label: gate.label,
  });
  return c.json({ status: 'approved' });
});
```

### Aggregated feed endpoint

```typescript
// server/src/api/routes/feed.ts
r.get('/', (c) => {
  const result: any = {};
  if (!intent || intent === 'gates') {
    result.gates = db.prepare(
      "SELECT ... FROM human_gates WHERE status = 'pending' ... LIMIT 20"
    ).all();
  }
  if (!intent || intent === 'review') {
    result.needsReview = db.prepare(
      "SELECT ... FROM tasks WHERE status = 'needs_review' ... LIMIT 30"
    ).all(...params);
  }
  return c.json(result);
});
```

### Dual refresh: polling + SSE invalidation

```tsx
// web/src/components/FeedView.tsx
const { data } = useQuery({
  queryKey: ['feed', filters],
  queryFn: () => fetch(`/api/v1/feed?${params}`).then(r => r.json()),
  refetchInterval: 5000,
});

// web/src/main.tsx — SSE listener
queryClient.invalidateQueries({ queryKey: ['feed'] });
```

### Agent `list_pending_attention` scope

```typescript
// server/src/agents/tool-executor.ts
case 'list_pending_attention': {
  const { projectId, agentId } = args;
  const gates = db.prepare("SELECT ... FROM human_gates WHERE status = 'pending'").all();
  const needsReview = tracker.list(projectId).filter(t => t.status === 'needs_review');
  const ownBlocked = tracker.list(projectId).filter(t => t.status === 'blocked' && t.agentId === agentId);
  return JSON.stringify({ gates, needsReview, blocked: ownBlocked });
}
```

## Related

- **Plan:** `docs/plans/2026-05-07-006-feat-agent-native-task-feed-plan.md`
- **Requirements:** `docs/brainstorms/2026-05-07-agent-native-task-feed-requirements.md`
- **PR:** [#1](https://github.com/Jehu/pragents-dev/pull/1) (merged)
