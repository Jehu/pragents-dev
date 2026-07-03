# Plan 003: Stop logging the API token and remove the WebSocket query-string token fallback

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- server/src/api/middleware/auth.ts server/src/api/ws.ts server/src/api/middleware/__tests__`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

Two credential-hygiene issues in the auth layer:

1. **Token written to the log.** When the server generates a fresh
   `PRAGENTS_API_TOKEN`, it logs the token value itself
   (`server/src/api/middleware/auth.ts:32`). The token grants full remote API
   access. Logs go to `~/.pragents/logs/pragents.log` (persisted JSON) and to the
   console; any log shipping or shared console history leaks the credential. The
   token is already written to `~/.pragents/.env`, so the operator does not need
   it in the log too.

2. **Token accepted in the URL query string** for both the HTTP middleware
   (`?token=`, `auth.ts:124-127`) and the WebSocket upgrade
   (`checkWsAuth`, `auth.ts:164-173`). Query strings land in access logs, proxy
   logs, and browser history — a well-known credential-leak vector. The
   `Authorization: Bearer` path already exists and is the correct transport.

Both fixes are small and self-contained. Because the WS query fallback may be the
only way the current web client authenticates its socket, this plan removes the
**HTTP** query fallback outright and gates the **WS** query fallback behind an
explicit opt-in env var (defaulting to off) so the socket does not silently break.

## Current state

`server/src/api/middleware/auth.ts`:

- Lines 32–35 — logs the token:
  ```ts
  logger.warn(
    { token, envPath },
    'Generated new PRAGENTS_API_TOKEN — copy this into your client config',
  );
  ```
- Lines 116–127 — HTTP middleware: after the `Authorization: Bearer` check, a
  `?token=` query fallback:
  ```ts
  const queryToken = c.req.query('token');
  if (queryToken && queryToken === expected) {
    return next();
  }
  ```
- Lines 164–173 — `checkWsAuth` accepts `?token=` from the upgrade URL:
  ```ts
  // Query token
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const t = parsed.searchParams.get('token');
      if (t && t === expected) return { ok: true, reason: 'query' };
    } catch { /* ignore malformed url */ }
  }
  ```

`server/src/api/ws.ts` — calls `checkWsAuth` for the upgrade. Read it to see how
the reason (`'localhost' | 'header' | 'query'`) is used/logged before changing
the behavior.

Convention: structured pino logging (`logger.warn({ ctx }, 'message')`); never
`console.log`. Existing auth tests live at
`server/src/api/middleware/__tests__/auth.test.ts` — model new test cases on them.

## Commands you will need

| Purpose          | Command                                                              | Expected            |
|------------------|---------------------------------------------------------------------|---------------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                     | exit 0              |
| Auth tests       | `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts` | all pass        |
| Grep token log   | `grep -n "token" server/src/api/middleware/auth.ts`                 | no `{ token,` context |

## Scope

**In scope** (the only files you should modify):
- `server/src/api/middleware/auth.ts`
- `server/src/api/middleware/__tests__/auth.test.ts` (add cases)
- `server/src/api/ws.ts` — only if the removed `reason: 'query'` path needs a
  caller-side adjustment (check first; it may need none)

**Out of scope** (do NOT touch):
- The localhost bypass logic (`isLocalhostRequest`, the localhost branch of
  `checkWsAuth`) — that is a documented design decision (AGENTS.md "Auth").
- The `Authorization: Bearer` header paths — they are correct; keep them.
- The web client (`web/src/`) — if it relies on `?token=` for the socket, that is
  handled by the opt-in env var below; do not rewrite the client in this plan.
- Token generation / `.env` persistence logic — only remove the token from the
  *log line*, keep the file write.

## Git workflow

- Branch: `advisor/003-stop-logging-token-and-ws-query-auth`
- One commit. Message style: conventional commits. Example from `git log`:
  `fix(server): tighten workflow CRUD security + path handling`. Suggested:
  `fix(server): stop logging API token; gate WS query-token behind opt-in`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the token value from the log

In `auth.ts`, change the `logger.warn` context on lines 32–35 to drop the `token`
field. Keep `envPath` and reword the message to point the operator at the env file:

```ts
logger.warn(
  { envPath },
  'Generated new PRAGENTS_API_TOKEN and wrote it to the env file — copy it from there into your client config',
);
```

**Verify**: `grep -n "token" server/src/api/middleware/auth.ts` → the string
`{ token,` no longer appears in any `logger.*` call.

### Step 2: Remove the HTTP `?token=` query fallback

Delete the query-token block in the HTTP middleware (lines 124–127). After the
`Authorization: Bearer` check fails, fall straight through to `unauthorized(c)`.

**Verify**: `cd server && npx tsc --noEmit` → exit 0. `grep -n "c.req.query('token')" server/src/api/middleware/auth.ts` → no matches.

### Step 3: Gate the WS `?token=` fallback behind an opt-in env var

The WebSocket upgrade cannot send an `Authorization` header from a browser
`WebSocket` constructor, so a hard removal could break the web client. Instead,
gate the query fallback in `checkWsAuth` behind an env flag that defaults to OFF:

- Keep the localhost bypass and the `Authorization: Bearer` header check unchanged.
- Wrap the query-token block (lines 164–173) so it only runs when
  `process.env.PRAGENTS_ALLOW_WS_QUERY_TOKEN === '1'`.
- When the flag is off (default) and only a query token is present, return
  `{ ok: false }`.

Target shape:

```ts
// Query token — opt-in only; disabled by default because query strings
// leak into logs/proxy history. Set PRAGENTS_ALLOW_WS_QUERY_TOKEN=1 to allow.
if (req.url && process.env.PRAGENTS_ALLOW_WS_QUERY_TOKEN === '1') {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    const t = parsed.searchParams.get('token');
    if (t && t === expected) return { ok: true, reason: 'query' };
  } catch { /* ignore malformed url */ }
}
```

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 4: Add/adjust tests

In `auth.test.ts` add cases:
- HTTP: a non-localhost request with a correct `?token=` and no Bearer header is
  now **rejected** (401).
- HTTP: a non-localhost request with a correct `Authorization: Bearer` still passes.
- `checkWsAuth`: non-localhost + correct query token, flag unset → `{ ok: false }`.
- `checkWsAuth`: non-localhost + correct query token, `PRAGENTS_ALLOW_WS_QUERY_TOKEN='1'`
  → `{ ok: true, reason: 'query' }` (set and unset the env var within the test;
  restore it in a `finally`/`afterEach`).
- `checkWsAuth`: non-localhost + correct Bearer header → `{ ok: true, reason: 'header' }` regardless of flag.

**Verify**: `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts` → all pass, including the new cases.

### Step 5: Check the WS caller

Open `server/src/api/ws.ts`. Confirm nothing breaks now that `reason: 'query'`
only occurs under the flag. If the caller logs or branches on `reason`, no change
is needed (the union type is unchanged). Do not add new behavior.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

## Test plan

- New tests in `server/src/api/middleware/__tests__/auth.test.ts`, modeled on the
  existing structure in that file, covering the five cases in Step 4.
- Verification: `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts`
  → all pass including the new cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0
- [ ] `grep -n "{ token," server/src/api/middleware/auth.ts` returns no matches inside a `logger` call
- [ ] `grep -n "c.req.query('token')" server/src/api/middleware/auth.ts` returns no matches
- [ ] `checkWsAuth` query path is guarded by `PRAGENTS_ALLOW_WS_QUERY_TOKEN`
- [ ] `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts` passes with new cases
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The web client (`web/src/`) is found to authenticate the WebSocket **only** via
  `?token=` with no header path AND no way to set the opt-in env — removing the
  default would break local use. Report this so the operator decides whether to
  ship a client-side header/cookie approach first.
- `checkWsAuth`'s return-type union is consumed somewhere that a compile error
  appears you cannot resolve within the in-scope files.
- Removing the HTTP query fallback breaks an existing passing test that asserts
  query-token acceptance — report it rather than deleting the assertion silently
  (the assertion encodes intended behavior worth a human decision).

## Maintenance notes

- Document `PRAGENTS_ALLOW_WS_QUERY_TOKEN` in `.env.example` and the README auth
  section as a discouraged compatibility shim (follow-up, or fold into plan 006's
  docs pass).
- The long-term fix for browser WebSocket auth is a short-lived cookie or a
  ticket endpoint (issue a one-time WS ticket over an authenticated POST). That is
  a larger design change, deliberately out of scope here.
- Reviewer should confirm the token no longer appears in any log statement and
  that the localhost bypass is untouched.
