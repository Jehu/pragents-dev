---
title: "feat: Add pi `/pragents` chat extension"
type: feat
status: active
date: 2026-05-12
origin: docs/brainstorms/2026-05-12-pi-client-adapter-requirements.md
---

# feat: Add pi `/pragents` chat extension

## Summary

Build a pi extension (`/pragents`) that connects the agency owner's pi terminal directly to the pragents orchestrator's chat API. The extension streams SSE events into pi's TUI, persists conversation state across sessions, and provides interactive TUI pickers for project and conversation selection. A companion server change adds a conversation-listing endpoint to power the interactive pickers.

---

## Problem Frame

The pragents server exposes a full chat protocol (`POST /api/v1/chat` over SSE) with conversation management, multi-turn context, and tool-result streaming. But the agency owner — whose daily workflow lives inside pi — has no way to reach it without context-switching to curl or the Web Dashboard. (see origin: `docs/brainstorms/2026-05-12-pi-client-adapter-requirements.md`)

---

## Requirements

**Command registration:**
- R1. Register a `/pragents` command in pi that forwards arguments as chat messages

**Conversation state:**
- R2. Persist `conversationId` across pi sessions via `pi.appendEntry()` and recover it on restart
- R3. `--new` flag starts a fresh conversation, replacing the stored `conversationId`
- R4. No stored `conversationId` acts like `--new` — fresh conversation on first use

**Chat protocol (SSE):**
- R5. Base URL defaults to `http://localhost:3000`, overridable via `PRAGENTS_URL` env var; all API calls use this base
- R6. Consume SSE response stream, parsing `data:` lines as JSON events
- R7. Render each SSE event type appropriately in pi's terminal (`thinking`, `message`, `tool_call`, `tool_result`, `error`, `done`); use interactive `confirm()` for plan proposals

**Error resilience:**
- R8. Render clear error on HTTP failure or server unreachable; do not corrupt stored state

**Navigation & flags:**
- R9. `--project <id>` scopes the chat to a pragents project; bare `--project` opens an interactive project picker
- R10. `--list` opens an interactive conversation picker showing recent conversations from the server
- R11. `--resume <id>` resumes a specific conversation by ID

**Origin actors:** Agency owner (A1)
**Origin flows:** F1 (one-shot), F2 (multi-turn), F3 (--new fresh start), F4 (server unreachable)
**Origin acceptance examples:** AE1 (first use + follow-up), AE2 (--new with existing ID), AE3 (thinking + plan proposal), AE4 (server down error), AE5 (PRAGENTS_URL override)

---

## Scope Boundaries

- Telegram, Claude Code, Hermes adapters — separate future client adapters
- Web Dashboard chat widget — web UI remains observation-only
- WebSocket chat transport — SSE is the established protocol
- Auth, multi-user, or remote deployment — local-first assumption
- Conversation history browsing beyond the interactive picker — only active chat resumption is supported
- Attachment support — deferred until pragents server supports it in the chat protocol
- `--project` with explicit id is included; bare `--project` opens interactive picker

> **Note on scope expansion:** R9-R11 (`--project`, `--list`, `--resume`) and the server conversation-listing endpoint (U2) extend beyond the origin requirements doc's deferred items. These were included in the initial version because: (a) the agency owner needs to discover and resume conversations without remembering UUIDs, (b) the `--project` flag is a thin passthrough to an existing server field, and (c) the server endpoint is a single read-only query following existing patterns. The origin's deferral noted these "can be added later without structural change" — the structural cost is low enough to bundle them with the initial deliverable rather than fragmenting the user experience across multiple releases.

### Deferred to Follow-Up Work

- Per-cwd conversation scoping (auto-inject `projectId` from working directory mapping) — separate PR after initial extension proves the interaction model
- Conversation deletion or management beyond listing and resume — separate iteration

---

## Context & Research

### Relevant Code and Patterns

- **Pi extension pattern:** `~/.pi/agent/extensions/huginn/index.ts` — canonical reference for `registerCommand()`, `ExtensionAPI` usage, `on("session_shutdown")`
- **Pi state management:** `~/.pi/agent/extensions/muninn-memory/index.ts` — reference for `appendEntry()` usage pattern
- **Pi TUI APIs:** `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.notify()`, `ctx.ui.setWorkingMessage()`, `ctx.ui.setWorkingIndicator()` — documented in pi extensions guide
- **Chat endpoint implementation:** `server/src/api/routes/chat.ts` — full SSE streaming implementation, heartbeat pattern, error handling
- **Chat endpoint tests:** `server/src/api/routes/__tests__/chat.test.ts` — exact SSE event sequences and shapes to consume
- **SSE event schemas:** `server/src/chat/schema.ts` — Zod schemas for all event types (`thinking`, `tool_call`, `tool_result`, `message` with subtypes, `error`, `done`)
- **ConversationManager:** `server/src/chat/manager.ts` — SQLite-backed conversation persistence, `getOrCreate()`, `addMessage()`, `getHistory()`
- **Projects route:** `server/src/api/routes/projects.ts` — `GET /api/v1/projects` returns `{ id, name, directory }[]`
- **Server startup:** `server/src/index.ts` — route mounting pattern with dependency injection
- **Extension SDK import:** `@mariozechner/pi-coding-agent` (`v0.73+`) — `ExtensionAPI` type, `CustomMessage` with `role: "custom"` and `customType`

### Institutional Learnings

- **`docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md`** — SSE listener unbounded growth: clear listeners on every disconnect. Timeout must reject (never resolve) so error handlers fire. Concurrent session disposal can lose results — guard with a busy flag.
- **`docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`** — Server's EventBuffer + SSE pipeline pattern. Extension should align with server event shapes, not invent its own protocol.
- **`docs/solutions/integration-issues/api-response-shape-change-breaks-consumers-2026-05-09.md`** — Consume pragents API responses defensively: destructure named properties, don't use `Array.isArray()` as a response guard.

---

## Key Technical Decisions

- **State recovery via `CustomMessage` scan:** `appendEntry()` creates `CustomMessage` entries (`type: "custom"`, `customType: "pragents-conversation"`). On `session_start`, scan `ctx.sessionManager.getBranch()` for the latest such entry and recover `conversationId` from its `data`. This is the documented pi pattern for state persistence across restarts.

  A file-based alternative (`~/.pi/agent/extensions/pragents/state.json`) was considered — it would be simpler to inspect and O(1) to read — but rejected because `appendEntry()` provides automatic branching support (state follows the pi session branch), survives `/clone` and `/fork`, and aligns with pi's extension state model. The file approach would require manual branch-awareness logic.

- **Interactive `confirm()` for plan proposals, not implicit confirmation:** When the server returns `message` with `subtype: "plan_proposal"`, the extension calls `ctx.ui.confirm()` with the plan steps and waits for explicit approve/reject. The user's choice is sent via `confirm: true/false` in the next POST. This avoids the ambiguity of "is my follow-up a confirmation or a question?" (see origin: implicit-vs-explicit tradeoff in Key Decisions)

- **Global conversation scope with `--project` override:** One `conversationId` per pi environment (global scope). The `--project <id>` flag is included in the initial version and passed through to the POST body. This gives the agency owner flexibility without the complexity of per-cwd mapping (deferred). (user decision during planning)

- **`--new` as first-token-only flag:** Parsed only as the first whitespace-delimited token of `args`. When `--new` appears mid-message, it's treated as literal text. This prevents accidental conversation resets.

- **Conversation-management commands via discrete flags, not a persistent TUI:** `--list` and `--resume` are subcommands that invoke interactive pickers (`ctx.ui.select()`) and then return to the command flow. No persistent dashboard mode — each interaction is a discrete command. (user decision during planning)

- **Busy guard for concurrency:** A local flag (`state.busy`) prevents overlapping POSTs. If the user invokes `/pragents` while a stream is active, render "Already processing" and exit. This matches pi's own command-serialization behavior.

- **Heartbeat-based timeout detection:** The server sends `: heartbeat\n\n` every 15s. If no data or heartbeat arrives for 30s (2 missed cycles), close the stream and render "Connection lost."

---

## Open Questions

### Resolved During Planning

- **State recovery mechanism:** Confirmed via pi docs — `appendEntry()` produces `CustomMessage` entries recoverable through `ctx.sessionManager.getBranch()` scan on `session_start`. Uses `customType: "pragents-conversation"`.
- **Plan confirmation UX:** Interactive `ctx.ui.confirm()` — see Key Technical Decisions.
- **Conversation scoping:** Global scope with `--project` override — user decision.
- **Conversation management UX:** Discrete `--list` / `--resume` subcommands with `ctx.ui.select()` pickers — user decision.

### Deferred to Implementation

- Exact rendering strings for each SSE event type — implementer chooses concise, pi-idiomatic output
- Whether `tool_result` should show a one-line summary or be fully silent — start with one-line summary, iterate from usage
- Exact `select()` label formatting for project/conversation pickers — settled during U4 implementation against real server data

---

## Output Structure

```
~/.pi/agent/extensions/pragents/
└── index.ts          # Single-file extension (the plan's primary deliverable)

server/src/
├── chat/
│   └── manager.ts    # +listRecent() method
├── api/
│   └── routes/
│       └── chat.ts   # +GET /api/v1/chat/conversations route
│       └── __tests__/
│           └── chat.test.ts  # +tests for listRecent
```

---

## Implementation Units

### U1. Extension foundation — scaffolding, command registration, and argument parsing

**Goal:** Create the extension file, register `/pragents` command, and parse all flag combinations correctly.

**Requirements:** R1, R3, R4, R9, R10, R11

**Dependencies:** None

**Files:**
- Create: `~/.pi/agent/extensions/pragents/index.ts`

**Approach:**
- Default-export a function receiving `ExtensionAPI` from `@mariozechner/pi-coding-agent`
- Register `/pragents` command with `pi.registerCommand("pragents", ...)` (pi SDK convention: omit leading slash — pi renders it as `/pragents` in the TUI)
- Parse `args` string for flag tokens: `--new` (first token only), `--project <id>` (value or bare), `--list` (standalone), `--resume <id>` (value required), `--confirm` (standalone, triggers follow-up POST for pending plan), `--reject` (standalone, rejects pending plan)
- Remaining text after flag extraction is the message
- Validate: reject `--list` + message, reject `--resume` without id, reject `--confirm`/`--reject` with message, reject empty message when message is required
- Resolve conflicts: `--new` + `--resume` is an error (can't both start fresh and resume); `--confirm` and `--reject` are mutually exclusive with message-sending flags
- Store parsed intent in a local request object passed to downstream flow

**Patterns to follow:**
- `~/.pi/agent/extensions/huginn/index.ts` — `registerCommand` structure, import style

**Test scenarios:**
- Happy path: `/pragents hello world` → message = "hello world", no flags set
- Happy path: `/pragents --new fresh start` → `--new` set, message = "fresh start"
- Happy path: `/pragents --project my-project status` → projectId = "my-project", message = "status"
- Happy path: `/pragents --project` → interactive project picker trigger, no message
- Happy path: `/pragents --list` → interactive conversation picker trigger
- Happy path: `/pragents --resume abc123 what next` → resumeId = "abc123", message = "what next"
- Edge case: `/pragents --new` (no message) → error rendered, no server POST
- Edge case: `/pragents    ` (whitespace only) → error rendered
- Edge case: `/pragents message with --new inside` → message = "message with --new inside" (flag not at position 1)
- Edge case: `/pragents --new --project foo bar` → both flags set, message = "bar"
- Error path: `/pragents --new --resume abc123` → error rendered, conflicting flags
- Error path: `/pragents --resume` (no id) → error rendered
- Happy path: `/pragents --confirm` → triggers confirmation POST for pending plan proposal
- Happy path: `/pragents --reject` → triggers rejection POST for pending plan proposal
- Error path: `/pragents --confirm let's do it` → error rendered (--confirm must be standalone)

**Verification:**
- Command appears in pi's command list
- All flag combinations parse correctly against the test scenarios above
- Invalid invocations render clear errors without making HTTP requests

---

### U2. Server: conversation listing endpoint

**Goal:** Add a `listRecent()` method to `ConversationManager` and a `GET /api/v1/chat/conversations` route so the extension's `--list` picker has data to display.

**Requirements:** R10 (powers the `--list` conversation picker)

**Dependencies:** None

**Files:**
- Modify: `server/src/chat/manager.ts`
- Modify: `server/src/api/routes/chat.ts`
- Modify: `server/src/api/routes/__tests__/chat.test.ts`

**Approach:**
- Add `listRecent(limit?: number, projectId?: string): Conversation[]` to `ConversationManager`:
  - SQL query: `SELECT id, project_id, last_activity_at, created_at FROM chat_conversations WHERE (project_id = ? OR ? IS NULL) ORDER BY last_activity_at DESC LIMIT ?`
  - Default limit: 20
  - Returns conversations ordered by most recent activity
- Add `GET /api/v1/chat/conversations` route in `createChatRoute()`:
  - Accept optional query params: `?limit=20&projectId=...`
  - Returns `{ conversations: Conversation[] }`
- Follow the existing route's injection pattern (deps include `conversationManager`)
- Add tests: lists conversations, respects limit, filters by projectId, returns empty array when none exist

**Patterns to follow:**
- `server/src/chat/manager.ts` — existing SQL patterns (`getDb()`, `.prepare()`, `.all()`)
- `server/src/api/routes/chat.ts` — route factory pattern, Zod query param validation
- `server/src/api/routes/__tests__/chat.test.ts` — test setup with `ConversationManager` mock/instance

**Test scenarios:**
- Happy path: create 3 conversations, list → returns all 3 ordered by `last_activity_at DESC`
- Happy path: `?limit=1` → returns only the most recent conversation
- Happy path: `?projectId=foo` → returns only conversations with that projectId
- Edge case: no conversations exist → returns `{ conversations: [] }`
- Integration: conversations created via `getOrCreate()` appear in `listRecent()`

**Verification:**
- `GET /api/v1/chat/conversations` returns JSON with `{ conversations: [...] }`
- Conversations ordered by most recent activity
- Filtering by projectId works
- Tests pass; existing chat tests continue to pass

---

### U3. SSE client, event streaming, and rendering

**Goal:** POST to the chat endpoint, consume the SSE stream, parse events, and render each event type in pi's terminal with appropriate formatting.

**Requirements:** R5, R6, R7

**Dependencies:** U1 (needs parsed args and command structure)

**Assumption — server plan execution:** The plan confirmation flow assumes the server will handle `confirm: true` by executing the previously proposed plan (dispatching agent tasks) rather than re-emitting `plan_proposal`. If the current server implementation always re-decomposes on `confirm: true` (emitting a new `plan_proposal`), a server-side change is needed: when `confirm: true`, the chat route should call `decomposer.execute()` or an equivalent that dispatches agent tasks and emits `tool_call`/`message` events instead of another `plan_proposal`. The extension will treat any `plan_proposal` that arrives in response to a `confirm: true` POST as a "plan execution" event (rendering "Plan accepted — executing..." without re-confirming) until the server gains an execution path.

**Files:**
- Modify: `~/.pi/agent/extensions/pragents/index.ts`

**Approach:**
- Build the request URL from `PRAGENTS_URL` env var or default `http://localhost:3000`
- POST to `/api/v1/chat` with JSON body: `{ message, conversationId?, projectId?, confirm? }`
- Read the response stream with `response.body.getReader()` and `TextDecoder`
- SSE parsing (accumulation pattern — events can span chunk boundaries):
  - Maintain a `buffer` string that accumulates partial chunks across iterations
  - Append each decoded chunk to buffer, split on `\n\n` to extract complete event blocks
  - Retain any trailing partial block (no trailing `\n\n`) in buffer for the next chunk
  - For each complete block, extract lines starting with `data:`, parse the JSON
  - Skip lines starting with `:` (heartbeat comments)
  - Validate event has `type` field
- Before entering SSE parsing, check `response.ok` and `Content-Type: text/event-stream`; if not SSE, read as JSON and render the error
- Render each event type:
  - `thinking` → `ctx.ui.setWorkingMessage(data.message)` (shows subtle processing indicator)
  - `tool_call` → `ctx.ui.notify("→ toolName (argKey1, argKey2)", "info")` (compact — tool name + first-level arg keys)
  - `tool_result` → `ctx.ui.notify("✓ toolName: brief summary", "info")` (one-line summary)
  - `message` (subtype: `text`) → `ctx.ui.notify(data.content)`
  - `message` (subtype: `status`) → `ctx.ui.notify("[status] data.content")`
  - `message` (subtype: `error_message`) → `ctx.ui.notify("[error] data.content", "error")`
  - `error` → `ctx.ui.notify("Error: data.message", "error")` with `code` context
  - `done` → silent; extract `data.conversationId` and hand off to state persistence (U4)
- Plan proposal flow (subtype: `plan_proposal`):
  - When `message` with `subtype: "plan_proposal"` arrives, buffer the plan content
  - Let the SSE stream drain fully (including the `done` event that follows the plan_proposal)
  - Extract `conversationId` from `done`, close the stream, clear working indicator
  - **Then** call `ctx.ui.confirm("Execute this plan?", formattedPlanSteps)` — outside the read loop, so heartbeats and the stream lifecycle are not affected
  - On confirm → set `ctx.ui.setWorkingMessage("Submitting confirmation...")`, make a fresh POST with `confirm: true` and the same `conversationId`
  - On reject → set `ctx.ui.setWorkingMessage("Submitting rejection...")`, make a fresh POST with `confirm: false, modifications: "cancelled"`
  - **Headless fallback:** if `ctx.ui.confirm()` is unavailable (headless pi session), render a notification: "Plan proposal received. Run `/pragents --confirm` to execute or `/pragents --reject` to cancel." Add `--confirm` and `--reject` as recognized flags in U1 parsing that trigger the follow-up POST without streaming a new message.
- On connection error (fetch throws) → render "pragents server not reachable at <url>" (covers AE4)
- On non-2xx response → read JSON body, render the `error` field or status text
- On stream interruption (read error mid-stream) → render "Connection lost" and close
- Clear `ctx.ui.setWorkingMessage(null)` when streaming ends or errors

**Patterns to follow:**
- `server/src/api/routes/chat.ts` — SSE event format, heartbeat pattern, error event structure
- `server/src/api/routes/__tests__/chat.test.ts` — exact event sequences for AE1–AE3
- Pi TUI docs — `ctx.ui.notify()`, `ctx.ui.confirm()`, `ctx.ui.setWorkingMessage()`

**Test scenarios:**
- Happy path: POST with message → SSE stream with thinking → tool_call → tool_result → message → done
- Happy path: AE3 flow — thinking → message(subtype: plan_proposal) → user confirms → subsequent POST with confirm:true
- Happy path: AE3 flow — thinking → message(subtype: plan_proposal) → user rejects → subsequent POST with confirm:false
- Happy path: AE1 flow — first POST without conversationId → done has new ID
- Edge case: SSE stream includes heartbeat comments — parser skips them without error
- Edge case: `message` with subtype `status` or `error_message` — rendered with appropriate prefix
- Error path: connection refused → "pragents server not reachable at http://localhost:3000" (covers AE4)
- Error path: 400 response (non-SSE, JSON body) → render error from JSON
- Error path: SSE stream disconnects before `done` → "Connection lost", state not corrupted
- Error path: server returns `error` event with `TOOL_ERROR` code → rendered with error styling

**Verification:**
- Direct-routed queries stream and render within 3 seconds (origin success criterion)
- All SSE event types render without garbled JSON or silent failures
- Plan proposals prompt for user confirmation interactively
- Connection errors render within 5 seconds (origin success criterion for AE4)

---

### U4. Interactive TUI pickers and state persistence

**Goal:** Implement `--list` (conversation picker), `--project` (project picker), and conversationId state persistence via `appendEntry()` with recovery on restart.

**Requirements:** R2, R3, R4, R9, R10, R11

**Dependencies:** U1 (arg parsing), U2 (server conversation listing endpoint), U3 (needs conversationId from done event + POST flow)

**Files:**
- Modify: `~/.pi/agent/extensions/pragents/index.ts`

**Approach:**
- **State persistence:**
  - On `done` event, store `conversationId` via `pi.appendEntry("pragents-conversation", { conversationId, projectId, lastActivityAt: Date.now() })`
  - On `session_start`, scan `ctx.sessionManager.getBranch()` for entries where `entry.type === "custom"` and `entry.customType === "pragents-conversation"`
  - Take the most recent matching entry and restore `conversationId` and `projectId` from `entry.data`
  - Store in a local `state` object for the session duration
  - On successful recovery, render a brief notification: `ctx.ui.notify("Resumed conversation abc123...", "info")` so the user knows which conversation is active
  - On `--new`: omit `conversationId` from POST; after `done`, call `appendEntry()` with the new ID (replaces the old one logically)
  - On `--resume <id>`: set `state.conversationId = id` before POST
  - On `--resume` to a non-existent conversation: server creates new conversation (graceful degradation); accept the new ID from `done`
- **Project picker (`--project` with no value):**
  - `fetch("GET /api/v1/projects")` against the pragents server (response is a flat array: `[{id, name, directory}]`, not wrapped in an object)
  - Call `ctx.ui.select("Select a project:", projectChoices)` where each choice is `{ value: project.id, label: `${project.name} (${project.id})` }`
  - On selection, persist `state.projectId` for subsequent `/pragents` commands (stored via `appendEntry()` alongside conversationId). Exit — the user issues a separate `/pragents <message>` to chat with the selected project.
  - On escape/cancel, abort the command with a message; no state change
- **Conversation picker (`--list`):**
  - `fetch("GET /api/v1/chat/conversations")` against the pragents server
  - Call `ctx.ui.select("Select a conversation:", conversationChoices)` where each choice shows conversation ID prefix, project, and last activity time
  - On selection, set `state.conversationId` for subsequent chat commands (persist via `appendEntry()`). Exit — the user issues a separate `/pragents <message>` to continue the selected conversation.
  - On escape/cancel, keep current conversationId; no state change
- **Picker error handling:**
  - If the server is unreachable during picker data fetch, render "Cannot reach pragents server to list projects/conversations"
  - If the list is empty, render "No conversations found" / "No projects configured"
  - If `ctx.ui.select()` is unavailable (headless pi session), render an error: "`--list` requires an interactive pi session; use `--resume <id>` to resume a known conversation" / "`--project` requires an interactive pi session; use `--project <id>` with an explicit project ID"

**Patterns to follow:**
- `~/.pi/agent/extensions/muninn-memory/index.ts` — in-memory state object pattern
- Pi extensions docs — `ctx.ui.select()` API, `ctx.sessionManager.getBranch()` pattern
- `server/src/api/routes/projects.ts` — `GET /api/v1/projects` response shape

**Test scenarios:**
- Happy path: first use → no stored conversationId → POST without it → done event → appendEntry called with new ID
- Happy path: restart pi → session_start → scan getBranch() → recover conversationId → next /pragents reuses it
- Happy path: `/pragents --new message` → omits stored conversationId → done with new ID → appendEntry with new ID
- Covers AE2: --new with existing stored ID, previous conversation left behind
- Happy path: `/pragents --resume abc123 what next` → sets conversationId to "abc123" → POST includes it
- Happy path: `/pragents --project` → fetch projects → ctx.ui.select() → user picks → projectId persisted, exits (user issues separate `/pragents <message>`)
- Happy path: `/pragents --list` → fetch conversations → ctx.ui.select() → user picks → conversationId updated, exits (user issues separate `/pragents <message>`)
- Edge case: `--list` when server returns empty list → "No conversations found"
- Edge case: `--project` when server returns empty list → "No projects configured"
- Edge case: `--list` in headless session → "`--list` requires an interactive pi session; use `--resume <id>`"
- Edge case: bare `--project` in headless session → "`--project` requires an interactive pi session; use `--project <id>` with an explicit project ID"
- Error path: `--list` when server unreachable → "Cannot reach pragents server..."
- Error path: `--resume nonexistent-id` → POST includes it, server creates new conversation, new ID accepted

**Verification:**
- Multi-turn conversations survive pi restarts (origin success criterion)
- `--new` starts fresh without ambiguity
- `--list` shows recent conversations from the server and allows selection
- `--project` shows configured projects and allows selection
- `--resume <id>` correctly reuses a specific conversation

---

### U5. Robustness and cleanup

**Goal:** Guard against concurrent requests, handle heartbeat timeouts, clean up resources, and ensure the extension degrades gracefully in all error conditions.

**Requirements:** R8, R5 (PRAGENTS_URL env var)

**Dependencies:** U3 (SSE streaming lifecycle)

**Files:**
- Modify: `~/.pi/agent/extensions/pragents/index.ts`

**Approach:**
- **Concurrency guard:**
  - Maintain a `state.busy` boolean in the local state object
  - Set `true` at command handler entry, `false` in a `finally` block
  - If `true` on entry, render "Already processing a pragents request" and return
- **Heartbeat timeout:**
  - Server sends `: heartbeat\n\n` every 15s
  - Track time of last received data or heartbeat
  - Use `setInterval` (or a timeout that resets on each chunk) — if 30s elapses with no data, abort the fetch controller and render "Connection lost — no response from pragents for 30s"
  - Clear the interval on stream completion or error
- **Stream cleanup:**
  - Use an `AbortController` for the fetch; call `controller.abort()` on timeout, user interrupt, or `session_shutdown`
  - In `finally`, clear working message indicator: `ctx.ui.setWorkingMessage(null)`
  - Unset `state.busy`
- **PRAGENTS_URL env var:**
  - Read `process.env.PRAGENTS_URL` at extension load time
  - Default to `http://localhost:3000`
  - Use as base URL for all pragents API calls
  - Validate on first use — if the URL is malformed, catch and render error
- **Session shutdown:**
  - Subscribe to `pi.on("session_shutdown", ...)` — abort any active stream, clean up intervals
- **Non-SSE response guard:**
  - Before entering SSE parsing, check `response.status` and `Content-Type`
  - If `!response.ok` or content-type is not `text/event-stream`, read the body as text/JSON and render the error

**Patterns to follow:**
- `~/.pi/agent/extensions/huginn/index.ts` — `pi.on("session_shutdown", ...)` cleanup pattern
- `server/src/api/routes/chat.ts` — heartbeat interval pattern (15s)
- `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md` — unbounded listener warning, timeout rejection pattern

**Test scenarios:**
- Happy path: AE5 — PRAGENTS_URL=http://192.168.1.50:3000 → POST to correct URL
- Edge case: two rapid `/pragents` invocations → second renders "Already processing"
- Error path: heartbeat stops for 30s → "Connection lost" rendered, stream closed, busy flag released
- Error path: `PRAGENTS_URL=not-a-url` → error on first use (malformed URL)
- Error path: server returns 500 with JSON body → error rendered from JSON, not SSE parser
- Error path: fetch throws (network error) → "pragents server not reachable" rendered within 5s (covers AE4)
- Cleanup: `session_shutdown` during active stream → stream aborted, intervals cleared
- Cleanup: stream completes normally → working message cleared, busy flag released

**Verification:**
- Server-down error renders within 5 seconds, not a hang (origin success criterion)
- Concurrent invocations are blocked cleanly
- No resource leaks (intervals, listeners) across multiple command invocations
- Extension does not crash pi on any error path

---

## System-Wide Impact

- **Interaction graph:** The extension touches only the pragents server's `/api/v1/chat` and `/api/v1/chat/conversations` endpoints (and `/api/v1/projects` for the picker). No other pragents endpoints are affected.
- **Error propagation:** Extension errors are contained within pi's extension sandbox — they render as notifications, never crash pi or the pragents server.
- **State lifecycle risks:** The `conversationId` stored via `appendEntry()` is a single ID. If the user runs multiple pi sessions against different pragents instances, the ID from the last session wins. This is acceptable for the local-first model.
- **API surface parity:** The server's new `GET /api/v1/chat/conversations` endpoint follows existing REST conventions (wrapped response objects, Zod validation, factory pattern).
- **Integration coverage:** The full chat flow (POST → SSE stream → done event → state persist) must be tested end-to-end. Unit tests cover individual units; a manual integration test with a running pragents server validates the complete chain.
- **Unchanged invariants:** The chat protocol (`POST /api/v1/chat`) is unchanged — the extension is a consumer. The `ConversationManager` API is extended with a read-only `listRecent()` method that does not modify existing behavior.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `pi.appendEntry()` produces entries that aren't recoverable across all pi versions | Verified against pi docs v0.73+ — `CustomMessage` entries are recoverable via `sessionManager.getBranch()`. The muninn-memory extension's "not directly readable" comment refers to an older SDK version. |
| SSE stream interruption leaves server with orphaned conversation | Server conversations expire after 24h TTL. The extension does not touch the stored conversationId on stream interruption (only on `done`). |
| `ctx.ui.select()` may not be available in headless pi sessions | Document that interactive pickers (`--list`, `--project` bare) require an interactive pi session. CLI flags (`--project <id>`, `--resume <id>`) work everywhere. |
| Server conversation listing endpoint adds DB query load | `listRecent()` is a simple indexed query returning at most 20 rows. Called only on explicit `--list` invocation, not on every chat. |
| Global conversation scope with `--project` override can mix project contexts | When the user switches `--project` mid-conversation, the server keeps the same conversationId with the original `project_id` — messages about the new project appear in a conversation listed under the old project. Acceptable for the local-first, single-user model. If it becomes confusing, a future iteration can track a per-project `conversationId` map. |

---

## Documentation / Operational Notes

- **Installation:** Copy `~/.pi/agent/extensions/pragents/index.ts` to the user's pi extensions directory. Pi auto-discovers it on restart or `/reload`.
- **Configuration:** Set `PRAGENTS_URL` env var for non-default server locations. No config file required.
- **First-run experience:** User types `/pragents help` or any message — the extension starts a fresh conversation automatically (no setup required).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-12-pi-client-adapter-requirements.md](../brainstorms/2026-05-12-pi-client-adapter-requirements.md)
- Related: [docs/brainstorms/2026-05-11-chat-protocol-requirements.md](../brainstorms/2026-05-11-chat-protocol-requirements.md)
- Related: [docs/plans/2026-05-11-002-feat-chat-protocol-plan.md](2026-05-11-002-feat-chat-protocol-plan.md)
- Server chat route: `server/src/api/routes/chat.ts`
- Server chat tests: `server/src/api/routes/__tests__/chat.test.ts`
- Conversation manager: `server/src/chat/manager.ts`
- Pi extension reference: `~/.pi/agent/extensions/huginn/index.ts`
- Pi extensions docs: `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi session format docs: `@earendil-works/pi-coding-agent/docs/session-format.md`
- Learnings: `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md`
- Learnings: `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`
