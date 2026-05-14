---
title: "fix: UI/UX audit follow-up — resolve 19 bugs and UX issues"
type: fix
status: active
created: 2026-05-14
origin: docs/reviews/2026-05-14-ux-audit.md
---

# fix: UI/UX audit follow-up — resolve 19 bugs and UX issues

## Summary

The 2026-05-14 UX audit found 19 issues across the pragents web UI: 1 blocker (TaskDetail crash), 5 major (4 broken Chat flows, 1 broken Memory search), 8 minor (polish + small functional gaps), and 5 nice-to-have. This plan resolves all of them, sequenced so the critical user-flow blockers ship first and the nice-to-have polish ships last.

The plan touches the web SPA in `web/src/routes/` (most issues are render-side), with smaller backend additions in `server/src/api/routes/` (new endpoints for conversation history, workflow run trigger, goal-run trigger) and a memory-engine fix for the broken vector search. No schema migrations are introduced — the audit issues are surface-level, not data-model issues.

---

## Problem Frame

The UX audit was produced by an automated UI agent walking through every view at 2026-05-14. Findings landed in `docs/reviews/2026-05-14-ux-audit.md`. Severities and IDs (B-1, M-1…M-5, m-1…m-8, n-1…n-5) in this plan map 1:1 to the audit doc.

**Critical path noted in the audit:** TaskDetail crash → Chat broken (4 bugs) → Memory search broken. These five together block the primary user flows of "inspect a task", "talk to an agent", and "find a memory". They become Phase 1 of this plan.

The Minor and Nice-to-have categories are mostly small frontend changes plus three new backend endpoints (conversation messages, workflow run trigger, goal run trigger).

---

## Scope

### In scope (all 19 audit issues)

- 🔴 Blocker: B-1 (TaskDetail crash)
- 🟠 Major: M-1, M-2, M-3, M-4 (Chat flows), M-5 (Memory search + scope filter)
- 🟡 Minor: m-1 through m-8
- 🔵 Nice-to-have: n-1 through n-5

### Scope Boundaries

#### Out of scope

- Schema migrations or large data backfills — audit issues do not require new tables
- Redesign of any view's information architecture — only fixing the documented gaps
- New feature work outside the audit scope

#### Deferred to Follow-Up Work

- A general accessibility audit of focus states, keyboard navigation, and ARIA labels. The current audit only touched functional bugs visible at runtime
- Mobile / narrow-viewport layout review — audit ran at desktop width

---

## Key Technical Decisions

### KD-1 · Memory search fix: repair the vector index, no SQL substring fallback

User chose "Korrekt: Vector-Index reparieren" over the pragmatic SQL-substring fallback. The fix is at the memory engine layer (`server/src/memory/engine.ts` + vector-store implementation): ensure embeddings are written on every `remember()` call, lower the score threshold to a value that yields hits for casual word overlap, and verify the existing facts get back-embedded on engine init if missing. No ILIKE fallback; if vector search returns nothing for a query, that result is honored.

### KD-2 · Memory scope filter: derive scope type from scope value at API layer

The frontend filter exposes 4 buckets (`all`, `company`, `project`, `agent`) but DB rows store the concrete scope value (e.g., `kunde-webshop`, `office@company`). Rather than a migration, the API derives the type at query time: `scope=company` means `WHERE scope = 'company'`, `scope=project` means `WHERE scope IN (<known project ids>)`, `scope=agent` means `WHERE scope LIKE '%@%'`. This keeps the schema stable and matches the existing `MemoryEngine.recall()` semantics.

### KD-3 · Chat conversation creation: inline picker, not modal

"+ New conversation" clears the active conversation and shows an inline agent picker above the input field. No modal. The first message sent creates the conversation server-side via the existing POST `/api/v1/chat` flow (which already supports the no-conversationId case in `manager.getOrCreate`).

### KD-4 · Chat plan approval: optimistic UI + SSE plan event sync

The 409 the audit reported is a real backend state: plans auto-execute on approve, so the second click sees status `done`. Fix is purely client-side: after the first approve, hide the buttons immediately (optimistic), then subscribe to `plan.approved` / `plan.cancelled` events via the existing `useEventBusStore` to update the final pill.

### KD-5 · "+ New task" wires to ⌘K palette, no separate modal

`web/src/routes/overview/index.tsx` already references a future ⌘K palette in its `alert()` placeholder. The fix is one line: replace the alert with `useCommandPaletteStore.getState().setOpen(true)`. No new modal component.

### KD-6 · Health / Metrics / Costs polish stays UI-only

Health's "COMPLETE" badge problem is a misuse of `StatusPill` — fix by rendering a literal "OK" badge in `web/src/routes/health/index.tsx`. Metrics' raw `skillSuccessRate:` warning is a copy fix. Costs' `—` placeholders become `€0.00` / `0`. No backend changes.

---

## Phased Delivery

- **Phase 1 — Critical (5 units, U1–U5):** Resolve the blocker and all five Major issues so the UI is usable for the primary flows. Ship as a single PR.
- **Phase 2 — Minor (8 units, U6–U13):** Resolve all `m-*` issues. Can ship as one PR or split per logical area (Chat-adjacent vs. Polish).
- **Phase 3 — Nice-to-have (4 units, U14–U17):** Resolve all `n-*` issues. Ship last; lowest risk.

---

## Implementation Units

### U1. Fix TaskDetail crash on tasks without trace events

**Issue:** B-1 (Blocker)

**Goal:** TaskDetail renders successfully for every task in the system, including the 16 Failed-tasks that have no trace events.

**Dependencies:** None.

**Files:**
- `web/src/routes/tasks/$taskId.tsx` (modify, line ~54–125)
- `web/src/routes/tasks/__tests__/$taskId.test.tsx` (create — file does not currently exist)

**Approach:**
Same root cause as the traces fix already landed in commit `a504093`: `firstTrace.id` from the traces API is a `number` (SQLite rowid), not a `string`. The component calls `firstTrace.id?.slice(0, 8)` which throws for numbers.

Apply the same `String(firstTrace.id)` conversion in two places: the visible trace label and the `params={{ traceId: ... }}` prop. The route params must also be string-typed.

**Patterns to follow:** Mirror the existing fix in `web/src/routes/traces/index.tsx` (commit `a504093`) where `truncateId` was widened to `string | number` and the route param was wrapped in `String()`.

**Test scenarios:**
- Renders TaskDetail for a COMPLETE task with at least one trace — `firstTrace.id` is a number → no crash, trace link visible with short hash.
- Renders TaskDetail for a FAILED task with no traces — `firstTrace` is `undefined` → no crash, no trace link, rest of detail visible.
- Renders TaskDetail when traces is `undefined` (API still loading) — no crash.

**Verification:** Navigating to every existing task ID under `/tasks/$taskId` does not produce the "Something went wrong!" error boundary. All 30 audit tasks open successfully.

---

### U2. Chat: "+ New conversation" creates a draft conversation with inline agent picker

**Issue:** M-1

**Goal:** Clicking "+ New conversation" produces a usable empty-conversation state with an agent picker, and the next message sent creates a real conversation.

**Dependencies:** None.

**Files:**
- `web/src/routes/chat/index.tsx` (modify around line 100–115 and 220–470)
- `web/src/routes/chat/__tests__/index.test.tsx` (extend — likely create if absent)

**Approach:**
Click handler sets `activeConvId = undefined` and a new `draftAgentId` state. When `activeConvId` is undefined and `draftAgentId` is set, render the empty chat area with the agent's name visible above the message input. The existing POST `/api/v1/chat` flow handles the no-conversationId case by creating one server-side (see `server/src/api/routes/chat.ts` line 130).

Reuse the agents list already loaded by the `useQuery(['agents'])` in `__root.tsx` — pass it down as a prop or hit the cached query inside the chat route.

**Patterns to follow:** The agent picker styling should mirror the Project picker in `web/src/routes/__root.tsx`.

**Test scenarios:**
- Click "+ New conversation" with no active conversation → agent picker appears, chat area shows empty state.
- Pick an agent → header above input shows that agent.
- Send first message → POST fires with `agentId` set, `conversationId` absent; response sets `activeConvId` and clears the draft state.
- Click "+ New conversation" while a conversation is active → returns to draft state without losing the existing conversation in the sidebar.

**Verification:** A fresh user can start a conversation with any of the 4 configured agents end-to-end without touching the URL.

---

### U3. Chat: Resolve agent name and load conversation history

**Issue:** M-2, M-3

**Goal:** Conversations in the sidebar show the agent's name (or a meaningful title), and clicking a conversation loads its prior messages into the chat area.

**Dependencies:** None (independent of U2).

**Files:**
- `server/src/api/routes/chat.ts` (modify — add `GET /conversations/:id/messages`)
- `server/src/api/routes/__tests__/chat.test.ts` (extend)
- `web/src/routes/chat/index.tsx` (modify around line 120–130 and 220–280)

**Approach:**
Server: add `GET /api/v1/chat/conversations/:id/messages` returning the array from `conversationManager.getHistory(convId)`. The manager method already exists (`server/src/chat/manager.ts` line 150).

Web: when `activeConvId` is set, fire a `useQuery(['chat-messages', activeConvId], ...)` and render the returned messages in the chat area. Replace the "Start a conversation below" placeholder with the real history.

Agent name resolution: the sidebar already calls `conv.agentName ?? conv.agentId ?? 'Unknown agent'` (line 125). Either populate `agentName` server-side in the `listRecent` response or join client-side against the agents query. Server-side is simpler — extend the SELECT in `ConversationManager.listRecent` to include the agent display name.

**Patterns to follow:** Existing message-render logic in chat web for streamed messages (line 160–215) can be reused for the historical message rendering.

**Test scenarios:**
- GET `/api/v1/chat/conversations/:id/messages` for a known conversation returns messages ordered by `created_at`.
- GET for an unknown conversation returns 404.
- Sidebar renders the agent ID (or display name) instead of "Unknown agent" for every conversation.
- Clicking a sidebar entry loads and renders its full message history.
- Switching conversations swaps the rendered history (no leftover messages from the previous conversation).

**Verification:** The existing `a33adf70-…` conversation shows "office@company" (or similar) in the sidebar and renders its messages when clicked.

---

### U4. Chat: Plan approval syncs UI state via optimistic update + SSE

**Issue:** M-4

**Goal:** Clicking Approve on a plan-proposal message hides the buttons immediately and shows the plan's final status once the plan event arrives.

**Dependencies:** None.

**Files:**
- `web/src/routes/chat/index.tsx` (modify around line 180–200)
- `web/src/routes/chat/__tests__/index.test.tsx` (extend)

**Approach:**
The chat web already calls `POST /api/v1/plans/:id/approve`. The audit's "404" was actually the 409 returned because the plan auto-executes and the second click sees `status=done` (see `server/src/api/routes/plans.ts` line 63).

Fix is client-only:
1. On approve click, set local state `approvedPlanIds.add(msg.planId)` before the fetch — buttons disappear immediately.
2. Subscribe to `plan.approved` / `plan.cancelled` events via `useEventBusStore` and update each plan-proposal message's rendered status pill.
3. Suppress the "Processing your request..." indicator once any `plan.*` event for this conversation arrives.

**Patterns to follow:** The optimistic-update pattern already used in `web/src/routes/overview/index.tsx` for inbox approve/reject (mutation `onSuccess` invalidates query).

**Test scenarios:**
- Click Approve once → buttons hide immediately.
- Receive `plan.approved` event → status pill changes to "Approved".
- Receive `plan.cancelled` event → status pill changes to "Cancelled".
- Click Approve, then receive 409 from the server → UI does not bounce back to showing the buttons (already-approved state holds).
- Approve a plan in conversation A → state for plans in conversation B is unaffected.

**Verification:** Approving the existing plan in the audit conversation transitions the UI cleanly to "Approved" without the perpetual "Processing…" indicator.

---

### U5. Memory: Repair vector embeddings + lower score threshold

**Issue:** M-5 (first half — search returns nothing)

**Goal:** Searching `/memory` for "blog" returns the two facts containing "Blog tone…" and "Blog content pipeline…".

**Dependencies:** None.

**Files:**
- `server/src/memory/engine.ts` (modify `recall` / `searchGlobal` — line 109–115 area)
- `server/src/memory/vector-store/simple.ts` (modify — investigate embed-on-insert)
- `server/src/memory/__tests__/engine.test.ts` (extend or create)

**Approach:**
Investigate at `server/src/memory/vector-store/simple.ts`:
1. Verify `remember()` writes an embedding for every fact. If a fact was inserted before embedding was wired up, it stays unsearchable — the engine init should backfill missing embeddings on boot.
2. Inspect the score threshold used in `vectorStore.search()` — likely too strict for the small `SimpleVectorStore` cosine-similarity defaults. Lower to a value that yields hits for casual word overlap (e.g., 0.3).
3. Ensure the search query itself gets embedded the same way as facts (same model, same normalization).

Validate against the three existing facts in the database — searching their first significant word (e.g., "blog", "article", "pipeline") must return them.

**Patterns to follow:** Existing test setup in `server/src/memory/__tests__/` (whichever fixtures it uses for the engine).

**Test scenarios:**
- `engine.recall("blog", "kunde-webshop", 10)` returns both "Blog tone…" and "Blog content pipeline…" facts.
- `engine.recall("article", "kunde-webshop", 10)` returns at least one fact containing "article".
- A newly-remembered fact is searchable immediately by a keyword from its content.
- Engine init detects facts without embeddings and backfills them — count of facts with embeddings == total fact count after init.
- Search for a totally unrelated word (e.g., "xyzzy") returns 0 facts (threshold isn't too low either).

**Verification:** UI search at `/memory` for "blog", "article", "pipeline" each returns results; previously "No facts found".

---

### U6. Memory: Scope filter accepts type names ("project", "agent", "company")

**Issue:** M-5 (second half — scope filter buckets)

**Goal:** Picking "Project" in the Memory scope filter returns facts whose scope is any project ID (e.g., `kunde-webshop`), not zero results.

**Dependencies:** None.

**Files:**
- `server/src/api/routes/memory.ts` (modify the GET handlers — line 9–50)
- `server/src/api/routes/__tests__/memory.test.ts` (extend)
- `web/src/routes/memory/index.tsx` (verify — likely no change)

**Approach:**
KD-2 chose API-layer scope-type derivation. In `memory.ts`:
- `scope=company` → `WHERE scope = 'company'`
- `scope=project` → `WHERE scope IN (<all projectIds from config>)`
- `scope=agent` → `WHERE scope LIKE '%@%'`
- `scope=all` or no scope → no filter

The list of project IDs is available via the existing `config.projects` object (already passed through `createProjectsRoute`). Either pass `config` into `createMemoryRoute` too, or import the resolved config singleton.

**Patterns to follow:** `server/src/api/routes/projects.ts` shows the config-injection pattern.

**Test scenarios:**
- GET `/api/v1/memory/facts?scope=project` returns facts whose scope matches a configured project ID.
- GET `/api/v1/memory/facts?scope=company` returns only facts with scope === "company".
- GET `/api/v1/memory/facts?scope=agent` returns facts whose scope looks like `name@project`.
- GET `/api/v1/memory/facts?scope=all` and no `scope` param both return all facts.
- Unknown scope-type value returns 400 with an explanatory error.

**Verification:** Picking "Project" in the Memory dropdown shows the 3 existing facts (all scoped to `kunde-webshop`).

---

### U7. Tasks: Populate timeline timestamps, cost, and duration

**Issue:** m-5

**Goal:** A COMPLETE task's detail view shows real timestamps for Started/Completed and real numeric values for Cost and Duration.

**Dependencies:** None.

**Files:**
- `server/src/tasks/tracker.ts` (modify — ensure `complete()`/`fail()` set `completed_at`)
- `server/src/agents/manager.ts` (verify `startedAt` is written on task start)
- `server/src/tasks/__tests__/tracker.test.ts` (extend)
- `web/src/routes/tasks/$taskId.tsx` (modify — defensive null rendering)

**Approach:**
The tasks API (`server/src/api/routes/tasks.ts`) already returns `startedAt`, `completedAt`, `costEur`, `durationMs` (see migration `019_task_cost_duration.sql`). Audit shows all values are null even for COMPLETE tasks — root cause is the tracker not writing them.

Audit the tracker's lifecycle methods: every state transition to `running` should set `started_at = now()`, every transition to `complete` or `failed` should set `completed_at` and compute `duration_ms`. Cost should be populated from the cost-log aggregate or recorded inline on task completion.

For tasks that already exist in the DB without these values, leave them as null — the UI fix below ensures they don't show as crashes, only as `—` placeholders (which is acceptable for historical data).

**Patterns to follow:** The `cost_log` join in `tasks.ts` (or wherever the API SELECT lives) shows the existing aggregation pattern.

**Test scenarios:**
- Creating a task → no startedAt/completedAt yet.
- Marking task running → startedAt populated, completedAt still null.
- Marking task complete → both timestamps populated, durationMs > 0.
- Marking task failed → completedAt populated, status === 'failed'.
- Cost is aggregated from cost_log rows tagged with this task's ID.
- UI renders `—` for historical tasks lacking these fields (no crash).

**Verification:** Any task completed after this fix lands shows real Started/Completed timestamps and non-zero Cost/Duration in the UI.

---

### U8. Traces: Short-hash task-ID filter

**Issue:** m-6

**Goal:** Typing the 8-char short hash of a task ID (e.g., `76e91e36`) into the Traces task-ID filter returns the events for that task.

**Dependencies:** None.

**Files:**
- `server/src/api/routes/events.ts` (modify the traces handler)
- `server/src/api/routes/__tests__/traces.test.ts` (create or extend)
- `web/src/routes/traces/index.tsx` (verify — no change needed if backend supports prefix)

**Approach:**
The traces endpoint currently filters with `WHERE task_id = ?` (exact match). Change to `WHERE task_id LIKE ? || '%'` when the input is shorter than 36 chars (a full UUID), otherwise exact match.

Keep the index on `task_id` — LIKE-prefix queries against an indexed column use the index in SQLite.

**Test scenarios:**
- Filter by full UUID returns the exact task's traces.
- Filter by 8-char short hash returns the same set.
- Filter by 3-char prefix that matches multiple tasks returns the union.
- Empty filter returns all traces.
- Filter that matches no task returns empty array.

**Verification:** Pasting any task's short-hash from the Tasks list into the Traces filter shows its events.

---

### U9. Workflows: Clickable card + Run button

**Issue:** m-3

**Goal:** The "Available workflows" card on `/workflows` triggers a new run of that workflow when clicked.

**Dependencies:** None.

**Files:**
- `server/src/api/routes/workflows.ts` (verify or add `POST /:name/run`)
- `server/src/api/routes/__tests__/workflows.test.ts` (extend)
- `web/src/routes/workflows/index.tsx` (modify — make card a button, add handler)

**Approach:**
If `POST /api/v1/workflows/:name/run` does not already exist, add it: call `wfEngine.runWorkflow(name)`. The new run will emit events into the SSE stream that the existing run-list query will pick up via cache invalidation.

Frontend: wrap the card in a button, on click POST to the endpoint and invalidate the `['workflow-runs']` query.

**Patterns to follow:** Goal scheduler dispatch pattern in `server/src/goals/scheduler.ts`.

**Test scenarios:**
- POST `/api/v1/workflows/content-pipeline/run` returns 200 with a new run ID.
- POST for an unknown workflow returns 404.
- POST while a run is in progress returns 200 with a new run ID (concurrent runs allowed) or 409 (if the engine forbids — pick one and stick to it).
- Clicking the card triggers the POST; the run list refreshes within seconds.
- Card has visible affordance (cursor pointer, hover state).

**Verification:** Clicking the `content-pipeline` card adds a new RUNNING entry to the run list.

---

### U10. Plans: Wire conversation link with conversationId

**Issue:** m-2

**Goal:** Clicking "From conversation: a33adf70-…" in plan detail navigates to that conversation in the Chat view.

**Dependencies:** U3 (chat must be able to load history from a conversationId).

**Files:**
- `web/src/routes/plans/$planId.tsx` (modify — line ~165–170)

**Approach:**
Change the existing Link from `to="/chat"` (no search) to `to="/chat"` with `search={{ conversationId: plan.conversationId }}`. The chat route already reads `conversationId` from URL search params (`web/src/routes/chat/index.tsx` line 469).

**Test scenarios:**
- Click the conversation link → URL becomes `/chat?conversationId=<id>`.
- Chat view selects that conversation in the sidebar and loads its history.
- Plans without a conversationId hide the link entirely (no broken navigation).

**Verification:** The existing audit-noted plan's "From conversation" link lands on the right conversation with messages visible.

---

### U11. Overview: "+ New task" opens the ⌘K palette

**Issue:** m-1

**Goal:** Clicking "+ New task" opens the existing command palette in dispatch mode.

**Dependencies:** None.

**Files:**
- `web/src/routes/overview/index.tsx` (modify — line ~301)

**Approach:**
Replace `onClick={() => alert(...)}` with `onClick={() => useCommandPaletteStore.getState().setOpen(true)}`. The palette already exists at `web/src/components/CommandPalette.tsx`.

**Test scenarios:**
- Click "+ New task" on Overview → palette opens.
- Click does not produce a `window.alert()`.
- Palette closes via Escape or backdrop click as before.

**Verification:** No more `window.alert()` in the UI flow.

---

### U12. Agent Skills tab: Link skill names to the Skills library

**Issue:** m-4

**Goal:** Each skill name in the Agent → Skills tab is a clickable link that navigates to that skill in the Skills library.

**Dependencies:** None (works even before U16 — links to skill, library may show empty state if skill isn't yet in the registry).

**Files:**
- `web/src/routes/agents/$agentId.tsx` (modify `SkillsTab` — line ~285–315)

**Approach:**
Wrap each rendered skill name in `<Link to="/skills" search={{ q: skill }}>` (or whatever filter param the skills route exposes — verify). If `/skills/$skillName` is the convention, use that.

**Test scenarios:**
- Skill name renders as a link.
- Click navigates to `/skills` with the skill name filter applied.
- Skill without a matching library entry still navigates (graceful empty state, handled by U16).

**Verification:** Skills in the agent detail are visibly clickable and lead somewhere useful.

---

### U13. Polish: Metrics, Health, Costs copy and formatting

**Issue:** m-7, m-8, n-5

**Goal:** Three small UI fixes:
- Metrics: replace `skillSuccessRate: no skill.used events in window` with human text.
- Health: replace "COMPLETE" badge on connection rows with "OK" or a dot.
- Costs: render `0` as `€0.00` / `0` instead of `—`.

**Dependencies:** None.

**Files:**
- `web/src/routes/metrics/index.tsx` (modify the warning render)
- `web/src/routes/health/index.tsx` (modify status badge usage)
- `web/src/routes/costs/index.tsx` (modify the cost formatter)

**Approach:**
- Metrics: map internal keys to human strings (`skillSuccessRate` → "Skill success rate", etc.) and rewrite the empty-window message: "No skill activity recorded in the last 7 days."
- Health: ship a small inline `<span>OK</span>` styled like a green pill rather than `<StatusPill status="complete" />`. The `StatusPill` enum is task-flavored and shouldn't be reused for connection state.
- Costs: replace the `—` placeholder with `€0.00` (for cost cards) or `0` (for call count). Keep `—` only for genuine "data not loaded".

**Test scenarios:**
- Metrics warning text shows a human-readable sentence.
- Health "DB connected" row shows "OK" badge, not "COMPLETE".
- Costs "This month" with zero spend shows "€0.00", not "—".
- Costs "Total calls" with zero count shows "0", not "—".

**Verification:** Eyeball each view; no internal identifiers or misleading dashes remain.

---

### U14. Remove permanent dev comments from Traces and Workflows

**Issue:** n-1

**Goal:** The two visible developer comments are removed from the rendered UI.

**Dependencies:** None.

**Files:**
- `web/src/routes/traces/index.tsx` (modify — line ~218)
- `web/src/routes/workflows/index.tsx` (modify — the parallel-group note line)

**Approach:**
Delete the `<p>` elements containing the developer notes. The information is captured in code comments / git history — no need to surface in production UI.

**Test scenarios:**
- Test expectation: none — pure copy removal, covered by visual review.

**Verification:** No "Flat event log, not a tree…" or "Parallel-group nesting simplified…" text appears in the UI.

---

### U15. ⌘K palette searches entities (agents, tasks, workflows, conversations)

**Issue:** n-2

**Goal:** Typing "office" in ⌘K returns the `office@company` agent. Typing a task short-hash returns the task. Typing a workflow name returns the workflow.

**Dependencies:** None.

**Files:**
- `web/src/components/CommandPalette.tsx` (modify — add entity providers)
- `web/src/components/__tests__/CommandPalette.test.tsx` (extend)

**Approach:**
The palette currently has Nav, Agents (action-style), Tasks (recent), Skills, Dispatch providers. Per the audit, the search query doesn't actually filter against the agents/tasks lists — verify and fix. Add a Conversations provider that hits `/api/v1/chat/conversations`.

Each entity result is a navigable item: agent → `/agents/$id`, task → `/tasks/$id`, workflow → `/workflows` (no detail route yet), conversation → `/chat?conversationId=$id`.

**Patterns to follow:** Existing provider structure within `CommandPalette.tsx`.

**Test scenarios:**
- Type "office" → office@company agent visible in results.
- Type a task short-hash → matching task visible.
- Type "content" → content-pipeline workflow visible.
- Type any agent ID → conversations with that agent visible (after U3 lands).
- Empty query → recent / pinned items.

**Verification:** Cross-entity navigation works without leaving the keyboard.

---

### U16. Skills library lists agent-config skills

**Issue:** n-3

**Goal:** `/skills` shows the skills referenced in `pragents.yaml` (e.g., `calendar-management`, `task-tracking`) even if they haven't been auto-proposed into the registry.

**Dependencies:** None.

**Files:**
- `server/src/skills/registry.ts` (modify — merge config-declared skills into list output)
- `server/src/api/routes/skills.ts` (verify list handler)
- `server/src/api/routes/__tests__/skills.test.ts` (extend)
- `web/src/routes/skills/index.tsx` (verify rendering — should already handle the new entries)

**Approach:**
The registry returns skills from the SQLite/disk store. Extend the listing to read configured skill names from `config.agents[].skills`, deduplicate against registry-known ones, and emit the config-only entries with a `source: 'config'` flag. Tabs (Active/Proposed/Rejected) treat config-source skills as Active read-only entries.

**Test scenarios:**
- A skill referenced by an agent but absent from the registry appears in the Active tab as a `source: config` entry.
- A skill present in both config and registry appears once (deduplicated).
- A skill registry entry with `status=proposed` still appears in Proposed.

**Verification:** The `calendar-management` and `task-tracking` skills referenced by agents appear in the Skills library.

---

### U17. Goals: Detail view + Run now button

**Issue:** n-4

**Goal:** Goal rows are clickable; opening a goal shows its detail; a "Run now" button triggers an immediate goal run.

**Dependencies:** None.

**Files:**
- `server/src/api/routes/goals.ts` (modify — add `POST /:id/run`)
- `server/src/api/routes/__tests__/goals.test.ts` (extend)
- `server/src/goals/scheduler.ts` (modify — expose `runGoalById(id)`)
- `web/src/routes/goals/index.tsx` (modify — make row clickable, optional drawer/detail)

**Approach:**
Server: expose a one-shot `runGoalById` method on the scheduler that triggers the same workflow or agent dispatch a cron tick would. Wire to `POST /api/v1/goals/:id/run`.

Web: goal rows become buttons that toggle an inline detail block (description, cron preview, deadline preview, last run, "Run now" button). No separate route file required.

**Patterns to follow:** Workflows pattern from U9 for the run trigger.

**Test scenarios:**
- POST `/api/v1/goals/weekly-article/run` returns 200, scheduler triggers a run.
- POST for unknown goal returns 404.
- UI row expand/collapse works.
- "Run now" disables briefly during the request, then refreshes the runs list.

**Verification:** Manually running the `weekly-article` goal produces a new run record without waiting for the next Monday tick.

---

## Test Strategy

- Each unit has explicit test scenarios above. Server-side units extend the existing route test files under `server/src/api/routes/__tests__/`. Web units extend or create co-located `__tests__/` files.
- Run `cd server && npm test` and `cd web && npx vitest run` after each phase.
- Browser smoke-test via Chrome DevTools MCP after Phase 1, Phase 2, and Phase 3 — re-walk the audit's flow paths and confirm each issue is gone.

---

## Risks

- **U5 (Memory search):** The exact failure mode (missing embeddings vs. high threshold) isn't known until the implementer inspects the vector store. The fix may turn out to be one-line (threshold tweak) or require a backfill loop on init. Plan for both.
- **U7 (Task timeline data):** Existing historical tasks will not retroactively get timestamps. Acceptance: only newly-completed tasks need to show real data; historicals remain `—`.
- **U16 (config-source skills):** Mixing config-declared and DB-registered skills in one list may surprise users when they try to approve/reject a config-source skill. Mitigation: render config-source skills with a small badge ("from pragents.yaml") and disable approve/reject for them.

---

## Verification (End-to-End)

After all three phases land, re-run the UX audit flow (manually or with the audit agent re-spawned) and confirm:
- No "Something went wrong!" boundary on any view.
- Chat is usable end-to-end: new conversation, agent name, history, plan approval.
- Memory search returns results for casual word overlap.
- Every numeric stat shows a real number or `0`, not `—`.
- ⌘K finds agents, tasks, workflows, conversations.
- No dev comments visible in production UI.
