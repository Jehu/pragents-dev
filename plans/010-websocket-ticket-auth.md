# Plan 010: Short-lived WebSocket ticket issued over an authenticated POST

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- server/src/api/middleware/auth.ts server/src/api/ws.ts server/src/index.ts web/src/stores/connection.ts web/src/hooks/useWebSocket.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 003 (removes the insecure `?token=` fallbacks; this plan provides the secure replacement). Do 003 first.
- **Category**: security
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

A browser cannot set an `Authorization` header on a `WebSocket` connection (the
`WebSocket` constructor takes only a URL and subprotocols). Today the web client
connects with **no credential at all** — `new WebSocket(`${protocol}//${location.host}/ws`)`
(`web/src/hooks/useWebSocket.ts`) — and only works because of the localhost auth
bypass. The moment pragents is served beyond localhost, the dashboard's live feed
breaks, and the only non-localhost WS auth path is the `?token=` query string,
which leaks the long-lived API token into logs, proxy history, and browser history
(the reason plan 003 removes it).

The clean fix: the client first makes an **authenticated POST** (Bearer header,
which it can send) to obtain a **short-lived, single-use ticket**, then opens the
WebSocket with `?ticket=<value>`. The ticket expires in seconds and is consumed on
first use, so even if it lands in a log it is worthless almost immediately. The
long-lived API token never travels in a URL.

## Current state

- **WS auth gate** — `server/src/api/ws.ts:21-52`: a Hono middleware on `/ws`
  calls `checkWsAuth({ url, headers, socket }, expected)` (from
  `server/src/api/middleware/auth.ts:141-176`) before the upgrade; on failure it
  returns 401 and the socket is never accepted. `checkWsAuth` currently accepts:
  localhost, `Authorization: Bearer`, and (until plan 003) `?token=`.
- **Token source** — `getToken()` defaults to `process.env.PRAGENTS_API_TOKEN`
  (`ws.ts:13`); the same token the HTTP `authMiddleware` checks
  (`auth.ts:105-131`).
- **Web client** — `web/src/hooks/useWebSocket.ts` builds `wsUrl` and calls
  `new WebSocket(wsUrl)` with no auth. Reconnect/backoff logic lives in the same
  file (`scheduleReconnect`). `web/src/stores/connection.ts` is the connection
  store. The web app has no stored token today (grep for `token` in web stores/
  hooks returns nothing) — it relies on localhost.
- **Route mounting** — API routes are Hono routers mounted under `/api/v1` in
  `server/src/index.ts`; `authMiddleware` protects `/api/*` (localhost-bypass +
  Bearer). A new authenticated POST route fits this existing pattern.

Conventions: one Hono router per resource under `server/src/api/routes/`, each a
factory function; Zod at boundaries; pino logging; strict TS with `.js` imports;
tests co-located in `__tests__/`. Auth tests: `server/src/api/middleware/__tests__/auth.test.ts`.

## Commands you will need

| Purpose          | Command                                                                 | Expected   |
|------------------|-------------------------------------------------------------------------|------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                         | exit 0     |
| Auth tests       | `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts` | all pass   |
| Ticket tests     | `cd server && npx vitest run src/api/middleware/__tests__/ws-ticket.test.ts` | all pass |
| Web typecheck    | `cd web && npx tsc --noEmit`                                            | exit 0     |
| Web tests        | `cd web && npx vitest run`                                              | all pass   |

## Scope

**In scope** (the only files you should create/modify):
- `server/src/api/middleware/ws-ticket.ts` (create) — the ticket store + issue/consume
- `server/src/api/middleware/__tests__/ws-ticket.test.ts` (create)
- `server/src/api/routes/ws-ticket.ts` (create) — `POST /api/v1/ws-ticket` route (auth-protected)
- `server/src/index.ts` — mount the new route
- `server/src/api/ws.ts` — accept `?ticket=` in the upgrade gate
- `server/src/api/middleware/auth.ts` — add ticket acceptance to `checkWsAuth` (or call the ticket store from `ws.ts`; see Step 4)
- `web/src/hooks/useWebSocket.ts` — fetch a ticket then connect
- `AGENTS.md` — document the ticket flow under "Auth"
- `.env.example` / README — mention non-localhost WS now uses a ticket

**Out of scope** (do NOT touch):
- The localhost bypass — keep it; local dev needs no ticket.
- The `Authorization: Bearer` HTTP path — unchanged; the ticket route *uses* it.
- The event buffer / broadcast logic in `ws.ts:57-89`.
- Reintroducing any long-lived `?token=` path (plan 003 removed it for a reason).

## Git workflow

- Branch: `advisor/010-websocket-ticket-auth`
- Two commits (server ticket flow, then web client). Message style: conventional
  commits. Example from `git log`: `fix(server): tighten workflow CRUD security + path handling`.
  Suggested: `feat(auth): short-lived single-use WebSocket tickets`.
- Do NOT push or open a PR unless the operator instructed it.

## Design decisions (apply these)

- **Ticket value**: `randomBytes(32).toString('hex')` (same primitive as the API
  token in `auth.ts:20`).
- **TTL**: 30 seconds. Long enough for the immediate connect + reconnect races,
  short enough to be worthless if logged.
- **Single-use**: consumed on first successful WS upgrade; a second use of the
  same ticket fails.
- **Storage**: in-memory `Map<string, number>` (ticket → expiry epoch ms), with a
  lazy sweep of expired entries on each issue/consume. No DB — tickets are
  ephemeral and per-process; a restart invalidating outstanding tickets is fine
  (the client re-fetches). Use a hot-reload-safe global singleton like `ws.ts`
  does for `wsClients` (`ws.ts:6-8`) so tsx-watch re-execution does not wipe it
  mid-session.
- **Issuance is auth-gated**: `POST /api/v1/ws-ticket` sits behind the existing
  `authMiddleware`, so only a localhost caller or a valid Bearer token can mint a
  ticket. This is the security anchor — the ticket is only as obtainable as the
  API token itself.

## Steps

### Step 1: Ticket store

Create `server/src/api/middleware/ws-ticket.ts` exporting:

```ts
export function issueWsTicket(): { ticket: string; expiresInMs: number }
export function consumeWsTicket(ticket: string): boolean  // true if valid+unexpired; deletes it
```

Back it with a hot-reload-safe global `Map<string, number>` (ticket → expiryMs),
sweeping expired entries on each call. `issueWsTicket` generates the value, stores
`now + 30_000`, returns `{ ticket, expiresInMs: 30_000 }`. `consumeWsTicket`
returns false for unknown/expired tickets, otherwise deletes and returns true.

> Note: `Date.now()` is available in normal server code (the ScheduleWakeup/
> workflow-script restriction does not apply here) — use it for expiry.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 2: Issue route

Create `server/src/api/routes/ws-ticket.ts` — a factory returning a Hono router
with `POST /` that calls `issueWsTicket()` and returns `{ ticket, expiresInMs }`
as JSON. Mount it in `server/src/index.ts` under `/api/v1/ws-ticket` alongside the
other routers, so the existing `authMiddleware` on `/api/*` protects it.

**Verify**: `cd server && npx tsc --noEmit` → exit 0. `grep -n "ws-ticket" server/src/index.ts` → shows the mount.

### Step 3: Confirm the issue route is auth-protected

The route must be under the same `authMiddleware` as the rest of `/api/*`. Verify
by reading `index.ts` middleware wiring — a non-localhost request without a valid
Bearer token must get 401 from `POST /api/v1/ws-ticket`. Do not add a second auth
layer; rely on the existing one.

**Verify**: `cd server && npx tsc --noEmit` → exit 0 (behavioral check covered by tests in Step 6).

### Step 4: Accept `?ticket=` at the WS upgrade

In the `/ws` gate (`ws.ts:21-52`), before returning 401, if `checkWsAuth` fails,
extract `ticket` from the upgrade URL and call `consumeWsTicket(ticket)`; if it
returns true, allow the upgrade. Keep localhost and Bearer paths working.

Prefer to keep `checkWsAuth` focused on the long-lived token and do the ticket
check in `ws.ts` (so the ticket store is not a dependency of the pure auth
helper). Target shape inside the gate:

```ts
if (!result.ok) {
  const ticket = new URL(c.req.url, 'http://localhost').searchParams.get('ticket');
  if (!(ticket && consumeWsTicket(ticket))) {
    return c.json({ error: 'Unauthorized', hint: 'POST /api/v1/ws-ticket for a WebSocket ticket' }, 401);
  }
}
return next();
```

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 5: Web client — fetch a ticket, then connect

In `web/src/hooks/useWebSocket.ts`, change `connectWebSocket` so that before
opening the socket it:
- attempts `POST /api/v1/ws-ticket` (same-origin; include the Bearer header if the
  app has a token — today it has none, and on localhost the POST succeeds via the
  bypass, returning a ticket anyway);
- on success, opens `new WebSocket(`${wsUrl}?ticket=${ticket}`)`;
- on failure (non-2xx), falls back to opening `wsUrl` with no ticket (preserves
  today's localhost behavior) and lets the existing reconnect/backoff handle it.

Keep the existing reconnect logic; each reconnect fetches a fresh ticket (tickets
are single-use, so reusing one would fail). Keep the change minimal and typed.

**Verify**: `cd web && npx tsc --noEmit` → exit 0. `cd web && npx vitest run` → all pass.

### Step 6: Tests

- `ws-ticket.test.ts` (server): `issueWsTicket` returns a ticket;
  `consumeWsTicket` returns true once then false on reuse; an expired ticket
  (advance time with `vi.useFakeTimers`) returns false; unknown ticket returns
  false.
- Extend `auth.test.ts` or add a route test: `POST /api/v1/ws-ticket` from a
  non-localhost request without a Bearer token → 401; with a valid Bearer → 200 +
  a ticket. (Model on existing auth/route tests.)
- If a WS-gate test harness exists, add: upgrade with a valid `?ticket=` → allowed;
  reused ticket → 401. If the WS upgrade is impractical to test directly, the
  `consumeWsTicket` unit tests plus the route auth test are sufficient — note the
  gap.

**Verify**:
- `cd server && npx vitest run src/api/middleware/__tests__/ws-ticket.test.ts` → all pass.
- `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts` → all pass.

### Step 7: Document

- `AGENTS.md` "Auth" section: add that non-localhost WebSocket clients obtain a
  short-lived single-use ticket via `POST /api/v1/ws-ticket` (Bearer-authenticated)
  and connect with `?ticket=`; the long-lived token never appears in a URL.
- Note in README/.env.example that remote WS uses the ticket flow.

**Verify**: `grep -n "ws-ticket" AGENTS.md` → shows the new documentation.

## Test plan

- New `ws-ticket.test.ts` covering issue/consume/expiry/reuse.
- Route auth test for `POST /api/v1/ws-ticket` (401 without Bearer off-localhost;
  200 with Bearer), modeled on existing route/auth tests.
- Web: existing `useWebSocket`/connection tests must still pass; add one asserting
  the client requests a ticket before connecting when not on the no-token path (if
  the web test harness supports mocking fetch; otherwise note the gap).
- Verification: server and web vitest runs green; both typechecks green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0 and `cd web && npx tsc --noEmit` exits 0
- [ ] `POST /api/v1/ws-ticket` exists, is under `authMiddleware`, returns `{ ticket, expiresInMs }`
- [ ] `consumeWsTicket` is single-use and TTL-bounded (unit tests prove reuse+expiry fail)
- [ ] `/ws` upgrade accepts a valid `?ticket=` and rejects a reused/expired one
- [ ] The web client fetches a ticket before opening the socket (with localhost fallback)
- [ ] No long-lived `?token=` WS path is reintroduced (`grep -n "token" server/src/api/ws.ts` shows only the Bearer/getToken path)
- [ ] `cd server && npx vitest run src/api/middleware/__tests__/` passes; `cd web && npx vitest run` passes
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 003 has not landed and the `?token=` WS fallback is still present — this
  plan assumes 003 removed/​gated it; coordinate ordering rather than layering two
  query-auth mechanisms.
- The WS upgrade gate cannot read the request URL to extract `?ticket=` in the
  `@hono/node-ws` version in use — report the API shape; do not hack around it.
- The web `useWebSocket` reconnect path cannot be made to fetch a fresh ticket per
  attempt without a larger refactor of the store — report it; a minimal working
  version (ticket on first connect, token-less fallback on reconnect) is acceptable
  as an interim, but say so.

## Maintenance notes

- Tickets are per-process and in-memory by design; a horizontally-scaled/remote
  deployment (multiple server instances behind a load balancer) would need a
  shared ticket store (e.g. the SQLite DB or Redis) — flag this when/if remote
  multi-instance deployment is on the table. For the current single-process
  sidecar it is correct as-is.
- The 30s TTL and single-use policy are the security properties — a reviewer
  should confirm both, and confirm the issue route is genuinely behind
  `authMiddleware` (the whole scheme collapses if tickets can be minted
  unauthenticated off-localhost).
- If the API token later gains expiry/rotation (a separate hardening idea), the
  ticket route inherits it for free since it authenticates with the same token.
