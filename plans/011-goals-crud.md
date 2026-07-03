# Plan 011: Goals CRUD — create, edit, and delete goals from the Web UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8e316f8..HEAD -- server/src/goals server/src/api/routes/goals.ts server/src/index.ts web/src/routes/goals`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Known pending drift: PR #87
> (global project scope) touches `web/src/routes/goals/index.tsx` (adds a
> `CompanyWideBadge` to the PageHeader `actions` slot) — if it has merged,
> keep that badge and add the "New goal" button next to it.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `8e316f8`, 2026-07-03

## Why this matters

Goals are the autonomy backbone (STRATEGY.md: "recurring work without the
owner's involvement"), but today they can only be authored by hand-editing
`goals/*.yaml` in the repo. The Goals page is read-only apart from "Run now".
Workflows already got full per-project CRUD with an editor (Slice 4 / U11);
goals lag behind, which makes the primary autonomy feature the hardest one to
configure. This plan adds server CRUD endpoints for goal YAML files plus a
form-based editor in the Goals page.

**A latent bug makes this plan mandatory ground-work:** the hot-reload watcher
re-loads the `GoalRegistry` on file changes, but never restarts the
`GoalScheduler` — its croner jobs keep firing with the *old* definitions until
the server restarts (`server/src/index.ts:190-206` reloads registries only;
`goalScheduler.start()` is called once at line 255). Without fixing this, a UI
edit would *appear* to work while the scheduler silently keeps the stale
cadence. Step 1 fixes it.

## Current state

**Schema** — `server/src/goals/schema.ts` (entire file):

```ts
export const GoalDef = z.object({
  id: z.string().min(1),
  description: z.string(),
  cadence: z.string(), // cron expression
  deadline: z.string().optional(), // cron expression
  workflow: z.string(), // references workflows/*.yaml name
  acceptance: z.array(z.string().min(1)).default([]),
  human_gates: z.array(z.object({
    step: z.string().min(1),
    label: z.string().min(1),
    timeout: z.string().optional(),
  })).default([]),
  warn_before_ms: z.number().int().positive().default(7200000), // 2h default
});
```

**Registry** — `server/src/goals/loader.ts`: `load(goalsDir)` reads every
`*.yaml`/`*.yml` in the dir, `GoalDef.parse(parseYaml(raw))`, keyed by
`def.id`. One file = one goal (the loader parses a single def per file). The
registry does NOT currently remember which file a goal came from — CRUD needs
that (Step 2).

**Scheduler** — `server/src/goals/scheduler.ts`: `start(goals)` creates croner
jobs into `this.jobs`, `stop()` stops and clears them. Both exist and are
idempotent enough to implement restart as `stop(); start(registry.list())`.

**Wiring** — `server/src/index.ts`:
- `goalsDir = join(__dirname, '..', '..', 'goals')` (line 175) — the repo-level
  `goals/` directory.
- Hot-reload watcher (lines 190-206): `debouncedReload()` calls
  `goalRegistry.load(goalsDir)` but **not** `goalScheduler` restart (the bug).
- `goalScheduler.start(goalRegistry.list())` once at line 255. Note the
  scheduler is created AFTER the watcher closure is defined — the restart call
  inside `debouncedReload` must be guarded (`goalScheduler?.…`) or the
  scheduler reference hoisted; see Step 1.

**Existing API** — `server/src/api/routes/goals.ts`: `GET /` (list via
registry), `GET /runs`, `GET /:id`, `POST /:id/run`. No write endpoints.

**The pattern to copy** — `server/src/api/routes/workflowFiles.ts` is the
blessed precedent for file-backed CRUD (Slice 4 / U11 + its security review):
- Path safety: resolve the target name against the base dir and verify the
  resolved path stays inside it (see its header comment and helpers).
- Optimistic concurrency: `GET` returns `{ name, content, etag }` with an
  `ETag` header (`computeEtag(content)`); `PUT`/`DELETE` require `If-Match`,
  mismatch → 412.
- Validation before write: parse YAML, `safeParse` against the Zod schema,
  reject 400 with issues on failure.
Match this file's conventions exactly — same helpers, same status codes.

**Web page** — `web/src/routes/goals/index.tsx`: `GoalTable` renders goals
with "Run now" + "Details"; queries `['goals']`, `['goal-runs']`,
`['workflows']` (the last one powers the "⚠ workflow missing" warning). There
is no create/edit/delete UI. Form precedent: `web/src/components/AgentForm.tsx`
(local state, Zod validation via `safeParse` on the built payload, Modal
wrapper from `web/src/components/Modal.tsx`). The page already has `parseCron`
(humanizes cron strings) and `relativeFutureTime` — reuse them for live cron
preview in the form.

**Editor decision (made here, not by the executor):** form-based editor, not
Monaco. The goal schema is small and flat; a form prevents the two most common
authoring errors directly (invalid cron via live `parseCron` preview +
croner-side validation, dangling workflow via a dropdown fed from the
`['workflows']` registry query). Monaco+YAML stays the right tool for
workflows' nested step graphs — not needed here.

## Commands you will need

| Purpose          | Command                                                        | Expected            |
|------------------|----------------------------------------------------------------|---------------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                | exit 0              |
| Server tests     | `cd server && npm test`                                        | all pass (704+)     |
| Goals route test | `cd server && npx vitest run src/api/routes/__tests__/goals.test.ts` | all pass     |
| Web typecheck    | `cd web && npx tsc --noEmit`                                   | exit 0              |
| Web tests        | `cd web && npx vitest run`                                     | all pass (434+)     |

> Server tests need the `better-sqlite3` native build for the running Node
> (`.nvmrc` = 22); on a `NODE_MODULE_VERSION` error run `npm rebuild better-sqlite3`.

## Scope

**In scope** (the only files you should modify/create):
- `server/src/goals/loader.ts` — track source file per goal
- `server/src/goals/scheduler.ts` — only if a `restart()` convenience is added
- `server/src/index.ts` — scheduler restart on goals reload; pass goalsDir/scheduler to the route
- `server/src/api/routes/goals.ts` — add POST `/`, GET `/:id/raw`, PUT `/:id`, DELETE `/:id`
- `server/src/api/routes/__tests__/goals.test.ts` — extend
- `web/src/components/GoalForm.tsx` — create
- `web/src/components/__tests__/GoalForm.test.tsx` — create
- `web/src/routes/goals/index.tsx` — New/Edit/Delete wiring
- `web/src/routes/goals/__tests__/*` — extend existing tests
- `AGENTS.md` — API table rows for the new endpoints

**Out of scope** (do NOT touch):
- `server/src/api/routes/workflowFiles.ts` — the pattern source; read it, never modify it.
- `packages/schema/` — GoalDef lives server-side (`server/src/goals/schema.ts`); do not move it in this plan.
- The goal *run* model (`goal_runs` table, scheduler pmCheck/escalation logic).
- `~/.pragents/` anything — goals live in the repo `goals/` dir.
- Generated files (`web/src/routeTree.gen.ts` regenerates itself via the Vite plugin).

## Git workflow

- Branch: `feat/goals-crud`
- Commit per slice (server first, then web); conventional commits, e.g.
  `feat(server): goal file CRUD with etag concurrency` /
  `feat(web): goal editor form + create/edit/delete on goals page`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the scheduler-restart gap on goals reload

In `server/src/index.ts`, inside `debouncedReload()` (lines ~190-203), after
`goalRegistry.load(goalsDir)`, restart the scheduler with the fresh list:

```ts
const { loaded: gl } = goalRegistry.load(goalsDir);
// Re-register cron jobs — a reloaded registry without a scheduler restart
// keeps firing the OLD definitions (pre-existing gap, required for CRUD).
goalScheduler?.stop();
goalScheduler?.start(goalRegistry.list());
```

`goalScheduler` is declared at line ~254, AFTER the watcher closure — hoist the
declaration (`let goalScheduler: GoalScheduler | undefined;`) above the watcher
setup and assign it where it is currently created, or use an equivalent
late-binding guard. The debounce (1s) already serializes rapid file changes.

**Verify**: `cd server && npx tsc --noEmit` → exit 0. Manual check: with the
dev server running, edit `goals/weekly-article.yaml` (change `cadence`),
observe the log line `Registries reloaded` followed by `Goal scheduled` with
the new cadence.

### Step 2: Track the source file per goal in GoalRegistry

In `server/src/goals/loader.ts`, extend the registry map to store the source
filename alongside each def (e.g. `Map<string, { def: GoalDefType; file: string }>`),
keep `list()`/`get()` signatures unchanged (return the defs), and add
`getFile(id): string | undefined`. Also add a duplicate-id warning: if two
files declare the same `id`, push a warning and keep the first.

**Verify**: `cd server && npx tsc --noEmit` → exit 0; existing goals tests pass.

### Step 3: Server CRUD endpoints

In `server/src/api/routes/goals.ts`, following `workflowFiles.ts` verbatim for
path safety, etag, and status codes (read that file first):

- `GET /:id/raw` → `{ id, file, content, etag }` + `ETag` header. 404 if the
  registry has no such goal.
- `POST /` — body `{ content }` (YAML string). Parse + `GoalDef.safeParse`;
  400 with issues on failure. 409 if the parsed `id` already exists in the
  registry. Write to `goals/<id>.yaml` (sanitize: the filename is derived from
  the validated `id`, allow only `[a-z0-9-_]`, and resolve-check it stays
  inside `goalsDir`). Reload registry + restart scheduler (same sequence as
  Step 1 — extract a small `reloadGoals()` closure passed into the route
  factory so the logic exists once). Return 201 `{ id, etag }`.
- `PUT /:id` — body `{ content }`, `If-Match` required; 412 on mismatch
  against the current file content's etag; 400 if the new content's `id` field
  does not equal the URL `:id` (renames are a delete+create, not a PUT);
  validation as in POST. Writes to the goal's existing source file
  (`registry.getFile(id)`).
- `DELETE /:id` — `If-Match` required (412 on mismatch); deletes the source
  file; reload + restart. `goal_runs` history rows are intentionally kept.
- All write endpoints emit an event via the existing `eventBuffer` if the
  route factory already receives one; if it does not, skip events rather than
  widening the factory signature beyond `goalsDir` + a `reloadGoals` callback.

Update the route factory call in `server/src/index.ts` to pass the new deps.

**Verify**: `cd server && npx vitest run src/api/routes/__tests__/goals.test.ts`
→ all pass including the new cases from the Test plan below.

### Step 4: GoalForm component (web)

Create `web/src/components/GoalForm.tsx` modeled structurally on
`AgentForm.tsx` (local state, no Zustand). Fields:

- `id` — text input; disabled in edit mode (renames are delete+create); pattern `[a-z0-9-_]+`.
- `description` — text input.
- `cadence` — text input with live human preview underneath using `parseCron`
  from the goals route module (export it from there if not already exported).
- `deadline` — optional, same preview treatment.
- `workflow` — `<select>` fed from the `['workflows']` registry query (the
  page already runs it); include a free-text fallback option so a not-yet-created
  workflow can be referenced deliberately — but show the existing amber
  "⚠ workflow missing" hint next to it in that case.
- `acceptance` — tag-style list (pattern: capabilities tag input in AgentForm).
- `human_gates` — repeatable rows of `{ step, label, timeout? }` with add/remove.

The form's output is the YAML string (`YAML.stringify` of the built object —
the `yaml` package is already a web dependency via monaco tooling; if not
importable, build the object and let the caller stringify). Validation before
submit: required fields non-empty; cron fields validated by attempting
`parseCron` humanization plus a best-effort regex (5 space-separated fields) —
the server remains the authority via Zod + croner.

**Verify**: `cd web && npx tsc --noEmit` → exit 0; new GoalForm tests pass.

### Step 5: Wire New / Edit / Delete into the Goals page

In `web/src/routes/goals/index.tsx`:

- PageHeader `actions`: add a "+ New goal" button (keep the `CompanyWideBadge`
  if PR #87 has merged) → Modal with `GoalForm`, POST on submit, invalidate
  `['goals']` and `['goal-runs']`.
- Per row: an "Edit" button → fetch `GET /:id/raw`, open Modal with GoalForm
  pre-filled (parse the YAML), PUT with the held etag via `If-Match`; on 412
  show the existing `ConflictDialog` pattern (see the settings page usage) or
  a simple "goal changed on disk — reload and retry" error line if wiring
  ConflictDialog proves invasive.
- Per row: "Delete" with inline confirm (pattern: task detail delete from
  `web/src/routes/tasks/$taskId.tsx`), DELETE with `If-Match`.
- Keep "Run now" and "Details" untouched.

**Verify**: `cd web && npx vitest run src/routes/goals` → all pass.

### Step 6: Docs

Add the four new endpoints to the API table in `AGENTS.md` (follow the
existing row format).

**Verify**: `grep -n "goals/:id/raw" AGENTS.md` → one match.

## Test plan

Server (`goals.test.ts`, extending the existing suite — it already builds the
route with a registry fixture):
- POST valid YAML → 201, file exists in a temp goalsDir, registry reloaded.
- POST duplicate id → 409. POST invalid YAML / failing schema → 400 with issues.
- POST id with path characters (`../evil`) → 400 (sanitizer).
- GET /:id/raw → content + etag; unknown id → 404.
- PUT with stale If-Match → 412; with correct etag → 200 and file updated.
- PUT whose body id ≠ URL id → 400.
- DELETE with correct etag → file gone, registry no longer lists it; goal_runs untouched.
- Scheduler restart: inject a spy scheduler into the reload callback and
  assert stop+start were called after each successful write.

Web:
- `GoalForm.test.tsx`: renders all fields; submit blocked on empty id/cadence;
  edit mode disables id; acceptance tags add/remove; gates rows add/remove.
- Goals page test: "New goal" opens the modal; Delete asks for confirmation
  before firing the mutation (model after `tasks/$taskId` action tests).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0; `cd server && npm test` passes
- [ ] `cd web && npx tsc --noEmit` exits 0; `cd web && npx vitest run` passes
- [ ] `curl -s -X POST localhost:3000/api/v1/goals -H 'content-type: application/json' -d '{"content":"id: tmp-goal\ndescription: t\ncadence: \"0 9 * * 1\"\nworkflow: content-pipeline\n"}'` returns 201 and `goals/tmp-goal.yaml` exists (clean up afterwards via the DELETE endpoint)
- [ ] After a goal edit, the server log shows the scheduler re-registering (Step 1 behavior)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `computeEtag` / the path-safety helpers used by `workflowFiles.ts` are not
  importable from a shared module (i.e. they are file-local) — extract them to
  `server/src/util/` ONLY if the extraction is a pure move; otherwise report.
- The scheduler's `start()` turns out not to be idempotent after `stop()`
  (duplicate cron firings in the log) — report; do not paper over with flags.
- `goals/index.tsx` has drifted beyond the known PR #87 badge change.
- The existing goals route tests construct the route factory in a way that
  cannot accommodate the new deps without rewriting unrelated tests wholesale.

## Maintenance notes

- Renames are intentionally delete+create; if operators ask for in-place
  rename later, it needs a dedicated endpoint that also migrates `goal_runs.goal_id`.
- The form and the schema will drift if `GoalDef` gains fields — the 400
  responses surface Zod issues verbatim, so the form should render unknown
  issues generically rather than mapping only known fields.
- A future "duplicate goal" quick-action falls out almost free (GET raw →
  change id → POST); note it as a follow-up, do not build it here.
- Reviewer should scrutinize: path sanitization on the POST filename, the 412
  paths, and that the scheduler restart happens on ALL mutation paths (POST,
  PUT, DELETE, and external file edits via the watcher).
