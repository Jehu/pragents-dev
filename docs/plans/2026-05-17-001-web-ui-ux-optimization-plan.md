---
title: "feat: Web UI/UX optimization pass"
type: feat
status: active
created: 2026-05-17
origin: user-request
---

# feat: Web UI/UX optimization pass

## Summary

This plan turns the current web UI from a mostly functional route collection into a more reliable operator dashboard. The review found five cross-cutting gaps: silent API failures, incomplete mobile/narrow layouts, inconsistent modal accessibility, shallow design primitives, and weak operator prioritization on Overview.

The work is sequenced so trust and safety issues land first, then layout/accessibility, then management affordances and visual consistency.

---

## Problem Frame

PrAgents is an operational tool for a one-person agency. The UI must make it obvious what needs attention, what is running, what is at risk, and whether a user action actually succeeded.

Current state:

- Several routes silently convert API failures into empty states.
- Human approval actions can optimistically disappear even when the server rejects the request.
- The app shell is desktop-first and degrades poorly on narrow screens.
- Multiple modal implementations coexist, only one has proper focus handling.
- UI primitives are mostly hand-rolled per route, so buttons, panels, and page structures drift.
- Goals and Workflows expose monitoring and run actions, but not a complete management surface.

---

## Scope

### In scope

- Standardize fetch/mutation error handling in the web app.
- Make human-approval flows trustworthy and visibly recoverable.
- Improve shell responsiveness for narrow desktop and mobile widths.
- Consolidate modal behavior on the shared accessible `Modal`.
- Introduce a small app UI primitive layer for page headers, toolbars, buttons, panels, tabs, tables, empty/error/loading states.
- Rework Overview around operator priorities.
- Improve Goals and Workflows discoverability and management affordances without requiring a full config editor redesign.

### Out of scope

- Full visual rebrand.
- Replacing UnoCSS.
- Backend data-model migrations.
- Full Goals CRUD unless the required file-write endpoints already exist by implementation time.
- Rebuilding every route from scratch.

---

## Key Decisions

### KD-1 · Reliability before polish

The first implementation units fix false confidence: empty states must not hide API failures, and approve/reject actions must not disappear unless the backend accepted them.

### KD-2 · Small design system, not a component-library migration

Use local primitives under `web/src/components/ui/` that wrap the existing dark zinc/indigo visual language. Do not introduce shadcn, Radix, or a new token architecture unless a specific primitive needs it.

### KD-3 · Responsive shell uses drawer behavior

At narrow widths, the left nav becomes a drawer opened from the header. Collapsed desktop nav should still contain recognizable icons or labels; the current empty rail is not useful.

### KD-4 · Overview becomes the operator home

Overview should prioritize attention and risk, not just list agents and recent events. It should answer: what needs a decision, what is running, what failed recently, what is overdue, and what is costing money.

### KD-5 · Goals management is incremental

The first pass should add active-run status, correct empty copy, per-goal run history, and clear edit guidance. Full create/edit/delete for `goals/*.yaml` should be planned as a follow-up unless the config/file API already supports safe writes for goals.

---

## Implementation Units

### U1 · Web API state and mutation safety

**Goal:** A failed API call must render an error state, not an empty successful state. A failed mutation must keep or restore the affected item and show the user what happened.

**Files:**

- `web/src/lib/api.ts` (new)
- `web/src/components/ui/ErrorState.tsx` (new)
- `web/src/components/ui/LoadingState.tsx` (new)
- `web/src/components/ui/index.ts`
- `web/src/routes/inbox/index.tsx`
- `web/src/routes/overview/index.tsx`
- `web/src/routes/tasks/index.tsx`
- `web/src/routes/goals/index.tsx`
- `web/src/routes/workflows/index.tsx`
- `web/src/routes/agents/index.tsx`
- `web/src/routes/skills/index.tsx`

**Approach:**

- Add a small `fetchJson<T>()` helper that checks `res.ok`, parses JSON when possible, and throws an error with status and message.
- Replace route-local `fetch(...).then(r => r.json())` in high-risk routes first.
- Add `ErrorState` with retry affordance where React Query exposes `refetch`.
- For approval mutations, check `res.ok` in every approve/reject/cancel path.
- Keep optimistic removal only when rollback is fully wired and visible.

**Tests:**

- `web/src/routes/inbox/__tests__/inbox.test.tsx`
- `web/src/routes/overview/__tests__/overview.test.tsx`
- `web/src/routes/goals/__tests__/goals.test.tsx`
- `web/src/routes/workflows/__tests__/workflows.test.tsx`
- Add `web/src/lib/__tests__/api.test.ts`

**Test scenarios:**

- `fetchJson` throws on 401/500 and includes response status.
- Inbox shows an error state when gates/plans/skills fail to load.
- Approve/reject failure restores the item and shows an error.
- Goals/Workflows show load errors instead of empty lists.

---

### U2 · UI primitives and route-level consistency

**Goal:** Repeated UI patterns should use shared primitives so spacing, colors, affordances, and states stay consistent across routes.

**Files:**

- `web/src/components/ui/Button.tsx` (new)
- `web/src/components/ui/PageHeader.tsx` (new)
- `web/src/components/ui/Panel.tsx` (new)
- `web/src/components/ui/Tabs.tsx` (new)
- `web/src/components/ui/Table.tsx` (new, lightweight wrappers)
- `web/src/components/ui/index.ts`
- `web/uno.config.ts`
- Representative route migrations:
  - `web/src/routes/projects/index.tsx`
  - `web/src/routes/tasks/index.tsx`
  - `web/src/routes/goals/index.tsx`
  - `web/src/routes/workflows/index.tsx`

**Approach:**

- Define button variants: `primary`, `secondary`, `danger`, `approve`, `ghost`.
- Define page header structure: title, description, actions.
- Define panel/card surface with 8px or less radius matching existing pages.
- Keep tokens minimal: surface, border, muted text, accent, danger, warning, success.
- Migrate a few high-traffic pages first; avoid broad mechanical churn.

**Tests:**

- `web/src/components/ui/__tests__/Button.test.tsx`
- `web/src/components/ui/__tests__/PageHeader.test.tsx`
- Existing route tests updated only where assertions depend on text/structure.

**Test scenarios:**

- Button variants render correct disabled/loading semantics.
- PageHeader exposes a single accessible heading.
- Migrated routes keep primary actions available.

---

### U3 · Responsive app shell and navigation

**Goal:** The app should remain navigable and readable on narrow desktop splits and mobile widths.

**Files:**

- `web/src/routes/__root.tsx`
- `web/src/components/CommandPalette.tsx`
- `web/src/components/ui/Modal.tsx`
- `web/src/a11y.test.tsx`

**Approach:**

- Replace empty collapsed sidebar with an icon/abbr rail or make collapse desktop-only.
- Add a mobile nav drawer opened from the header.
- Let the header wrap or hide secondary badges on narrow screens.
- Keep footer live strip compact or hide nonessential sparkline on small widths.
- Ensure the command palette uses viewport-safe height and top spacing.

**Tests:**

- `web/src/a11y.test.tsx`
- `web/src/components/__tests__/commandPalette.test.ts`
- Add shell tests under `web/src/routes/__tests__/root.test.tsx` if no root shell test exists.

**Test scenarios:**

- Sidebar drawer opens/closes by button and Escape.
- Primary nav links remain reachable at mobile width.
- Header content does not overflow at narrow widths.
- Command palette remains keyboard usable.

---

### U4 · Modal and keyboard accessibility consolidation

**Goal:** All modal-like UI uses the shared accessible `Modal` behavior: focus trap, Escape handling, backdrop semantics, and focus return.

**Files:**

- `web/src/components/Modal.tsx`
- `web/src/components/CommandPalette.tsx`
- `web/src/routes/inbox/index.tsx`
- `web/src/components/ConflictDialog.tsx`
- `web/src/components/DeleteProjectModal.tsx`

**Approach:**

- Reuse `Modal` for Inbox help and revision dialogs.
- Either adapt CommandPalette onto `Modal` or give it the same focus/return behavior intentionally.
- Ensure destructive modals use `mustConfirm`.
- Add explicit accessible labels/headings for each dialog.

**Tests:**

- `web/src/components/__tests__/Modal.test.tsx`
- `web/src/components/__tests__/commandPalette.test.ts`
- `web/src/routes/inbox/__tests__/inbox.test.tsx`

**Test scenarios:**

- Escape closes non-confirm modals.
- Tab cycles within the dialog.
- Focus returns to the triggering control.
- Revision modal cannot submit empty feedback and reports submit failure.

---

### U5 · Overview as operator dashboard

**Goal:** Overview should prioritize current operational state instead of acting as a generic summary.

**Files:**

- `web/src/routes/overview/index.tsx`
- Potential API use only from existing endpoints:
  - `/api/v1/tasks`
  - `/api/v1/gates`
  - `/api/v1/goals/runs`
  - `/api/v1/workflows/runs`
  - `/api/v1/metrics`
  - `/api/v1/cost/monthly`

**Approach:**

- Add a top priority strip: pending approvals, running tasks/workflows, failed tasks, escalated/overdue goals.
- Preserve agents strip, but make it secondary.
- Replace raw recent event list with grouped operational activity where possible.
- Add direct links from each risk item to the route that resolves it.
- Keep "+ New task" prominent.

**Tests:**

- `web/src/routes/overview/__tests__/overview.test.tsx`

**Test scenarios:**

- Pending approval appears above generic events.
- Failed task and escalated goal are visible and linked.
- Empty/healthy state is explicit and not confused with load failure.
- SSE events invalidate the relevant overview queries.

---

### U6 · Goals UX: active status, detail, and honest management

**Goal:** Goals should read as managed outcomes with clear state and next actions, not just a wide table plus run button.

**Files:**

- `web/src/routes/goals/index.tsx`
- `server/src/api/routes/goals.ts` if active/last-run enrichment is not already available
- `server/src/api/routes/__tests__/goals.test.ts`
- `web/src/routes/goals/__tests__/goals.test.tsx`

**Approach:**

- Correct empty-state copy to `goals/*.yaml`.
- Add active/last-run metadata per goal, either by enriching `GET /api/v1/goals` or deriving from fetched runs.
- Disable or explain `Run now` when a goal already has a running run.
- Add per-goal detail expansion/drawer with acceptance, gates, filtered run history, workflow link, and edit guidance.
- Add a visible “Edit YAML”/“Manage file” affordance only if a safe file editor endpoint exists; otherwise show the file location and current limitation honestly.

**Tests:**

- `web/src/routes/goals/__tests__/goals.test.tsx`
- `server/src/api/routes/__tests__/goals.test.ts`

**Test scenarios:**

- Running goal shows active status and disables manual run.
- Per-goal run history filters correctly.
- API failure renders error state.
- Empty state references `goals/*.yaml`.

---

### U7 · Workflows UX: clearer split between repo and project workflows

**Goal:** Users should understand which workflows are editable in the UI, which are repo-global/read-only, and how to act on each.

**Files:**

- `web/src/routes/workflows/index.tsx`
- `web/src/routes/projects/$projectId.workflows.tsx`
- `web/src/routes/projects/$projectId.workflows.$workflowName.tsx`
- `web/src/routes/workflows/__tests__/workflows.test.tsx`
- Existing project workflow tests under `web/src/routes/projects/__tests__/`

**Approach:**

- Make the page hierarchy explicit: “Project workflow files” vs “Repo workflow registry”.
- Fix empty-state copy for repo workflows.
- Add filtered run history by workflow when a workflow card is selected.
- Preserve read-only YAML view for repo workflows.
- Add stronger links to project workflow editor for editable workflows.

**Tests:**

- `web/src/routes/workflows/__tests__/workflows.test.tsx`
- `web/src/routes/projects/__tests__/projectWorkflows.test.tsx`
- `web/src/routes/projects/__tests__/projectWorkflowEditor.test.tsx`

**Test scenarios:**

- Repo workflow shows read-only affordance.
- Project workflow links to editor.
- Selecting a workflow filters recent runs.
- Run failure and load failure show actionable error text.

---

### U8 · Visual polish and affordance pass

**Goal:** Reduce visual noise while keeping the dense operational feel.

**Files:**

- `web/src/base.css`
- `web/uno.config.ts`
- High-traffic routes after U2-U7 migrations

**Approach:**

- Replace emoji icons in production UI with text or consistent icon treatment where appropriate.
- Add global focus-visible styles.
- Normalize section headings and panel spacing.
- Reduce nested card feel on dashboards.
- Audit text truncation where IDs/descriptions can overflow.

**Tests:**

- `web/src/a11y.test.tsx`
- Existing route tests where visual labels change.

**Test scenarios:**

- Keyboard focus is visible on links, buttons, inputs, and table rows.
- Long IDs/descriptions truncate or wrap intentionally.
- No route loses its primary action after primitive migration.

---

## Sequencing

1. **U1 first** — fixes trust and prevents false “all clear” states.
2. **U2 next** — creates primitives before wider UI changes.
3. **U3 + U4** — shell and accessibility foundations.
4. **U5** — Overview redesign once primitives exist.
5. **U6 + U7** — Goals/Workflows management affordances.
6. **U8 last** — polish after structural churn settles.

This can ship as multiple PRs. Recommended PR split:

- PR 1: U1 + minimal ErrorState/LoadingState.
- PR 2: U2 + U4.
- PR 3: U3.
- PR 4: U5.
- PR 5: U6 + U7.
- PR 6: U8 polish.

---

## Verification Plan

Run after each PR:

- `npm test --workspace web`
- `npm run build --workspace web`

Run when server API behavior changes:

- `npm test --workspace server`
- Focused server route tests for changed endpoints.

Manual/browser verification before final completion:

- Desktop viewport: overview, inbox, tasks, workflows, goals, settings.
- Narrow viewport: shell navigation, command palette, inbox modal, goals/workflows tables.
- Keyboard-only: command palette, inbox approve/reject/revision, modal focus trap.
- API failure simulation: force one route fetch to 500 and verify visible error state.

---

## Risks

- Broad primitive migration can create noisy diffs. Keep route migration incremental.
- Overview redesign may require API enrichment if current endpoints do not expose enough risk signals. Prefer deriving from existing endpoints first.
- Mobile layout can expose hidden assumptions in table-heavy pages. Use responsive cards only where tables become unusable.
- Goals CRUD may overlap with future config/file editor work. Do not build a parallel unsafe YAML writer.

