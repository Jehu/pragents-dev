# Plan 009: Remove the `resume-later` failure-policy stub (recommended) — or the decision to finish it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- packages/schema/src/workflow.ts server/src/workflows/engine.ts AGENTS.md`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (coordinate with 006, which also edits the AGENTS.md workflow wording — do 006 first or merge the edits)
- **Category**: tech-debt
- **Planned at**: commit `867809f`, 2026-07-03

## Recommendation (read before executing)

**Remove the `resume-later` enum value.** Rationale:

1. It is a **silent foot-gun today**: authors can set `onStepFailure: resume-later`
   and the engine logs a warning and behaves exactly like `continue`
   (`engine.ts:158-166`). A workflow author reasonably expects "pause and let a
   human decide"; they get "swallow the failure and keep going." Silent
   divergence between declared and actual behavior is worse than not offering the
   option.
2. Finishing it "properly" is a **large, disproportionate lift**. The engine runs
   an entire workflow inside one live async call and blocks on human gates by
   *polling the DB in-memory* (`waitForGate`, used at `engine.ts:212`). There is no
   mechanism to serialize the `outputs` map + current step index and rehydrate a
   run later — so a faithful "persist partial results and pause" (the schema's own
   description) would require durable run state / a resumable state machine the
   engine does not have. That is a multi-day architectural change with real risk
   to the core abstraction, for a policy nobody is shown to depend on.
3. The capability is **already expressible** without a new policy value: an author
   who wants "on partial failure, pause for a human" can place an explicit
   `human_gate` step after the parallel group and branch on the
   `<step.id>.results` blob that `continue` already produces. So removal loses no
   real expressiveness.

If the maintainer instead wants the feature built, see "Alternative: finish it"
at the bottom — but the default this plan executes is **removal**.

## Current state

- Schema (`packages/schema/src/workflow.ts`):
  - Line 38 comment: `resume-later: persist partial results and pause for human gate (stub — behaves like continue, see TODO).`
  - Step-level: `onStepFailure: z.enum(['abort', 'continue', 'resume-later']).optional()` (`workflow.ts:41`)
  - Workflow-level: `onStepFailure: z.enum(['abort', 'continue', 'resume-later']).optional()` (`workflow.ts:62`)
  - Type export: `export type OnStepFailure = 'abort' | 'continue' | 'resume-later';` (`workflow.ts:69`)
- Engine (`server/src/workflows/engine.ts`):
  - Policy resolved at `engine.ts:100`: `const failurePolicy = step.onStepFailure ?? def.onStepFailure ?? 'abort';`
  - The `resume-later` branch (`engine.ts:158-166`) logs a warning and falls
    through to `continue`:
    ```ts
    if (failurePolicy === 'resume-later') {
      // TODO: full resume-later implementation — persist partial results to DB
      // and emit a human_gate event so an operator can decide to continue or abort.
      // For now this falls through to 'continue' behaviour and logs a warning.
      logger.warn({ runId, stepId: step.id, failures: failures.length },
        'onStepFailure=resume-later is not yet fully implemented; treating as continue');
    }
    ```
  - The subsequent `continue`/collect block (`engine.ts:168-187`) writes
    `outputs[`${step.id}.results`]` and proceeds.

Conventions: Zod schema is canonical; the shared schema is imported by both server
and the web workflow editor (`packages/schema/src/workflow.ts` re-exported via
`server/src/workflows/schema.ts`). Tests: `server/src/workflows/__tests__/engine.test.ts`.

## Commands you will need

| Purpose          | Command                                                            | Expected   |
|------------------|-------------------------------------------------------------------|------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                   | exit 0     |
| Web typecheck    | `cd web && npx tsc --noEmit`                                      | exit 0     |
| Engine tests     | `cd server && npx vitest run src/workflows/__tests__/engine.test.ts` | all pass |
| Grep leftover    | `grep -rn "resume-later" packages server web`                     | no matches |

## Scope

**In scope** (the only files you should modify):
- `packages/schema/src/workflow.ts` — drop `resume-later` from both enums, the type, and the comment
- `server/src/workflows/engine.ts` — remove the `resume-later` branch
- `server/src/workflows/__tests__/engine.test.ts` — adjust/add tests
- `AGENTS.md` — ensure the workflow wording lists only `abort` / `continue`
- `pragents.example.yaml` / any `workflows/*.yaml` — only if one references `resume-later` (grep first)

**Out of scope** (do NOT touch):
- The `abort` and `continue` behavior — leave both exactly as they are.
- The human-gate machinery (`waitForGate`, gate loop) — unrelated to this removal.
- Any durable-run-state work — that is the "finish it" alternative, not this plan.

## Git workflow

- Branch: `advisor/009-remove-resume-later-stub`
- One commit. Message style: conventional commits. Example from `git log`:
  `chore: remove demo content-pipeline workflow`. Suggested:
  `refactor(workflows): drop unimplemented resume-later failure policy`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Check for existing usage

Run `grep -rn "resume-later" packages server web workflows pragents.example.yaml`.
Record every hit. If a **committed workflow YAML or a test fixture** relies on
`resume-later`, note it — those need updating to `continue` (the current de-facto
behavior) in Step 4 so nothing changes semantically.

**Verify**: you have a complete list of occurrences.

### Step 2: Remove it from the schema

In `packages/schema/src/workflow.ts`:
- Change both enums to `z.enum(['abort', 'continue'])` (lines 41 and 62).
- Change the type to `export type OnStepFailure = 'abort' | 'continue';` (line 69).
- Update/remove the `resume-later:` comment (line 38).

**Verify**: `cd server && npx tsc --noEmit` → exit 0 (a lingering reference to the
removed literal will fail the type check — that is how you find them).

### Step 3: Remove the engine branch

In `engine.ts`, delete the `if (failurePolicy === 'resume-later') { ... }` block
(`engine.ts:158-166`). The `abort` branch stays; the `continue`/collect block
below stays and now handles every non-abort failure. The default remains
`'abort'` (`engine.ts:100`).

**Verify**: `cd server && npx tsc --noEmit` → exit 0.
`grep -n "resume-later" server/src/workflows/engine.ts` → no matches.

### Step 4: Update any fixtures/YAML that used it

For each Step 1 hit in a YAML/fixture, replace `resume-later` with `continue`
(the behavior it silently had). Do not change abort/continue fixtures.

**Verify**: `grep -rn "resume-later" packages server web workflows pragents.example.yaml` → no matches anywhere.

### Step 5: Tests

In `engine.test.ts`:
- If a test asserted `resume-later` behavior, retarget it to `continue` (same
  expected outcome — partial results collected into `<step.id>.results`).
- Add/keep a test proving that `onStepFailure: 'continue'` on a parallel group
  with one failing sub-step does not throw and exposes `<step.id>.results`.
- Confirm `onStepFailure: 'abort'` (and the default) still throws on failure.

**Verify**: `cd server && npx vitest run src/workflows/__tests__/engine.test.ts` → all pass.

### Step 6: Docs

Ensure `AGENTS.md`'s workflow section lists only `abort` and `continue`. If plan
006 already rewrote that line, just confirm `resume-later` is absent.

**Verify**: `grep -rn "resume-later" AGENTS.md` → no matches.

## Test plan

- Adjust `engine.test.ts` per Step 5 so the parallel-failure cases cover `abort`
  (throws) and `continue` (collects partial results), with no `resume-later` case.
- Verification: `cd server && npx vitest run src/workflows/__tests__/engine.test.ts`
  → all pass; `cd server && npm test` → no new failures.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "resume-later" packages server web workflows pragents.example.yaml AGENTS.md` returns no matches
- [ ] Both `onStepFailure` enums are `['abort', 'continue']`; `OnStepFailure` type has two members
- [ ] `cd server && npx tsc --noEmit` exits 0 and `cd web && npx tsc --noEmit` exits 0
- [ ] `cd server && npx vitest run src/workflows/__tests__/engine.test.ts` passes
- [ ] `cd server && npm test` passes (on the pinned Node)
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 reveals a **committed workflow that actively depends on `resume-later`**
  as if it were implemented (i.e. the author clearly expects pause-for-human) —
  that is a signal the feature is wanted; report it so the maintainer chooses
  removal vs. the "finish it" path below.
- Removing the enum value cascades type errors into the web workflow editor that
  cannot be resolved within the in-scope files — report the failing components.
- A test encodes `resume-later`-specific behavior that is not equivalent to
  `continue` — report it rather than silently changing the assertion.

## Alternative: finish it (only if the maintainer chooses this over removal)

If the decision is to **build** `resume-later` instead of removing it, that is a
separate, larger plan — do **not** attempt it under this file. It would need:

1. **Durable run state**: persist the `outputs` map and the current step
   index/pointer to the DB when a parallel group fails under `resume-later`, and
   set the run status to a new `paused_on_failure` (or reuse the gate mechanism).
2. **A synthetic human gate**: emit a `human_gate`-style pending record so an
   operator can choose "continue" or "abort", reusing the existing
   `human_gates` table and `waitForGate` loop.
3. **A resume entry point**: a method (and API route) to rehydrate a paused run
   from persisted state and continue from the saved pointer — including surviving
   a server restart (today `recoverStaleRuns` only recovers, it does not resume
   mid-run).
4. Tests for pause → operator-continue, pause → operator-abort, and
   resume-after-restart.

This is multi-day, MED/HIGH risk (touches the core run loop), and should be its
own numbered plan with the maintainer's explicit go-ahead. The recommendation of
this plan remains **removal**.

## Maintenance notes

- After removal, `continue` is the only "don't abort" policy; if pause-for-human
  is later wanted, prefer an explicit `human_gate` step after the parallel group
  over reintroducing a magic policy value.
- Reviewer should confirm the default failure behavior is still `abort` and that
  no fixture silently changed meaning.
