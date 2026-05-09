# pragents Dashboard UX Review

_Date: 2026-05-09_

## 🔴 Critical (Functional Gaps)

| # | Problem | View |
|---|---------|------|
| 1 | **Traces volatile** — EventBuffer is in-memory. Lost on server restart or page reload. | Traces, Dashboard |
| 2 | **needs_review tasks have no actions** — No Retry/Complete/Delete buttons. No agent result visible. Operator cannot decide. | Task Detail |
| 3 | **Task Detail doesn't show reason** — The reason for `needs_review` (e.g. "Server restarted") is not displayed. | Task Detail |
| 4 | **"Related traces" dead link** — Links to /traces without taskId filter. User sees all events, not the task's. | Task Detail |
| 5 | **Feed not reachable** — FeedView exists but no navigation link. The only built approval UI is undiscoverable. | Navigation |

## 🟡 Major (Usability)

| # | Problem | View |
|---|---------|------|
| 6 | **Activity Stream unreadable** — Raw events at 3-second intervals, no aggregation, no task grouping. Impossible to read. | Dashboard |
| 7 | **Traces same problem** — `timestamp | agent | type` endless list. No filter, no expand, no task context. | Traces |
| 8 | **Tasks without filter/pagination** — All tasks in one list, no status/project/agent filter. | Tasks |
| 9 | **Task list capped at 5** — Dashboard shows only first 5 tasks. No "X more" badge. | Dashboard |
| 10 | **Agent Grid without context** — Shows only busy/idle/offline. Which agent works on what? No task→agent mapping. | Dashboard |
| 11 | **Hardcoded defaults** — Project "kunde-webshop", agent "dev@kunde-webshop" hardcoded. No dynamic project/agent list. | Dashboard |

## 🟢 Annoying (Quality)

| # | Problem | View |
|---|---------|------|
| 12 | **API URL hardcoded** — `http://localhost:3000` in 4 files. No build-time proxy. | All |
| 13 | **Event types are machine strings** — `workflow.step_completed`, `agent_end` without human labels. | Traces, Dashboard |
| 14 | **No file-based routing** — Feed is not registered as a TanStack route. | Architecture |
| 15 | **No dark mode toggle** — HTML has `class="dark"` but no CSS for it. | Global |
| 16 | **No Task Event Timeline** — No view showing a task's lifecycle (dispatched → running → tool calls → completed). | Missing |
| 17 | **No Agent Session Detail** — Cannot inspect what an agent is currently doing or its message history. | Missing |
| 18 | **Trace detail page unused** — `/traces/$traceId.tsx` exists but trace list has no click targets. | Traces |

## Design Observations

- Three views (Dashboard activity, Traces list, Task list) show essentially the same raw event data in slightly different layouts — none of them answer a concrete user question
- The Feed is the most functionally complete view (gates, review-tasks, blocked, completed, skills) but has zero navigation discoverability
- Task Input Bar is the only "action" affordance in the entire dashboard — everything else is read-only lists
- No view groups information by the user's mental model (project → task → timeline); all views are flat lists
