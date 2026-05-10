---
title: "fix: Enrich workflow gate approval UI with review context"
type: fix
status: active
date: 2026-05-09
origin: docs/brainstorms/2026-05-07-agent-native-task-feed-requirements.md
---

# fix: Enrich workflow gate approval UI with review context

## Summary

Workflow human gates on the feed page show approve/reject buttons but provide zero information to make that decision — only a label, a truncated UUID, a step ID, and a timeout. The fix enriches the feed API to include workflow name, previous step outputs, pipeline position, and consequence labels, then redesigns the GateCard as an expandable card that surfaces this context so the user can actually review what they're approving.

---

## Problem Frame

The agent-native task feed (built per `docs/plans/2026-05-07-006-feat-agent-native-task-feed-plan.md`) implements requirements R4 and F2 from the origin document. R4 calls for gates to appear with "Workflow-Kontext" and F2 specifies the human sees "Gate-Label, Kontext (Workflow, Step, Agent)". The implementation instead renders a truncated database UUID (`workflowRunId.slice(0, 8)`) and a bare `stepId` — neither of which is meaningful context. The previous workflow step outputs (e.g., a blog draft the user is supposed to review) exist in the database but are never surfaced. The user is asked to approve or reject with no information to base the decision on.

---

## Requirements

- **R1.** Every gate entry in the feed response includes `workflowName` (human-readable) in addition to `workflowRunId`
- **R2.** Every gate entry includes `previousStepOutputs` — the output from each completed step that precedes the gate in the workflow, keyed by step ID
- **R3.** Every gate entry includes `nextSteps` — a list of step IDs and types that follow the gate
- **R4.** The GateCard component shows workflow name, pipeline position, and consequence labels in the collapsed state
- **R5.** The GateCard expands on click to show previous step outputs (the actual content to review) in full, with the same expandable card pattern used by SkillProposalCard and TaskCard
- **R6.** Approve/reject buttons include consequence hints (e.g., "Approve — continue pipeline" / "Reject — stop workflow")
- **R7.** The API change is strictly additive — existing fields on gate objects are preserved, no array restructuring

**Origin actors:** A1 (Agency Owner), A2 (Agent), A3 (pragents Server)
**Origin flows:** F2 (Agent stößt an Human Gate), F3 (Human verschafft sich Überblick)
**Origin acceptance examples:** AE3 (covers R4, R5)

---

## Scope Boundaries

- No changes to the workflow engine, gate creation, or `waitForGate()` polling
- No changes to the gates API routes (`POST /gates/:id/approve`, `/gates/:id/reject`)
- No new dedicated gate detail endpoint — the enriched feed response provides sufficient context
- No changes to workflow YAML schema or loader
- No SSE/WebSocket event changes — the feed polling interval (5s) is sufficient for gate context

---

## Context & Research

### Relevant Code and Patterns

- **Feed API endpoint:** `server/src/api/routes/feed.ts` — current gate query returns only `human_gates` columns; needs enrichment via `WorkflowTracker`
- **WorkflowTracker:** `server/src/workflows/tracker.ts` — `getRun(runId)` returns workflow name + status, `getSteps(runId)` returns all step outputs
- **WorkflowRegistry:** `server/src/workflows/loader.ts` — `get(name)` returns `WorkflowDef` with ordered step array; needed to derive next steps
- **Workflow schema:** `server/src/workflows/schema.ts` — `WorkflowDef.steps[]` defines step ordering
- **Database:** `human_gates` table references `workflow_runs.id` and `workflow_steps.run_id` — no FK constraints, but the relationship is stable
- **GateCard component:** `web/src/components/FeedView.tsx` lines 45–76 — flat non-expandable row, no detail view
- **SkillProposalCard:** `web/src/components/FeedView.tsx` lines 71–147 — expandable card pattern to follow (expanded state, `e.stopPropagation()`, border color matching)
- **TaskCard:** `web/src/components/FeedView.tsx` lines 146–214 — another expandable card with full detail section
- **FeedView query:** `web/src/components/FeedView.tsx` lines 255–261 — TanStack Query with `refetchInterval: 5000`

### Institutional Learnings

- **API response shape changes silently break consumers** (`docs/solutions/integration-issues/api-response-shape-change-breaks-consumers-2026-05-09.md`): Keep additions additive — add new fields to existing gate objects, don't restructure the `gates` array. The existing `workflowRunId` field stays; `workflowName` and `previousStepOutputs` are new additive fields.
- **Feed architecture is a five-layer abstraction** (`docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`): Layer 3 (Feed API) performs server-side aggregation. The fix should enrich the feed endpoint rather than fetching context client-side.
- **Expandable card is the established UX pattern** (`docs/plans/2026-05-09-008-feat-dashboard-ux-18-pain-points-plan.md`): GateCard should follow the same expandable pattern as SkillProposalCard and TaskCard in the same FeedView.

### External References

None — strong local patterns cover all affected areas.

---

## Key Technical Decisions

- **N+1 enrichment via WorkflowTracker, not SQL JOINs:** The codebase has zero JOINs across all endpoints. The `WorkflowTracker.getRun()` + `getSteps()` pattern already exists in `workflows.ts` route's `GET /runs/:id`. For ≤20 pending gates, 40 extra indexed queries are negligible. This avoids introducing a new SQL pattern for a small-scope fix. (see origin: docs/brainstorms/2026-05-07-agent-native-task-feed-requirements.md)
- **WorkflowRegistry injected into feed route factory:** The feed endpoint needs `registry.get(name)` to derive next steps from the workflow definition. The factory function signature changes from `createFeedRoute(tracker, eventBuffer)` to `createFeedRoute(tracker, eventBuffer, registry)`. The `index.ts` wiring already has `registry` in scope.
- **Expandable GateCard with amber border family:** The collapsed card keeps the existing amber-200 border. The expanded section uses `border-amber-100` (light) with `bg-gray-50`, following the SkillProposalCard pattern (blue-200 → blue-100). The approve/reject buttons move into the expanded section to prevent misclicks, with a compact summary action row at the bottom of the collapsed card.
- **Previous step outputs: all completed steps before the gate, not just the immediate predecessor:** A workflow can have multiple steps before a gate (e.g., research → draft → review gate). The user needs both to make an informed decision. Each output is labeled with its step ID and the producing agent.
- **Consequence labels derived from step position:** If the gate is the last step → "Reject — workflow fails". If steps follow → "Approve — continue to [next step name]". If the gate is a mid-pipeline review → "Reject — return to agent for revision". These are computed from the WorkflowDef step array.

---

## Open Questions

### Resolved During Planning

- **Q1 (JOIN vs N+1):** N+1 via WorkflowTracker. See Key Technical Decisions.
- **Q2 (Which previous steps to show):** All completed steps before the gate in the workflow definition. See Key Technical Decisions.
- **Q3 (Button placement):** Approve/reject buttons stay visible in the collapsed card summary row; the expanded section shows full context plus larger action buttons. This preserves one-click action while adding review capability.
- **Q4 (Dedicated gate detail endpoint):** Not needed for this fix — the enriched feed response is sufficient.

### Deferred to Implementation

- Exact CSS spacing and truncation behavior for long step outputs in the expanded card
- Whether to syntax-highlight markdown in step outputs (the draft step produces markdown files)
- Maximum display length before "Show more" toggle in collapsed state

---

## Implementation Units

### U1. Enrich feed API gate response with workflow context

**Goal:** Modify `GET /api/v1/feed` to include workflow name, previous step outputs, and next steps for each pending gate.

**Requirements:** R1, R2, R3, R7

**Dependencies:** None

**Files:**
- Modify: `server/src/api/routes/feed.ts`
- Modify: `server/src/index.ts` (wiring: pass `registry` to `createFeedRoute`)
- Modify: `server/src/api/routes/__tests__/feed.test.ts`

**Approach:**
- Add `registry: WorkflowRegistry` parameter to `createFeedRoute()`
- After the existing `result.gates = db.prepare(gatesSql).all()` call, iterate over gates and for each:
  1. Call `tracker.getRun(gate.workflowRunId)` to get `workflowName`
  2. Call `tracker.getSteps(gate.workflowRunId)` to get all step rows with outputs
  3. Call `registry.get(workflowName)` to get the `WorkflowDef` with ordered step array
  4. Map completed steps that appear before the gate's `stepId` in the definition → `previousStepOutputs` (array of `{ stepId, agentId, output, completedAt }`)
  5. Map steps that appear after the gate's `stepId` → `nextSteps` (array of `{ stepId, type, label }`)
- Preserve all existing fields (`id`, `workflowRunId`, `stepId`, `label`, `createdAt`, `timeoutAt`)
- Gate entries where the workflow run or definition is not found (e.g., deleted workflows) get `workflowName: null`, `previousStepOutputs: []`, `nextSteps: []` — no error thrown

**Patterns to follow:**
- `server/src/api/routes/workflows.ts` lines 26–30 — `tracker.getRun()` + `tracker.getSteps()` pattern
- Existing `db.prepare().all()` style in `feed.ts`

**Test scenarios:**
- Happy path: Create a workflow run with research (complete) → draft (complete) → review gate (pending). Feed response includes `workflowName`, two `previousStepOutputs` (research + draft with their outputs), and `nextSteps` (optimize, finalize)
- Happy path: Gate at position 1 (no previous steps). `previousStepOutputs` is empty array, `nextSteps` contains all subsequent steps
- Edge case: Workflow run exists but workflow definition was deleted from YAML. `workflowName` from DB still resolves; `nextSteps` is empty (definition not found), `previousStepOutputs` still populated from step data
- Edge case: Gate with no completed previous steps (all steps pending/failed). `previousStepOutputs` is empty
- Error path: `tracker.getRun()` returns null (orphaned gate). Gate object gets `workflowName: null`, empty context arrays — gate entry still appears with its label, just without enrichment
- Covers AE3: Filtered feed by project still shows enriched gate data

**Verification:**
- `curl /api/v1/feed` returns gate objects with `workflowName`, `previousStepOutputs[]`, `nextSteps[]` fields
- Existing fields (`id`, `workflowRunId`, `stepId`, `label`, `createdAt`, `timeoutAt`) are preserved
- Feed endpoint still works when `?intent=gates` filter is active
- No 500 errors when workflow definition is missing or run is orphaned

---

### U2. Redesign GateCard with expandable context view

**Goal:** Replace the flat GateCard row with an expandable card that shows workflow context, previous step outputs, pipeline visualization, and consequence-labeled action buttons.

**Requirements:** R4, R5, R6

**Dependencies:** U1 (needs `workflowName`, `previousStepOutputs`, `nextSteps` in gate objects)

**Files:**
- Modify: `web/src/components/FeedView.tsx` (GateCard component, lines 45–76)

**Approach:**

Collapsed state (always visible):
- Row 1: ⏳ icon + gate label (truncated) + amber "pending" badge
- Row 2: Workflow name + step position indicator (e.g., "Step 3 of 5 in content-pipeline")
- Row 3: Compact approve/reject buttons with consequence icons (✓ / ✗) and short labels

Expanded state (on click):
- Pipeline visualization: horizontal step list with status badges (✅ complete, ⏳ current, ⬜ pending), with the gate step highlighted in amber
- Previous step outputs section: for each completed step before the gate, a labeled collapsible block showing the step name, producing agent, completion time, and full output text (with a max-height + overflow-scroll for long outputs)
- Next steps section: brief list of what follows
- Consequence labels: explicit text under each action button
- Full-size approve/reject buttons at the bottom

Interaction:
- Click anywhere on the collapsed card toggles expansion (except buttons)
- Buttons use `e.stopPropagation()` to prevent collapse on click
- `acting` state disables both buttons while request is in flight
- After successful action, `onAction` callback invalidates feed query

**Patterns to follow:**
- `SkillProposalCard` in `FeedView.tsx` lines 71–147 — expandable pattern, `e.stopPropagation()`, border color inheritance
- `TaskCard` in `FeedView.tsx` lines 146–214 — expanded detail section with full output display
- `statusBadge()` function in `FeedView.tsx` lines 22–32 — status-to-color mapping

**Test scenarios:**
- Happy path: Gate with `workflowName: "content-pipeline"`, 2 `previousStepOutputs`, 2 `nextSteps`. Collapsed card shows workflow name and step position. Click expands to reveal both outputs with agent labels, pipeline visualization with checkmarks, and consequence text under buttons
- Happy path: Click Approve → button shows "..." → feed refreshes → gate disappears from pending list
- Happy path: Click Reject → button shows "..." → feed refreshes → gate disappears
- Edge case: Gate with empty `previousStepOutputs` (first step is the gate). Expanded view shows "No previous steps to review" message, pipeline shows gate as step 1
- Edge case: Gate with null `workflowName` (orphaned). Falls back to showing truncated `workflowRunId` as before
- Edge case: Very long step output (5000+ chars). Output is scrollable within a max-height container, not breaking the card layout
- Integration: After approve/reject action, `queryClient.invalidateQueries(['feed'])` fires and the gate list re-renders without the resolved gate

**Verification:**
- Open `/feed` with a pending gate — workflow name is visible in collapsed state
- Click the gate card — pipeline visualization and previous step outputs display
- Previous step outputs include the actual draft/research text the user needs to review
- Approve and reject buttons show consequence hints
- Gate resolves correctly on click and disappears from pending list
- Card matches the visual style of SkillProposalCard and TaskCard (border colors, spacing, font sizes)

---

## System-Wide Impact

- **Interaction graph:** The `createFeedRoute` factory gains a `registry` parameter. The only caller is `server/src/index.ts` where `registry` is already in scope. No other consumers affected.
- **Error propagation:** Gate enrichment failures (missing workflow run, missing definition) are handled gracefully — gates still appear with their label, just without context. No errors propagate to the HTTP response.
- **State lifecycle risks:** None — the enrichment is read-only; no state is mutated.
- **API surface parity:** The `gates` array in the feed response is extended with new fields; existing fields are preserved. The `/api/v1/gates/pending` endpoint is not changed (it's a separate route).
- **Unchanged invariants:** Gate approval/rejection via `POST /api/v1/gates/:id/approve` and `/reject` is unchanged. Workflow engine's `waitForGate()` polling is unchanged. Event emissions on gate resolution are unchanged.
