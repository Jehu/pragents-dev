---
title: "feat: Dashboard UX — 18 Pain Points"
type: feat
status: active
date: 2026-05-09
origin: docs/brainstorms/2026-05-09-dashboard-ux-requirements.md
---

# feat: Dashboard UX — 18 Pain Points

## Summary

Fix the 18 UX pain points identified in the dashboard review. Core approach: extend existing patterns (FeedView aggregation, route factory, TanStack Query, Zustand stores) rather than redesign. Highest-impact changes: persist traces to SQLite so they survive restarts, add actionable buttons to needs_review tasks, make the Feed discoverable via navigation, and replace the raw event firehose with a human-readable aggregated activity stream.

---

## Problem Frame

The pragents dashboard shows raw event streams at 3-second polling with no aggregation, no task context, and no persistence. needs_review tasks offer zero action affordances. The most complete view (Feed) has no navigation link. Traces vanish on every server restart. The operator cannot answer basic questions: "What is agent X working on?" "Why was this task interrupted?" "What happened in the last 10 minutes?" Three views (Dashboard activity, Traces, Task list) display the same raw data differently without answering a single concrete user question.

---

## Requirements

- R1. **Trace Persistence** — Events survive server restarts and page reloads. The operator can inspect task history beyond the current session.
- R2. **Task Actions** — needs_review tasks offer Retry, Mark Complete, and Delete actions. The reason for interruption is visible.
- R3. **Feed Discoverability** — The Feed view (most functionally complete UI) is reachable via the main navigation.
- R4. **Activity Aggregation** — The dashboard activity stream shows human-readable, task-grouped events instead of raw machine strings at 3-second intervals.
- R5. **Task Filters + Pagination** — The task list supports filtering by status, project, and agent, with pagination for large lists.
- R6. **Dynamic Context** — Project and agent dropdowns are populated from the API, not hardcoded. API URLs are relative (Vite proxy), not absolute.
- R7. **Dark Mode Toggle** — The existing `class="dark"` on `<html>` is functional with a user toggle.

**Origin flows:** F1 (Operator inspects interrupted task), F2 (Operator monitors agent activity), F3 (Operator reviews and acts on pending items)

---

## Scope Boundaries

- **In scope:** Trace persistence, task actions, feed navigation, activity aggregation, task filters, dynamic context, dark mode toggle.
- **Deferred to Follow-Up Work:**
  - Agent Session Detail view (inspect live message history — needs SDK session access)
  - Full TanStack Router migration completion (Workflows, Goals, Memory routes)
  - Event-type label mapping as a reusable utility (included inline for now)
  - Memory Explorer UI, Skills UI (M5 remainder)

---

## Context & Research

### Relevant Code and Patterns

- `web/src/components/FeedView.tsx` — **Primary pattern to follow:** intent-filtered sections with count badges, expandable cards with inline actions, skeleton loading, Zustand filter state, TanStack Query dual refresh (polling + SSE invalidation).
- `server/src/api/routes/feed.ts` — Server-side aggregation pattern: single endpoint that queries multiple tables, groups results by intent, returns pre-categorized JSON.
- `web/src/stores/feed.ts` — `useFeedStore` pattern for filter state (project, agent, intent).
- `web/src/stores/scope.ts` — `useScopeStore` exists but is unused — wire it up for dynamic project/agent selection.
- `server/src/db/migrations/` — 010 migrations applied. Next: 011 for events table.
- `server/src/agents/manager.ts` — `getSessionMessages()` exists but no API endpoint exposes it.
- `web/src/routes/__root.tsx` — Navigation with only 3 links (Dashboard, Traces, Tasks). Add Feed.
- `web/vite.config.ts` — Proxy already configured for `/api`, `/ws`, `/sse` to `localhost:3000`. Frontend should use relative URLs.
- `server/src/events/buffer.ts` — EventBuffer (in-memory, 1000 max). Events have `projectId`, `agentId`, `type`, `data`. No `taskId`.

### Institutional Learnings

- `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md` — Five-layer feed pattern is the architectural foundation. Extend, don't replace. Layer 2 (Event System) needs persistence upgrade. Layer 4 (Feed UI) needs navigation discoverability.

---

## Key Technical Decisions

- **Decision: New `events` SQLite table for trace persistence.** The existing `session_messages` table stores full message traces for LLM extraction — a different purpose. Events need their own table optimized for time-range queries and task-scoped filtering. Migration 011. The EventBuffer continues as the in-memory fast path; persistence is write-through on push.

- **Decision: Add `taskId` to EventBuffer events.** Currently events carry `projectId` + `agentId` but no `taskId`. Adding `taskId` enables task-scoped trace queries (R1) and the task timeline view. The tasks route already emits `{ taskId }` in event data — surface it at the event level.

- **Decision: Complete the Feed route as a proper TanStack file-based route.** Currently `feed/index.tsx` is a stub. The FeedView is the most complete UI — make it a first-class TanStack route and add it to `__root.tsx` navigation.

- **Decision: New activity endpoint with server-side aggregation.** Instead of piping raw EventBuffer output to the UI, create `GET /api/v1/activity` that groups events by task, applies human-readable labels, and returns pre-aggregated recent activity. Follows the feed endpoint's server-side grouping pattern.

---

## Open Questions

### Resolved During Planning

- **Trace persistence strategy**: New `events` SQLite table with write-through from EventBuffer. Not reusing `session_messages` (different purpose).
- **Feed routing approach**: Proper TanStack file-based route, not a nav hack.

### Deferred to Implementation

- **Exact event retention policy**: Default 30-day TTL, configurable via environment variable. Exact cleanup interval deferred.
- **Pagination page size**: Default 20 tasks per page. Configurable via query parameter.

---

## Implementation Units

### U1. Trace Persistence

**Goal:** Events survive server restarts. Task-scoped trace queries return a task's full lifecycle. Trace detail page is linked from the list.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `server/src/db/migrations/011_events.sql`
- Modify: `server/src/events/buffer.ts`
- Modify: `server/src/index.ts` (traces endpoint, taskId on events)
- Modify: `web/src/routes/traces/index.tsx`
- Modify: `web/src/routes/traces/$traceId.tsx`

**Approach:**
- Migration 011: `CREATE TABLE events (id INTEGER PRIMARY KEY, project_id TEXT, agent_id TEXT, task_id TEXT, type TEXT, data TEXT, timestamp TEXT)`. Index on `task_id`, `timestamp`, and `(project_id, timestamp)`.
- `EventBuffer.push()`: after adding to the in-memory ring, also INSERT into the `events` table (write-through).
- `GET /api/v1/traces`: reads from `events` table instead of `EventBuffer.getRecent()`. Supports `?taskId=`, `?project=`, `?limit=`, `?since=` parameters.
- `GET /api/v1/traces/:id`: reads single event from `events` table by PK.
- Add `taskId?: string` to `PragentsEvent` type. Update the task route's event emissions to set `taskId`.
- Trace list: make each row clickable → navigate to `/traces/:id`. Add taskId column when filtered.
- Trace detail: render the full event JSON with syntax highlighting and a link back to the parent task.

**Patterns to follow:**
- Migration pattern from `001_initial.sql` through `010_skill_extraction_fields.sql`.
- EventBuffer push pattern — extend `push()` method, not replace.
- Hono route pattern — inline in `index.ts` (current traces are inline), or extract to factory.

**Test scenarios:**
- Happy path: Dispatch a task, verify events appear in `events` table with correct `task_id`, `agent_id`, `project_id`.
- Happy path: `GET /api/v1/traces?taskId=X` returns only events for that task.
- Happy path: Server restart → `GET /api/v1/traces` returns events from before restart.
- Edge case: `?limit=50` returns at most 50 events.
- Edge case: No events exist → returns empty array, not error.
- Integration: Trace list rows are clickable and navigate to detail view.

**Verification:**
- After dispatching and completing a task, `GET /api/v1/traces?taskId=<id>` returns the task's full event lifecycle.
- After server restart, the traces page still shows historical events.
- Clicking a trace row opens the detail page.

---

### U2. Task Actions + Reason Display

**Goal:** needs_review tasks show actionable buttons (Retry, Mark Complete, Delete) and display the interruption reason.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `server/src/api/routes/tasks.ts`
- Modify: `web/src/routes/tasks/$taskId.tsx`

**Approach:**
- Add `POST /api/v1/tasks/:id/retry` — re-dispatches the task to the same agent with the same description. Resets status to `pending`/`running`.
- Add `POST /api/v1/tasks/:id/complete` — manually marks task as `complete` with a note. For operator override when work was actually done.
- Add `DELETE /api/v1/tasks/:id` — soft-deletes (sets status to `deleted`).
- In task detail UI: add Retry / Mark Complete / Delete buttons in the needs_review banner. Show `task.reason` below the status grid.
- The Retry button should show a loading state and re-fetch the task on completion.
- Fix "Related traces" link: change `href` from `/traces` to `/traces?taskId=${task.id}` (enabled by U1's taskId filter).
- Render task event timeline below the task detail using `GET /api/v1/traces?taskId=X` (enabled by U1). Shows the task's lifecycle (dispatched → running → tool calls → completed) as a chronological event list with human-readable labels.

**Patterns to follow:**
- Existing `POST /tasks/:id/unblock` in `tasks.ts` route — same pattern for retry/complete.
- GateCard approve/reject button pattern from FeedView — loading state + refetch on action.

**Test scenarios:**
- Happy path: `POST /tasks/:id/retry` resets status to `running` and dispatches to the same agent.
- Happy path: `POST /tasks/:id/complete` sets status to `complete`.
- Happy path: `DELETE /tasks/:id` soft-deletes the task.
- Edge case: Retry on already-completed task returns 409.
- Edge case: Complete on already-completed task returns 409.
- UI: Click Retry → loading state → task refreshes with new status.
- UI: Reason text is visible in the task detail view.

**Verification:**
- A needs_review task shows Retry, Mark Complete, Delete buttons and the interruption reason.
- Clicking Retry dispatches the task again.
- Clicking Mark Complete resolves the task.

---

### U3. Feed Navigation + Route

**Goal:** The Feed is reachable from the main navigation and is a proper TanStack file-based route.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `web/src/routes/__root.tsx`
- Modify: `web/src/routes/feed/index.tsx`

**Approach:**
- Add "Feed" to the `__root.tsx` navigation bar: `<a href="/feed">Feed</a>`.
- Rewrite `feed/index.tsx` as a proper TanStack route: `export const Route = createFileRoute('/feed/')({ component: FeedView })`.
- The FeedView component already exists and works — just needs routing and navigation.

**Patterns to follow:**
- Existing route files: `index.tsx`, `tasks/index.tsx`, `traces/index.tsx`.

**Test scenarios:**
- Happy path: Click "Feed" in nav → navigates to `/feed` → FeedView renders.
- Happy path: Direct URL `/feed` renders FeedView.
- Edge case: Navigation highlights active route (Feed link is visually distinct when on /feed).

**Verification:**
- The Feed is accessible via a single click from any page.
- Browser back/forward works correctly between Feed and other views.

---

### U4. Activity Stream → Aggregated Feed

**Goal:** The dashboard activity stream shows human-readable, task-grouped recent activity instead of raw machine-string events at 3-second intervals.

**Requirements:** R4

**Dependencies:** U1 (needs persisted events for historical queries)

**Files:**
- Create: `server/src/api/routes/activity.ts`
- Modify: `server/src/index.ts` (mount activity route)
- Modify: `web/src/routes/index.tsx` (replace raw event list)

**Approach:**
- New `GET /api/v1/activity?project=&limit=20` endpoint. Server-side:
  1. Query last N events from the `events` table (U1).
  2. Group consecutive events by `taskId`.
  3. Apply human-readable labels: `agent_end` → "Completed task", `task.created` → "Dispatched task", `skill.proposed` → "Skill proposal ready for review", etc.
  4. Return grouped entries: `[{ taskId, agentId, events: [{ type, label, timestamp }], latestTimestamp }]`.
- Dashboard: replace the raw event list with a `RecentActivity` section that renders the grouped entries as expandable cards showing the task description + event timeline.
- Remove the 3-second polling — use the SSE connection for live updates, with the activity endpoint as initial load.

**Patterns to follow:**
- Feed endpoint aggregation pattern (`server/src/api/routes/feed.ts`).
- FeedView card pattern (expandable, timestamps, action buttons).

**Test scenarios:**
- Happy path: `GET /api/v1/activity` returns recent events grouped by task.
- Happy path: Events have human-readable labels, not raw type strings.
- Edge case: No events → returns empty array.
- Edge case: `?limit=5` returns at most 5 groups.
- UI: Dashboard shows "Recent Activity" section with task cards, each expandable to show the event timeline.

**Verification:**
- The dashboard activity section shows task-grouped entries with readable labels.
- Expanding a card shows the task's event timeline.
- The view updates via SSE without polling jank.

---

### U5. Task List Filters + Pagination

**Goal:** The task list supports filtering by status, project, and agent, with pagination.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `server/src/api/routes/tasks.ts`
- Modify: `web/src/routes/tasks/index.tsx`
- Modify: `web/src/routes/index.tsx` (dashboard task list)

**Approach:**
- Extend `GET /api/v1/tasks` with query params: `?status=`, `?project=`, `?agent=`, `?page=`, `?limit=`.
- Server-side: build WHERE clause from filters, ORDER BY created_at DESC, apply LIMIT/OFFSET for pagination.
- Return `{ tasks: [...], total: N, page: P, limit: L }` so the frontend can render pagination controls.
- Frontend: add filter bar with status dropdown (All / Running / Complete / Failed / needs_review / Blocked), project dropdown, agent dropdown.
- Dashboard task list: remove the 5-item cap, show a "View all →" link with a count badge.
- Add simple prev/next pagination buttons.

**Patterns to follow:**
- Feed filter pattern (`?project=&agent=&intent=`).
- Feed intent pill selector → adapted as status filter.

**Test scenarios:**
- Happy path: `GET /api/v1/tasks?status=needs_review` returns only needs_review tasks.
- Happy path: `GET /api/v1/tasks?project=X` returns only tasks for project X.
- Happy path: `GET /api/v1/tasks?page=2&limit=10` returns page 2.
- Edge case: No tasks match filters → returns empty array with total=0.
- UI: Filter dropdown changes update the task list.
- UI: Pagination buttons navigate between pages.

**Verification:**
- Filtering by "needs_review" shows only interrupted tasks.
- The task list paginates when there are more than the page limit.

---

### U6. Dynamic Context + API URL Fix

**Goal:** Project and agent selections are populated from the API. API URLs use the Vite proxy (relative paths), not hardcoded localhost.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `web/src/routes/index.tsx`
- Modify: `web/src/routes/tasks/index.tsx`
- Modify: `web/src/routes/tasks/$taskId.tsx`
- Modify: `web/src/routes/traces/index.tsx`
- Modify: `web/src/routes/traces/$traceId.tsx`
- Modify: `web/src/hooks/useWebSocket.ts`
- Modify: `web/src/hooks/useSSE.ts`
- Modify: `web/src/components/FeedView.tsx`
- Modify: `web/src/stores/scope.ts`

**Approach:**
- Replace all `const API = 'http://localhost:3000'` with empty string `''` (or just use relative URLs directly). The Vite dev server already proxies `/api`, `/ws`, `/sse` to port 3000.
- Wire `useScopeStore` into the dashboard dispatch form: project dropdown reads from `GET /api/v1/projects`, agent dropdown reads from `GET /api/v1/agents`.
- Pass selected project/agent from the store to the dispatch call.
- The agent grid already shows all agents — add a hover tooltip showing the current task description when the agent is busy.

**Patterns to follow:**
- `useFeedStore` filter pattern — `setFilter('project', value)`.
- Existing `GET /api/v1/agents` endpoint returns `[{ id, status, type, model }]`.

**Test scenarios:**
- Happy path: Project dropdown shows all configured projects from the API.
- Happy path: Agent dropdown shows all agents with their current status.
- Happy path: Selecting a project and agent dispatches to the correct target.
- Edge case: No projects configured → dropdown shows empty state.
- Edge case: API unreachable → dropdowns gracefully show fallback or error state.
- UI: API calls use relative URLs (`/api/v1/tasks`), not `http://localhost:3000/api/v1/tasks`.

**Verification:**
- The dashboard no longer contains any hardcoded project or agent names.
- All API calls work through the Vite proxy without CORS issues.

---

### U7. Dark Mode Toggle

**Goal:** The `class="dark"` on `<html>` is functional and toggleable by the user.

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `web/src/routes/__root.tsx`
- Modify: `web/uno.config.ts`
- Create: `web/src/stores/theme.ts`

**Approach:**
- Create `useThemeStore` (Zustand): `{ dark: boolean, toggle: () => void }`. Initialize from `localStorage` or system preference.
- On toggle, add/remove `class="dark"` on `<html>`.
- Add dark mode CSS variables in `uno.config.ts` using `presetUno({ dark: 'class' })`.
- Add a sun/moon toggle button in the header.
- Wire dark mode classes into existing components (background, text, border colors) by adding `dark:` variants to key elements. Start with the shell (header, body background, card backgrounds) — full component dark mode is deferred.

**Patterns to follow:**
- Zustand store pattern from `useFeedStore` and `useScopeStore`.
- UnoCSS dark mode: `presetUno({ dark: 'class' })` + `dark:` class variants in JSX.

**Test scenarios:**
- Happy path: Click dark mode toggle → `<html>` gets `class="dark"`, colors invert.
- Happy path: Reload page → dark mode preference persists from localStorage.
- Edge case: First visit → respects `prefers-color-scheme` media query.
- Edge case: No localStorage support → gracefully falls back to light mode.

**Verification:**
- Toggling dark mode changes the page appearance.
- The preference survives page reload.
- The header shows a visible dark mode toggle button.

---

## System-Wide Impact

- **Interaction graph:** `EventBuffer.push()` → writes to both in-memory ring and `events` table. `GET /traces` → reads from `events` table. `GET /activity` → reads from `events` table, groups by taskId. Task actions (retry/complete/delete) → update task status, emit events with taskId.
- **Error propagation:** Trace persistence failures are logged but don't block event emission (best-effort write-through). Activity endpoint gracefully returns empty on DB errors.
- **State lifecycle risks:** The `events` table grows unbounded — add same TTL cleanup pattern as `session_messages` (30 days, periodic interval in `index.ts`).
- **Unchanged invariants:** EventBuffer API surface is unchanged (additive change only). Existing route signatures are preserved (new query params are optional). TanStack Router tree is extended, not restructured.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Event persistence adds write latency to the hot path | Write-through is best-effort with try/catch — event emission is not blocked by DB write |
| Task action endpoints (retry) may surface session lifecycle edge cases | Reuse existing `sessionMgr.dispatch()` — same code path as initial dispatch |
| Dark mode may produce visual regressions in complex components | Start with shell-only dark mode (header, body, cards). Defer full component pass |
| Activity aggregation query may be slow with many events | Index on `(task_id, timestamp)`. Limit to last 100 groups. TTL keeps table size bounded |

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-09-dashboard-ux-requirements.md](../../brainstorms/2026-05-09-dashboard-ux-requirements.md)
- Related code: `web/src/routes/index.tsx`, `web/src/routes/__root.tsx`, `web/src/components/FeedView.tsx`, `server/src/api/routes/feed.ts`, `server/src/events/buffer.ts`, `server/src/agents/manager.ts`
- Related learning: `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`
s/agent-native-task-feed-inbox-2026-05-08.md`
