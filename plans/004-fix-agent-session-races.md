# Plan 004: Serialize agent session creation and protect in-flight dispatches from disposal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- server/src/agents/manager.ts server/src/agents/__tests__/manager.test.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 002 (so the server test suite runs in CI and locally on the pinned Node)
- **Category**: bug
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

`AgentSessionManager` has two concurrency hazards on the session `Map`:

1. **Duplicate session creation (leak).** `getOrCreate()`
   (`manager.ts:79-96`) does check-then-act: it reads `this.sessions.get(id)`,
   and on a miss calls the async `create()`, which only `.set()`s the handle at
   the very end (`manager.ts:190`). `create()` is `async` and `await`s
   `runtime.createSession(...)`. If two dispatches for the same cold agent race,
   both see no existing session, both run `create()`, and both spawn a real pi
   SDK session. The second `.set()` overwrites the first handle — the first
   runtime session is now orphaned (never disposed until shutdown), leaking a
   process/session per race.

2. **Disposal racing an in-flight dispatch.** `disposeIdle()`
   (`manager.ts:448-476`) and `disposeAll()` (`manager.ts:478+`) iterate the map
   and dispose sessions. `disposeIdle` guards on `!handle.runtimeHandle.isStreaming`,
   but `dispatch()` (`manager.ts:261` onward) calls `getOrCreate()` and then does
   async work (`memory.recall`, building context) *before* `runtime.prompt()`
   sets streaming. In that window a session can be disposed out from under a
   dispatch that is about to use it.

Both are latent under low load but real under concurrency (the system dispatches
to agents from workflows, goals, chat, and the tool bridge simultaneously). The
fix is a per-agent in-flight-creation promise plus a reference count that
disposal honors.

## Current state

`server/src/agents/manager.ts`:

- `private sessions: Map<string, SessionHandle> = new Map();` (`manager.ts:35`)
- `SessionHandle` interface (`manager.ts:19-32`) carries `agentId`,
  `runtimeHandle`, `createdAt`, `lastActivityAt`, `stale?`, `warm?`.
- `getOrCreate()` (`manager.ts:79-96`) — check-then-act; calls `create()` on miss.
- `create()` (`manager.ts:110-192`) — `async`, `await`s `runtime.createSession`,
  `.set()`s the handle only at line 190.
- `dispatch()` (`manager.ts:~230-357`) — calls `const handle = await this.getOrCreate(agent);`
  (`manager.ts:261`), then `await this.memory.recall(...)` (`manager.ts:264`),
  builds context, then subscribes and calls `await this.runtime.prompt(...)`
  (`manager.ts:327`). Streaming (`handle.runtimeHandle.isStreaming`) becomes true
  only once `prompt` runs.
- `disposeIdle()` (`manager.ts:448-476`) — guards `!handle.runtimeHandle.isStreaming`
  and idle timeout, then `runtime.dispose` + `sessions.delete`.
- `disposeAll()` (`manager.ts:478+`) — disposes every session (server shutdown).

Convention: named exports, strict TS, service classes own their domain. Existing
tests: `server/src/agents/__tests__/manager.test.ts` (mocks the runtime via an
injected `AgentRuntime` — the constructor takes `runtime` as its 4th arg,
`manager.ts:55`). Model new tests on that file; use the injected mock runtime to
control timing.

## Commands you will need

| Purpose          | Command                                                        | Expected        |
|------------------|----------------------------------------------------------------|-----------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                | exit 0          |
| Manager tests    | `cd server && npx vitest run src/agents/__tests__/manager.test.ts` | all pass    |
| Full server test | `cd server && npm test`                                        | all pass        |

> Note: `cd server && npm test` needs the native `better-sqlite3` built for the
> running Node ABI. If it errors with `NODE_MODULE_VERSION`, run `npm install`
> then `npm rebuild better-sqlite3` on the Node version from `.nvmrc` (plan 002).

## Scope

**In scope** (the only files you should modify):
- `server/src/agents/manager.ts`
- `server/src/agents/__tests__/manager.test.ts` (add cases)

**Out of scope** (do NOT touch):
- `server/src/agents/runtime/` — the runtime adapter and its `isStreaming` flag
  are the boundary; do not change the runtime contract.
- `server/src/agents/tool-executor.ts` — its dispatch usage is plan 005.
- The keepWarm / stale-restart logic beyond what reference counting requires —
  keep `warm` and `stale` semantics intact.
- The `getMessages`/`persistSessionMessages` paths.

## Git workflow

- Branch: `advisor/004-fix-agent-session-races`
- One or two commits (creation-guard, then ref-count). Message style: conventional
  commits. Example from `git log`: `fix: read workflow run id from event payload`.
  Suggested: `fix(agents): serialize session creation and ref-count dispatches`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a per-agent in-flight creation guard

Add a field `private creating: Map<string, Promise<SessionHandle>> = new Map();`
Rework `getOrCreate()` so that when it decides to create (cold miss, or after
disposing a stale session), it:
- checks `this.creating.get(agent.id)` first and `await`s it if present;
- otherwise stores the `create(agent)` promise in `creating` **before** awaiting,
  awaits it, and removes it from `creating` in a `finally`.

Target shape:

```ts
async getOrCreate(agent: ResolvedAgent): Promise<SessionHandle> {
  const existing = this.sessions.get(agent.id);
  if (existing) {
    if (existing.stale && !existing.runtimeHandle.isStreaming) {
      logger.info({ agentId: agent.id }, 'Restarting stale session with updated config');
      this.persistSessionMessages(agent.id, existing);
      this.runtime.dispose(existing.runtimeHandle);
      this.sessions.delete(agent.id);
      // fall through to guarded create
    } else {
      existing.lastActivityAt = Date.now();
      return existing;
    }
  }
  const inflight = this.creating.get(agent.id);
  if (inflight) return inflight;
  const p = this.create(agent).finally(() => this.creating.delete(agent.id));
  this.creating.set(agent.id, p);
  return p;
}
```

Because JS is single-threaded and `getOrCreate` sets `creating` synchronously
before any `await`, a second concurrent caller observes the in-flight promise and
shares it — no duplicate `create()`.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 2: Add reference counting to SessionHandle

Add `refCount: number;` to the `SessionHandle` interface (initialize to `0` in
`create()` where the handle is built, `manager.ts:182-188`).

In `dispatch()`, immediately after `const handle = await this.getOrCreate(agent);`
(`manager.ts:261`), increment `handle.refCount++`. Wrap the remainder of dispatch
(memory recall through returning the response) in `try { ... } finally { handle.refCount--; }`
so the count is always released, including on error/timeout.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 3: Make disposal honor the reference count

In `disposeIdle()` (`manager.ts:457`), change the guard to also require
`handle.refCount === 0` (in addition to `!isStreaming` and the idle timeout). A
session with an in-flight dispatch is never disposed.

In `disposeAll()`, keep disposing all sessions (shutdown must terminate), but skip
or briefly await any session with `refCount > 0` before force-disposing — the
existing `shutdown()` path already grants a grace deadline (AGENTS.md: "disposeAll
during shutdown drains in-flight dispatches with a 15s deadline"). Do NOT add new
timers; just add the `refCount` check so the drain logic in the caller has
something to observe. If `disposeAll` currently disposes unconditionally, add:
skip sessions with `refCount > 0` on the first pass, then dispose remaining on a
second pass (leave the deadline logic in the caller untouched).

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 4: Tests

In `manager.test.ts`, using the injected mock runtime:
- **Creation race**: make the mock `createSession` return a promise that resolves
  after a controllable delay. Call `getOrCreate(agent)` twice concurrently for the
  same agent. Assert `createSession` was called exactly **once** and both calls
  resolve to the **same** handle.
- **Ref-count blocks idle disposal**: start a `dispatch()` whose mock `prompt`
  hangs (never emits `agent_end`), so `refCount` stays 1. Set `lastActivityAt`
  into the past and call `disposeIdle()`. Assert the session is **not** disposed
  (`runtime.dispose` not called for it, session still in the map).
- **Ref-count releases on timeout/error**: force the dispatch to reject (mock
  `prompt` rejects), assert `refCount` returns to 0 afterward (a subsequent
  `disposeIdle()` with an old `lastActivityAt` now disposes it).

**Verify**: `cd server && npx vitest run src/agents/__tests__/manager.test.ts` → all pass, including the three new cases.

## Test plan

- New tests in `server/src/agents/__tests__/manager.test.ts`, modeled on the
  existing mock-runtime setup in that file, covering: creation race → single
  session; ref-count prevents idle disposal; ref-count released on error.
- Verification: `cd server && npx vitest run src/agents/__tests__/manager.test.ts`
  → all pass; then `cd server && npm test` → no new failures elsewhere.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0
- [ ] `SessionHandle` has a `refCount` field; `dispatch()` increments it after
      `getOrCreate` and decrements it in a `finally`
- [ ] `getOrCreate` shares an in-flight `create()` promise via a `creating` map
- [ ] `disposeIdle` skips sessions with `refCount > 0`
- [ ] `cd server && npx vitest run src/agents/__tests__/manager.test.ts` passes with new cases
- [ ] `cd server && npm test` passes (on the pinned Node)
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `dispatch()` has multiple return points that make a single `try/finally` around
  the ref-count release awkward — report the structure rather than duplicating the
  decrement across branches (a missed branch reintroduces the leak).
- The mock runtime in `manager.test.ts` does not expose a controllable
  `isStreaming`/delay hook and adding one would change the runtime interface
  (out of scope) — report it.
- `disposeAll`'s caller (`shutdown()` in `server/src/index.ts`) turns out to
  depend on `disposeAll` being synchronous/unconditional in a way that the
  refCount check breaks — report before changing shutdown behavior.

## Maintenance notes

- The `creating` map must be cleared in the `finally` even on `create()` failure,
  or a failed cold-start would wedge the agent (every future `getOrCreate` awaits
  a rejected promise). The `.finally(() => this.creating.delete(...))` handles
  this — reviewer should confirm it runs on the rejection path too.
- If a future change makes `dispatch()` re-entrant on the same handle (parallel
  prompts on one session), the ref-count already covers it — but revisit the
  `isStreaming` assumption at that point.
- Reviewer should scrutinize that `warm` and `stale` restart semantics are
  unchanged and that no dispatch path can leak a ref (every increment has a
  matching decrement).
