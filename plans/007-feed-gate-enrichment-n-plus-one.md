# Plan 007: Eliminate the N+1 query pattern in feed gate enrichment

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- server/src/api/routes/feed.ts server/src/workflows/tracker.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

The `/api/v1/feed` route enriches each pending human gate with its workflow run,
that run's steps, and the workflow definition — one lookup **per gate**, inside a
`.map()` (`feed.ts:48-105`). With the current `LIMIT 20` on gates that is up to
~40 `WorkflowTracker` calls (a `getRun` + `getSteps` per gate) plus a registry
lookup each, where 2 batched queries would do. The feed is a hot, frequently
polled endpoint (it powers the inbox); the per-gate fan-out is wasted work that
grows with the gate cap. Batching the run and step fetches removes the N+1 while
keeping the response shape identical.

## Current state

`server/src/api/routes/feed.ts`:
- Gates are selected with a single query, capped at 20 (`feed.ts:38-45`):
  ```sql
  FROM human_gates h WHERE h.status = 'pending' ORDER BY h.created_at DESC LIMIT 20
  ```
- Enrichment maps over `rawGates` and, **per gate**, calls
  `wfTracker.getRun(gate.workflowRunId)` (`feed.ts:50`) and
  `wfTracker.getSteps(gate.workflowRunId)` (`feed.ts:52`), plus `registry.get(workflowName)`
  (`feed.ts:58`). The whole per-gate block is wrapped in try/catch for graceful
  degradation (returns the bare gate on error, `feed.ts:96-104`).

`server/src/workflows/tracker.ts` — current single-row accessors:
- `getRun(runId)` (`tracker.ts:81-89`) — one run by id.
- `getSteps(runId)` (`tracker.ts:91-96`) — steps for one run, ordered.
- `listRuns(limit)` (`tracker.ts:98-103`) — exists as a batch-shaped example to
  model the new methods on.

There is **no** batch (`WHERE run_id IN (...)`) accessor yet — this plan adds two.

Conventions: `WorkflowTracker` methods use `getDb().prepare(...)` with column
aliases mapping snake_case → camelCase; named exports; strict TS. Existing tests:
`server/src/workflows/__tests__/tracker.test.ts` and
`server/src/api/routes/__tests__/feed.test.ts`.

## Commands you will need

| Purpose          | Command                                                          | Expected      |
|------------------|------------------------------------------------------------------|---------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                  | exit 0        |
| Tracker tests    | `cd server && npx vitest run src/workflows/__tests__/tracker.test.ts` | all pass |
| Feed route tests | `cd server && npx vitest run src/api/routes/__tests__/feed.test.ts`   | all pass |

> `npm test` needs the native module built for the running Node ABI (plan 002).

## Scope

**In scope** (the only files you should modify):
- `server/src/workflows/tracker.ts` — add two batch accessors
- `server/src/api/routes/feed.ts` — use the batch accessors in the gate enrichment
- `server/src/workflows/__tests__/tracker.test.ts` (add cases for the batch methods)
- `server/src/api/routes/__tests__/feed.test.ts` (assert enrichment output unchanged)

**Out of scope** (do NOT touch):
- The response shape of the feed gates (`workflowName`, `previousStepOutputs`,
  `nextSteps`, spread `...gate`) — clients depend on it; keep it byte-identical.
- The `LIMIT 20` on the gate query and the graceful-degradation try/catch behavior.
- Other feed sections (skills, tasks) — only the gates enrichment changes.
- The `registry.get()` calls — the registry is an in-memory map (cheap); batching
  it is unnecessary. Only the DB-backed `getRun`/`getSteps` are the N+1.

## Git workflow

- Branch: `advisor/007-feed-gate-enrichment-n-plus-one`
- One commit. Message style: conventional commits. Example from `git log`:
  `feat(server): per-project workflow CRUD + workflowDirectory schema`. Suggested:
  `perf(server): batch workflow run/step fetches in feed gate enrichment`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add batch accessors to WorkflowTracker

Add two methods to `WorkflowTracker`, modeled on `getRun`/`getSteps` but keyed on
a list of run ids. Guard the empty-array case (SQLite `IN ()` is invalid).

```ts
getRunsByIds(runIds: string[]): Map<string, WorkflowRun> {
  const out = new Map<string, WorkflowRun>();
  if (runIds.length === 0) return out;
  const placeholders = runIds.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT id, workflow_name as workflowName, status, params, trigger_source_run_id as triggerSourceRunId,
            started_at as startedAt, completed_at as completedAt
       FROM workflow_runs WHERE id IN (${placeholders})`,
  ).all(...runIds) as any[];
  for (const row of rows) {
    if (row.params) row.params = JSON.parse(row.params);
    out.set(row.id, row);
  }
  return out;
}

getStepsByRunIds(runIds: string[]): Map<string, WorkflowStepRow[]> {
  const out = new Map<string, WorkflowStepRow[]>();
  if (runIds.length === 0) return out;
  const placeholders = runIds.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT id, run_id as runId, step_id as stepId, agent_id as agentId, status, output,
            started_at as startedAt, completed_at as completedAt
       FROM workflow_steps WHERE run_id IN (${placeholders})
      ORDER BY COALESCE(started_at, '9999') ASC, completed_at ASC`,
  ).all(...runIds) as any[];
  for (const row of rows) {
    const list = out.get(row.runId) ?? [];
    list.push(row);
    out.set(row.runId, list);
  }
  return out;
}
```

The placeholders are `?` bindings (parameterized) — no string interpolation of
values, so no SQL injection. The step ordering matches the existing per-run
`getSteps` ORDER BY, so per-run step order is preserved.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 2: Use the batch accessors in feed enrichment

In `feed.ts`, before the `.map()`, collect the distinct run ids and fetch once:

```ts
const runIds = [...new Set(rawGates.map((g: any) => g.workflowRunId).filter(Boolean))];
const runsById = wfTracker.getRunsByIds(runIds);
const stepsByRun = wfTracker.getStepsByRunIds(runIds);
```

Then inside the existing `.map()`, replace `wfTracker.getRun(gate.workflowRunId)`
with `runsById.get(gate.workflowRunId) ?? null` and
`wfTracker.getSteps(gate.workflowRunId)` with `stepsByRun.get(gate.workflowRunId) ?? []`.
Leave everything else (the `registry.get`, previous/next step assembly, try/catch,
return shape) exactly as is.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.
`grep -n "wfTracker.getRun(\|wfTracker.getSteps(" server/src/api/routes/feed.ts`
→ no matches (the single-row calls are gone from the gate map).

### Step 3: Tests

- **tracker.test.ts**: seed 2 runs each with 2 steps. Assert `getRunsByIds([a,b])`
  returns a map of both; `getRunsByIds([])` returns an empty map (no SQL error);
  `getStepsByRunIds([a,b])` groups steps by run id with the same ordering as
  `getSteps`.
- **feed.test.ts**: seed pending gates whose runs/steps exist, call the feed
  route, and assert the enriched gate output (`workflowName`, `previousStepOutputs`,
  `nextSteps`) is identical to what the per-gate path produced. If a golden-value
  assertion already exists, it should still pass unchanged.

**Verify**:
- `cd server && npx vitest run src/workflows/__tests__/tracker.test.ts` → all pass.
- `cd server && npx vitest run src/api/routes/__tests__/feed.test.ts` → all pass.

## Test plan

- New cases in `tracker.test.ts` (batch accessors incl. empty-array guard) and
  `feed.test.ts` (enrichment output unchanged), modeled on the existing tests in
  each file.
- Verification: both vitest filters pass; `cd server && npm test` shows no new
  failures.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0
- [ ] `WorkflowTracker` has `getRunsByIds` and `getStepsByRunIds` with empty-array guards
- [ ] `grep -n "wfTracker.getRun(\|wfTracker.getSteps(" server/src/api/routes/feed.ts` returns no matches inside the gate map
- [ ] Feed gate response shape is unchanged (feed.test.ts golden assertions pass)
- [ ] New tracker + feed test cases pass
- [ ] `git status` shows only the four in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The feed test has no way to assert the enriched shape without a live DB and the
  existing harness does not provide one — report it rather than weakening the
  assertion (the whole point is proving the output is identical).
- `WorkflowStepRow` / `WorkflowRun` types are not exported from `tracker.ts` and
  importing them into the new methods requires broadening an export in a way that
  touches out-of-scope files.
- You find the gate query is *not* capped (LIMIT removed by a prior change) — the
  batch approach still works, but note it, since unbounded gates need pagination
  separately.

## Maintenance notes

- If pagination is ever added to the gate query, `runIds` collection stays correct
  (it derives from whatever gates were fetched) — no change needed.
- The two batch methods are generally useful; other call sites doing per-run
  fan-out (e.g. workflow-runs listing pages) could adopt them later.
- Reviewer should diff a sample feed response before/after to confirm the enriched
  gate objects are identical, and confirm the `IN (...)` bindings are parameterized.
