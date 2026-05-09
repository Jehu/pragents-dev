---
title: "feat: Memory Explorer UI"
type: feat
status: active
date: 2026-05-09
---

# feat: Memory Explorer UI

## Summary

Add a Memory Explorer page at `/memory` that lets the operator browse, search, and curate the agent knowledge base. Browse facts by scope (company/project/agent), full-text and vector search, view session summaries, delete facts, manually add facts, and see memory statistics. All backend APIs already exist — this plan builds the frontend UI and a thin session-summary API addition.

---

## Problem Frame

Agents accumulate facts across sessions via `REMEMBER:` lines, but the operator has no way to see what the agents know. The spec calls for a "Memory Explorer" to browse facts, search embeddings, view session summaries, and curate knowledge. Currently the only access to memory is via `curl /api/v1/memory/facts` — there is no UI and no navigation link.

---

## Requirements

- R1. **Fact Browser** — Browse facts by scope (company, project, agent) with full-text search. Each fact shows category, content, agent, and timestamp.
- R2. **Vector Search** — Search facts semantically across projects using the LanceDB embedding backend.
- R3. **Fact Curation** — Delete facts and manually add new facts via the UI.
- R4. **Session Summaries** — View compressed session summaries from past agent sessions.
- R5. **Memory Stats** — Show total facts, breakdown by scope and category.
- R6. **Navigation** — Memory Explorer is reachable via the main navigation bar.

---

## Scope Boundaries

- **In scope:** Fact browser, vector search, fact delete/add, session summaries, stats, navigation link.
- **Deferred to Follow-Up Work:**
  - Fact editing (update content/category after creation)
  - Batch delete/curation
  - Embedding visualization

---

## Context & Research

### Relevant Code and Patterns

- `web/src/components/FeedView.tsx` — Card pattern with expand, relative timestamps, filter tabs. **Primary pattern to follow.**
- `web/src/routes/tasks/index.tsx` — Filter pill selector + pagination. **Reuse for scope tabs.**
- `web/src/routes/index.tsx` — Dashboard with TanStack Query, refetch intervals, useState filters.
- `server/src/api/routes/memory.ts` — All memory endpoints already exist: `GET /facts`, `GET /search`, `POST /facts`, `DELETE /facts/:id`, `GET /stats`.
- `server/src/db/migrations/001_initial.sql` — `sessions` table with `compressed_summary`.
- `web/src/routes/__root.tsx` — Navigation bar to add Memory link.

### Institutional Learnings

- None directly applicable — Memory Explorer is greenfield UI.

---

## Key Technical Decisions

- **Decision: New `GET /api/v1/memory/sessions` endpoint.** The `sessions` table already stores `compressed_summary` but has no API endpoint. Add a thin route that returns recent session summaries with agent_id and created_at.
- **Decision: Follow FeedView card pattern.** Each fact is a card with category badge, expandable content, delete button, and relative timestamp. Vector search results get a similarity score badge.
- **Decision: Scope tabs as pill selector.** Same pattern as Task status filter and Feed intent filter. Tabs: All / Company / Project / Agent.
- **Decision: Reuse `useScopeStore` for project context.** The store already tracks selected project — use it to pre-filter project-scoped facts.

---

## Open Questions

### Deferred to Implementation

- **Vector search debounce:** Exact debounce interval (300ms default).
- **Session summary pagination:** Page size (20 default).

---

## Implementation Units

### U1. Session Summaries API

**Goal:** Expose session summaries via a new API endpoint.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `server/src/api/routes/memory.ts`
- Test: `server/src/api/routes/__tests__/memory.test.ts` (create if missing)

**Approach:**
- Add `GET /memory/sessions?limit=20` to the memory route.
- Query: `SELECT id, agent_id, compressed_summary, created_at FROM sessions WHERE compressed_summary IS NOT NULL ORDER BY created_at DESC LIMIT ?`.
- Return array of `{ id, agentId, summary, createdAt }`.

**Patterns to follow:**
- Existing `GET /facts` route in `memory.ts` — same Hono handler pattern.
- SQL query pattern from `feed.ts`.

**Test scenarios:**
- Happy path: `GET /memory/sessions?limit=5` returns up to 5 session summaries.
- Edge case: No sessions exist → returns empty array.
- Edge case: Sessions exist but compressed_summary is NULL → excluded from results.

**Verification:**
- `curl /api/v1/memory/sessions` returns session summaries after agent sessions complete.

---

### U2. Memory Explorer Route + Navigation

**Goal:** Create the `/memory` TanStack route and add it to the navigation bar.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Create: `web/src/routes/memory/index.tsx`
- Modify: `web/src/routes/__root.tsx`

**Approach:**
- Create `web/src/routes/memory/index.tsx` using `createFileRoute('/memory/')`.
- Add "Memory" link to `__root.tsx` navigation.
- Route file re-exports the MemoryExplorer component from U3.

**Patterns to follow:**
- File-based route pattern from `tasks/index.tsx`, `traces/index.tsx`.
- Navigation link pattern from existing `__root.tsx` links.

**Test scenarios:**
- Happy path: Click "Memory" in nav → navigates to `/memory` → MemoryExplorer renders.
- Happy path: Direct URL `/memory` renders the page.

**Verification:**
- Memory Explorer is accessible via a single click from any page.

---

### U3. Memory Explorer Component

**Goal:** Build the MemoryExplorer component with fact browser, vector search, curation, and stats.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** U1, U2

**Files:**
- Create: `web/src/components/MemoryExplorer.tsx`
- Modify: `web/src/routes/memory/index.tsx` (import + re-export)

**Approach:**
- **Layout:** Stats bar on top (total facts, by scope, by category), then a tab bar (Browse / Semantic Search / Sessions), then the content area.
- **Browse tab:** Scope filter pills (All / Company / Project / Agent), search input with debounce. Fact cards with: category badge, content preview (expandable), agent + timestamp, delete button (with confirmation).
- **Semantic Search tab:** Search input with debounce, results with similarity score badge, fact cards.
- **Sessions tab:** List of recent session summaries from `GET /memory/sessions`. Each card shows agent, timestamp, and truncated summary text.
- **Add Fact:** Small form at the bottom (or collapsible): scope dropdown, category dropdown, content textarea, submit button.
- **TanStack Query:** `useQuery` for facts/search/stats/sessions with `refetchInterval: 10000`. `useMutation` for delete and add with `onSuccess` invalidation.
- **Delete confirmation:** Simple `window.confirm` before calling DELETE.

**Patterns to follow:**
- FeedView card pattern: expandable, relative timestamps, loading skeletons.
- Task filter pill pattern from `tasks/index.tsx`.
- Dashboard stats query pattern from `index.tsx`.
- Dark mode classes (`dark:`) on all elements.

**Test scenarios:**
- Happy path: Browse tab loads facts grouped by scope, click scope pill to filter.
- Happy path: Enter search term → debounced query returns filtered facts.
- Happy path: Semantic Search tab, enter query → vector search returns scored results.
- Happy path: Click delete on a fact → confirmation → fact disappears from list.
- Happy path: Fill add-fact form, submit → fact appears in list.
- Happy path: Stats bar shows correct counts from `/stats` endpoint.
- Edge case: No facts → shows "No facts yet" placeholder.
- Edge case: Vector search with no query → shows "Enter a search term" placeholder.
- Error path: Delete fails → error toast, fact remains.
- Error path: Add fails → error message, form stays open.

**Verification:**
- Browse tab shows facts with correct scope filtering.
- Semantic search returns relevant results with similarity scores.
- Deleting a fact removes it from the list.
- Adding a fact appears immediately after submit.

---

### U4. Dark Mode + Polish

**Goal:** Ensure Memory Explorer works in dark mode and matches the rest of the dashboard visually.

**Requirements:** None (quality)

**Dependencies:** U3

**Files:**
- Modify: `web/src/components/MemoryExplorer.tsx`

**Approach:**
- Add `dark:` variants to all Tailwind classes (cards, inputs, buttons, badges, text).
- Follow existing dark mode conventions from `__root.tsx` and dashboard `index.tsx`.
- Add loading skeletons for initial data fetch.

**Test scenarios:**
- Toggle dark mode → Memory Explorer colors invert correctly.
- Initial load → shows skeleton cards, then populated cards.

**Verification:**
- Dark mode toggle works on the Memory Explorer page.
- No unstyled elements in either mode.

---

## System-Wide Impact

- **Interaction graph:** New route registers in TanStack Router tree. Navigation link added to `__root.tsx`. Memory API extended with sessions endpoint.
- **Error propagation:** Fact delete/add mutations surface errors via toast or inline message. API failures show the TanStack Query error state.
- **State lifecycle risks:** Add-fact form state resets on submit. Delete removes from query cache optimistically. No cross-tab sync concerns.
- **Unchanged invariants:** Existing memory API endpoints are unchanged. MemoryEngine is unchanged. Facts table schema is unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Vector search may be slow on large fact sets | Limit results to 20. LanceDB is already configured. |
| Fact content may be long → UI overflow | Truncate at 200 chars, expandable on click. |

---

## Sources & References

- Spec: `docs/superpowers/specs/2026-05-06-pragents-design.md` — Sections 9.1, 9.3
- Related code: `server/src/api/routes/memory.ts`, `web/src/components/FeedView.tsx`, `web/src/routes/tasks/index.tsx`
