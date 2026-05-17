---
title: "feat: Live workflow agent visibility in Overview"
type: feat
status: completed
created: 2026-05-17
origin: user-request
related:
  - docs/brainstorms/2026-05-09-dashboard-ux-requirements.md
  - docs/plans/2026-05-17-001-web-ui-ux-optimization-plan.md
  - docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md
---

# feat: Live workflow agent visibility in Overview

## Summary

Make agents visibly active in the Overview dashboard while they are executing workflow steps. The current UI can show an agent as `idle` even when workflow execution has just involved that agent because workflow dispatches do not create task rows, workflow step events do not carry `agentId`, and the Overview agents query is not invalidated by agent/runtime events.

The implementation should treat workflow step execution as first-class observable work, without forcing workflow steps into the task table.

---

## Problem Frame

The operator expects `dev@karpathy-wiki` to look active while a workflow step is running. Today the Overview agents strip reads `/api/v1/agents`, which derives status from `AgentSessionManager.getAgentStatus()`. That status is accurate only at fetch time and depends on `runtimeHandle.isStreaming`.

Current gaps:

- `server/src/workflows/engine.ts` emits `workflow.step_started` before agent resolution, so the event usually has no `agentId`.
- Workflow agent dispatches call `sessionMgr.dispatch(agent, prompt)` without a task row, so `/api/v1/tasks` cannot explain workflow work.
- Agent runtime events such as `agent_start`, `turn_start`, `turn_end`, and `agent_end` reach SSE, but `web/src/routes/overview/index.tsx` does not invalidate `['agents']` for them.
- The Overview agent card only displays a status pill; it does not show the workflow step or run that caused the activity.
- Very short agent turns can transition busy to idle between query polls, making the work invisible unless the user happens to catch the narrow window.

Success means the Overview page answers: which agent is currently working, on which workflow step, and when that visible state should clear.

---

## Scope

### In Scope

- Enrich workflow step lifecycle events with resolved `agentId`, `workflow`, and `runId`.
- Invalidate the Overview agents query on agent and workflow step lifecycle events.
- Add a lightweight live activity overlay in the Overview UI so agents show as busy immediately after relevant SSE events.
- Surface the active workflow step on the agent card while the step is in progress.
- Add focused tests for event payloads and Overview state transitions.

### Out of Scope

- Converting workflow steps into tasks.
- Adding a new database table for live agent activity.
- Rebuilding the Workflows page.
- Long-term durable session playback or message streaming.
- Changing pi SDK runtime semantics.

---

## Key Decisions

### KD-1. Keep workflow steps distinct from tasks

Workflow steps already have dedicated persistence in `workflow_runs` and `workflow_steps`. Mirroring every step into `tasks` would make task counts misleading and introduce duplicate lifecycle state. The dashboard should observe workflow work through workflow and agent events.

### KD-2. Event-first UI with API reconciliation

Use SSE events for immediate visual feedback, then refetch `/api/v1/agents` to reconcile with backend truth. This follows the existing inbox/feed pattern where events wake up the UI but REST remains the stable source of record.

### KD-3. Emit agent-aware workflow events after agent resolution

`workflow.step_started` should include the selected agent. For agent steps, emit it after `resolveAgent()`. For human gates, keep gate events separate because there is no actively running agent.

### KD-4. Prefer an ephemeral client-side activity map over new persistence

The user's issue is live dashboard visibility, not historical reporting. A small in-memory map keyed by `agentId` is enough for Overview. It can clear on `workflow.step_completed`, `workflow.step_failed`, `agent_end`, or a defensive timeout.

### KD-5. Make short runs visible without lying

For very fast steps, keep the activity indicator visible for a minimum display window, then clear it. The label should reflect recent workflow activity, while the status pill can reconcile back to `idle` once the backend reports idle.

---

## Existing Patterns To Follow

- `web/src/hooks/useSSE.ts` normalizes SSE payloads into `useEventBusStore`.
- `web/src/routes/overview/index.tsx` already invalidates Overview queries from the event bus.
- `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md` documents the event → invalidation → REST refetch pattern.
- `server/src/api/routes/projects.ts` exposes `/api/v1/agents` with `status: sessionMgr.getAgentStatus(a.id)`.
- `server/src/agents/manager.ts` already emits runtime events with `agentId` through the manager callback.

---

## Implementation Units

### U1. Enrich workflow step events with agent context

**Goal:** Workflow events should identify the agent doing the work.

**Files:**

- `server/src/workflows/engine.ts`
- `server/src/workflows/__tests__/engine.test.ts`

**Plan:**

- In single-step execution, resolve the agent before emitting `workflow.step_started`.
- Emit `workflow.step_started` with `{ runId, stepId, workflow: def.name, agentId, projectId: agent.projectId }`.
- Emit `workflow.step_completed` and `workflow.step_failed` with the same agent and workflow context.
- In parallel groups, apply the same payload shape to each parallel sub-step.
- Preserve non-agent events for run start, human gates, and workflow completion.

**Test Scenarios:**

- Single agent step emits `workflow.step_started` with the resolved `agentId`.
- Single agent step completion emits matching `agentId`, `runId`, `stepId`, and `workflow`.
- Failed agent step emits `workflow.step_failed` with `agentId`.
- Parallel steps emit separate start/completion events for each resolved agent.
- Human gate steps do not invent an agent ID.

### U2. Refetch agent status when live agent or workflow events arrive

**Goal:** The Overview agent strip should not wait for normal stale-time expiry after agent runtime changes.

**Files:**

- `web/src/routes/overview/index.tsx`
- `web/src/routes/overview/__tests__/overview.test.tsx`

**Plan:**

- Extend the Overview event invalidation effect.
- Invalidate `['agents']` when the last event type is one of:
  - `agent_start`
  - `agent_end`
  - `turn_start`
  - `turn_end`
  - `workflow.step_started`
  - `workflow.step_completed`
  - `workflow.step_failed`
- Keep existing task/workflow/goal invalidation behavior.
- Consider setting `refetchOnWindowFocus: true` for `['agents']` if not already globally configured.

**Test Scenarios:**

- A `workflow.step_started` event invalidates `['agents']`.
- An `agent_start` event invalidates `['agents']`.
- Existing `task.running` invalidation still only targets `['overview-tasks']` unless the task event also needs agent refresh later.
- Non-lifecycle events do not cause unnecessary agent refetches.

### U3. Add a live workflow activity map for Overview agent cards

**Goal:** Agents should show visible work immediately from SSE events, even before the REST refetch completes or when a step is very short.

**Files:**

- `web/src/routes/overview/index.tsx`
- `web/src/routes/overview/__tests__/overview.test.tsx`

**Plan:**

- Add local state or a small selector-derived map keyed by `agentId`.
- On `workflow.step_started` with `agentId`, store:
  - `agentId`
  - `workflow`
  - `runId`
  - `stepId`
  - `startedAt`
- On `workflow.step_completed` or `workflow.step_failed`, mark the entry as recently finished and clear it after a minimum display window.
- On `agent_end`, clear any activity for that agent after the minimum display window unless a newer `workflow.step_started` exists.
- Add a defensive timeout so stale activity clears if completion events are missed.
- Compute the displayed agent status as:
  - `busy` when there is active workflow activity for that agent
  - otherwise the API-provided `agent.status`

**Test Scenarios:**

- A started event changes the matching agent card status to `busy`.
- The card displays workflow and step context while active.
- A completed event clears or downgrades the activity after the minimum display window.
- An event for another agent does not affect this agent card.
- A stale activity entry expires without a completion event.

### U4. Improve the AgentCard display for active workflow context

**Goal:** The operator should see what the agent is doing, not only that it is busy.

**Files:**

- `web/src/routes/overview/index.tsx`
- `web/src/components/ui/StatusPill.tsx` only if a new status label is needed
- `web/src/routes/overview/__tests__/overview.test.tsx`

**Plan:**

- Extend the `AgentCard` props with optional live activity.
- Under model/project metadata, render a compact line for active workflow work:
  - `workflowName · stepId`
- Keep the card stable in width and height to avoid layout shifts in the horizontal strip.
- Use the existing `busy` status pill rather than adding a new status unless design testing shows `workflow` is clearer.
- Link behavior remains the agent detail page.

**Test Scenarios:**

- Card with no activity renders as before.
- Card with activity shows workflow and step text.
- Long workflow or step names truncate rather than overflow.
- Busy pill appears when live activity exists even if API status is `idle`.

### U5. Optional API hardening for active workflow context

**Goal:** Make active workflow context recoverable on page refresh if needed.

**Files:**

- `server/src/api/routes/projects.ts`
- `server/src/workflows/tracker.ts`
- `server/src/api/routes/__tests__/projects.test.ts` or a new focused agents route test

**Plan:**

- Evaluate during implementation whether the event-only approach is enough.
- If page-refresh recovery is required, add an `activeWorkflowStep` field to `/api/v1/agents` by querying running workflow steps joined to workflow runs.
- Keep this optional unless tests or manual verification show the live map is too fragile.

**Test Scenarios If Implemented:**

- Agent with a running workflow step returns `activeWorkflowStep`.
- Agent with no running step returns `null` or omits the field consistently.
- Multiple running steps select the latest started step deterministically.

---

## Verification Plan

- Run `npm test --workspace server` or targeted server tests after U1.
- Run `npm test --workspace web` or targeted Overview tests after U2-U4.
- Start server and web dev servers.
- Open `http://localhost:5174/overview`.
- Trigger a workflow that dispatches `dev@karpathy-wiki`.
- Confirm the agent card changes to `busy` during the workflow step and shows workflow/step context.
- Confirm the card returns to API-backed idle after completion.
- Confirm recent events still show workflow and agent events.

---

## Risks And Mitigations

- **Very short agent turns may finish before visual refresh.** Use live SSE state plus a minimum visible window.
- **Missed completion event could leave a stuck busy card.** Use a defensive expiry and reconcile on API refetch.
- **Workflow event payload shape changes may affect tests or traces.** Add fields without removing existing fields.
- **Parallel workflow steps may race.** Key activity by `agentId` and timestamp; only clear an entry if the completion corresponds to the current run/step or is older than the active entry.
- **Agent runtime events are lower-level than workflow events.** Prefer workflow events for context, use `agent_start`/`agent_end` for reconciliation only.

---

## Open Questions

- Should active workflow context also appear on `/agents` and the agent detail route, or only Overview for this pass?
- Should the minimum display window be fixed in Overview, or shared as a UI constant if other pages adopt live activity later?
- If workflow execution is resumed after server restart, do we need API-backed active step context immediately, or can that wait until a later observability pass?
