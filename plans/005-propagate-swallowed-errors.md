# Plan 005: Surface two silently-swallowed error paths (create_task dispatch + vector-store indexing)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- server/src/agents/tool-executor.ts server/src/memory/engine.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

Two failures currently vanish with no log and no signal:

1. **Vector-store indexing failure is swallowed entirely.** In
   `MemoryEngine.remember()` (`memory/engine.ts:83`), the fact is written to
   SQLite and then indexed with `this.vectorStore.add(...).catch(() => {})`. If
   indexing fails (disk full, LanceDB locked, embedding error), nothing is logged.
   The fact exists in SQL but not in the vector index, so semantic `recall()`
   silently misses it — degraded recall quality with zero diagnostics.

2. **`create_task` tool dispatch errors are only partially observable.** In
   `ToolExecutor.execute()` (`tool-executor.ts:56-60`), the agent-invoked
   `create_task` fires `sessionMgr.dispatch(...)` without awaiting and returns
   `{ status: 'dispatched' }` immediately. The `.then/.catch` updates the task
   tracker, so status is eventually consistent — but the failure is never logged
   and the calling agent is told "dispatched" even when the dispatch will fail.
   A dispatched task that fails to start leaves no log trail for the operator.

Both fixes are small: add structured logging so operators can diagnose, without
changing the (intentional) fire-and-forget dispatch model of `create_task`.

## Current state

`server/src/memory/engine.ts`:
- `remember()` (`engine.ts:69-85`) — writes the fact, then:
  ```ts
  // Index in vector store
  this.vectorStore.add(id, content, { scope, category, agentId }).catch(() => {});
  ```
  The engine already tracks degradation via `_degraded` / `isDegraded()`
  (`engine.ts:60-62`) and `storeName()` (`engine.ts:64-66`), and it already uses
  `logger` (pino) elsewhere in the file (e.g. `engine.ts:73`). So a `logger.warn`
  is idiomatic and available.

`server/src/agents/tool-executor.ts`:
- `create_task` case (`tool-executor.ts:43-61`):
  ```ts
  this.deps.sessionMgr.dispatch(agent, description, task.id).then(
    (result) => this.deps.tracker.setComplete(task.id, result),
    (err) => this.deps.tracker.setFailed(task.id, err?.message || String(err)),
  );
  return JSON.stringify({ taskId: task.id, status: 'dispatched' });
  ```
  The error branch sets the task failed but does not log. The tool returns before
  dispatch resolves — this fire-and-forget behavior is intended (agents should not
  block on a sub-task completing); only the *observability* is missing.

Conventions (AGENTS.md): structured pino logging with a context object; tool
execution returns strings/JSON strings; service methods throw, callers convert.
Existing tests: `server/src/memory/__tests__/engine.test.ts` and
`server/src/agents/__tests__/tool-executor.test.ts`.

## Commands you will need

| Purpose          | Command                                                             | Expected      |
|------------------|---------------------------------------------------------------------|---------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                     | exit 0        |
| Memory tests     | `cd server && npx vitest run src/memory/__tests__/engine.test.ts`   | all pass      |
| Tool-exec tests  | `cd server && npx vitest run src/agents/__tests__/tool-executor.test.ts` | all pass |

> `npm test` needs the native module built for the running Node ABI (plan 002).

## Scope

**In scope** (the only files you should modify):
- `server/src/memory/engine.ts`
- `server/src/agents/tool-executor.ts`
- `server/src/memory/__tests__/engine.test.ts` (add a case)
- `server/src/agents/__tests__/tool-executor.test.ts` (add a case)

**Out of scope** (do NOT touch):
- The fire-and-forget dispatch model of `create_task` — do NOT make the tool
  `await` the full dispatch. The agent must get a prompt-turn back promptly; only
  add logging. (Awaiting would block the agent for up to the 10-minute dispatch
  timeout.)
- The `VectorStore` interface and its implementations (`vector-store/`).
- `MemoryEngine.recall()` and the degradation accessors — leave them as is.

## Git workflow

- Branch: `advisor/005-propagate-swallowed-errors`
- One commit. Message style: conventional commits. Example from `git log`:
  `fix(server): preexisting TS errors in files route + skills call`. Suggested:
  `fix(server): log swallowed vector-index and create_task dispatch failures`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Log vector-store indexing failures

In `engine.ts:83`, replace the empty catch with a structured warn that names the
fact id and reason:

```ts
// Index in vector store (best-effort; SQL is the source of truth)
this.vectorStore.add(id, content, { scope, category, agentId }).catch((err) => {
  logger.warn(
    { factId: id, scope, store: this._storeName, err: err?.message || String(err) },
    'Vector-store indexing failed; fact is stored in SQL but not semantically searchable',
  );
});
```

**Verify**: `grep -n ".catch(() => {})" server/src/memory/engine.ts` → no matches.
`cd server && npx tsc --noEmit` → exit 0.

### Step 2: Log create_task dispatch outcomes

In `tool-executor.ts:56-59`, add logging to both branches while keeping the
fire-and-forget shape (still no `await` before the `return`):

```ts
this.deps.sessionMgr.dispatch(agent, description, task.id).then(
  (result) => this.deps.tracker.setComplete(task.id, result),
  (err) => {
    const msg = err?.message || String(err);
    logger.warn({ taskId: task.id, agentId: agent.id, err: msg }, 'create_task dispatch failed');
    this.deps.tracker.setFailed(task.id, msg);
  },
);
```

If `logger` is not already imported in `tool-executor.ts`, add
`import { logger } from '../logging/index.js';` (match the existing import style —
`.js` extension, named import).

**Verify**: `cd server && npx tsc --noEmit` → exit 0.
`grep -n "logger" server/src/agents/tool-executor.ts` → shows the import and use.

### Step 3: Tests

- **engine.test.ts**: add a case where `vectorStore.add` rejects (inject/mock a
  vector store whose `add` returns a rejected promise) and assert that
  `remember()` still returns the fact (SQL write succeeds) and does not throw. If
  the test harness can capture the logger, assert a warn was emitted; if not,
  asserting no-throw + returned fact is sufficient.
- **tool-executor.test.ts**: add a case where `sessionMgr.dispatch` rejects and
  assert `tracker.setFailed` is called with the error message. (The existing
  tests already mock `sessionMgr`; extend that mock to reject.)

**Verify**:
- `cd server && npx vitest run src/memory/__tests__/engine.test.ts` → all pass.
- `cd server && npx vitest run src/agents/__tests__/tool-executor.test.ts` → all pass.

## Test plan

- New cases in the two existing test files above, modeled on their current
  structure (both already mock dependencies).
- Verification: both vitest filters pass, and `cd server && npm test` shows no new
  failures elsewhere.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0
- [ ] `grep -n ".catch(() => {})" server/src/memory/engine.ts` returns no matches
- [ ] `create_task`'s dispatch error branch logs via `logger.warn` before `setFailed`
- [ ] `create_task` still returns `{ status: 'dispatched' }` synchronously (no `await` added before the return)
- [ ] Both new test cases pass
- [ ] `git status` shows only the four in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Making `create_task` observable appears to require awaiting the dispatch (it
  does not — only logging is needed). If you find yourself adding `await` before
  the return, stop and re-read the Scope section.
- The memory test harness cannot inject a failing vector store without changing
  the `MemoryEngine` constructor signature in a way that breaks other callers —
  report it (a small constructor-injection seam may be acceptable, but confirm
  first).

## Maintenance notes

- A stronger follow-up (deliberately out of scope): add an `indexed BOOLEAN`
  column to the `facts` table and a repair task that re-indexes facts whose vector
  add failed. That turns the log line into a recoverable state. Flag for a future
  plan; do not build it here.
- Reviewer should confirm the dispatch remains fire-and-forget and that the new
  log lines carry enough context (task id, agent id, reason) to diagnose without a
  code change.
