---
date: 2026-05-12
topic: pi-client-adapter
---

# pi Client Adapter — Terminal Chat Extension

## Summary

A pi extension (`/pragents <message>`) that forwards chat messages to the pragents server's SSE chat API, streams response events back into pi's terminal UI, and persists conversation state across sessions. Enables the agency owner to chat with the pragents orchestrator directly from their pi terminal without context-switching.

## Problem Frame

The pragents server already exposes a chat protocol (`POST /api/v1/chat` + SSE) with conversation management, multi-turn, and tool result streaming. But the agency owner — whose daily workflow lives inside pi — has no way to reach it. Switching to the Web Dashboard for observation or using ad-hoc `curl` for chat creates friction that kills the conversational flow. The chat protocol requirements doc (R11) anticipated pi/Claude-Code/Hermes adapters, but none exist yet. pi is the primary client, so it should be the first adapter.

## Key Flows

- **F1. One-shot command**
  - **Trigger:** User types `/pragents Check failed tasks`
  - **Steps:**
    1. Extension parses command, extracts message
    2. Extension POSTs to `/api/v1/chat` with message (no `conversationId`)
    3. Extension streams SSE events back to pi terminal
    4. `done` event arrives with new `conversationId`; extension stores it for continuation
  - **Outcome:** User sees task list in pi terminal; conversation is resumable
  - **Covered by:** R1, R2, R3

- **F2. Multi-turn continuation**
  - **Trigger:** User types `/pragents And what about the SEO agent?` (no `--new`)
  - **Steps:**
    1. Extension loads stored `conversationId` from session state
    2. Extension POSTs with `conversationId` included
    3. pragents server retrieves conversation history, resolves the reference
    4. Extension streams response events back
  - **Outcome:** User gets contextual follow-up without restating context
  - **Covered by:** R2, R3

- **F3. Start fresh conversation**
  - **Trigger:** User types `/pragents --new Deploy to staging`
  - **Steps:**
    1. Extension sees `--new` flag, omits stored `conversationId`
    2. Extension POSTs without `conversationId`
    3. New conversation created on server
    4. `done` event arrives with new `conversationId`; extension replaces stored one
  - **Outcome:** Fresh conversation started, previous one abandoned (still exists on server until TTL)
  - **Covered by:** R3, R4

- **F4. Server unreachable**
  - **Trigger:** pragents server is not running or network error
  - **Steps:**
    1. Extension attempts POST, gets connection error
    2. Extension renders clear error message in pi terminal
    3. Extension does not modify stored `conversationId`
  - **Outcome:** User knows to start the pragents server; no state corruption
  - **Covered by:** R7

## Requirements

**Command registration**
- R1. The extension registers a `/pragents` command in pi. Arguments after the command are treated as the chat message. The command is available in both interactive and headless pi sessions.

**Conversation state**
- R2. The extension persists the most recent `conversationId` using `pi.appendEntry()`. When `/pragents <message>` is called without `--new`, the stored `conversationId` is sent with the request.
- R3. When `--new` is passed as the first argument (`/pragents --new <message>`), the extension starts a fresh conversation: no `conversationId` is sent, and the stored ID is replaced with the new one from the `done` event.
- R4. If no stored `conversationId` exists (first use, or state cleared), the behavior matches `--new` — a fresh conversation is started.

**API communication**
- R5. The extension POSTs to `http://localhost:3000/api/v1/chat` (or URL from `PRAGENTS_URL` env var) with JSON body: `{ message, conversationId?, projectId? }`. `projectId` is omitted initially; future iterations may support `--project <id>`.
- R6. The extension consumes the SSE response stream, parsing `data:` lines as JSON events.

**Event rendering**
- R7. The extension renders each SSE event type appropriately in pi's terminal:
  - `thinking` — subtle indicator (e.g., dimmed text or spinner) showing the orchestrator is processing
  - `message` — standard text output, the primary user-facing response
  - `tool_call` — compact representation (e.g., `→ query_tasks`) indicating a tool was invoked
  - `tool_result` — optional summary (e.g., `✓ 3 tasks found`); full result is in the `message` that follows
  - `error` — clearly marked error output
  - `done` — silent; used only to extract `conversationId` for persistence
- R8. If the HTTP request fails (connection refused, timeout, non-2xx status), the extension renders a concise error message and does not update stored state.

**Configuration**
- R9. The pragents server base URL defaults to `http://localhost:3000` and is overridable via the `PRAGENTS_URL` environment variable. No additional configuration file is required.

## Acceptance Examples

- **AE1. Covers R1, R2, R3, R6, R7.** Given the user has never used `/pragents` before, when they type `/pragents Show active agents`, then the extension POSTs without `conversationId`, streams SSE events, renders a `message` with the agent list, and stores the returned `conversationId`. A subsequent `/pragents And their last tasks?` reuses that `conversationId`.

- **AE2. Covers R3, R4.** Given a stored `conversationId` exists from a previous chat, when the user types `/pragents --new Start a blog workflow`, then the extension POSTs without `conversationId`, and the previous conversation is left behind (still resumable on server until TTL).

- **AE3. Covers R7.** Given a complex NL request triggers NL Decomposition, when the SSE stream delivers a `thinking` event followed by a `message` with a plan preview and confirmation question, then the user sees both: a brief processing indicator during `thinking`, then the plan text in standard output.

- **AE4. Covers R8.** Given the pragents server is not running, when the user types `/pragents Any message`, then the extension renders an error like "pragents server not reachable at http://localhost:3000" within 5 seconds and leaves stored `conversationId` unchanged.

- **AE5. Covers R9.** Given `PRAGENTS_URL=http://192.168.1.50:3000` is set in the environment, when the user types `/pragents Status`, then the extension POSTs to `http://192.168.1.50:3000/api/v1/chat` instead of localhost.

## Success Criteria

- `/pragents <message>` from inside pi reaches the pragents server and shows a response in under 3 seconds for simple direct-routed queries
- Multi-turn conversations survive pi restarts (state persisted via `pi.appendEntry()`)
- A user can start a fresh conversation with `--new` without ambiguity
- The extension renders all SSE event types without garbled JSON or silent failures
- When the server is down, the user gets a clear error within 5 seconds, not a hang
- The extension is installable by copying/linking a single file to `~/.pi/agent/extensions/`

## Scope Boundaries

- Telegram/Claude Code/Hermes adapters — separate future client adapters following the same protocol
- Web Dashboard chat widget — web UI remains observation-only
- WebSocket chat transport — SSE is the established protocol
- `--project` flag for specifying `projectId` — can be added later without structural change
- Auth, multi-user, or remote deployment — local-first, same assumption as rest of pragents
- Conversation history browsing or management in pi — only active chat is supported
- Attachment support in initial version — can be added when pragents server supports it

## Key Decisions

- **Extension over skill:** A TypeScript extension was chosen over a markdown skill for native SSE streaming, sub-100ms latency, reliable state persistence via `pi.appendEntry()`, and rich terminal rendering. The tradeoff is pi-only compatibility, which aligns with pragents being a pi sidecar.
- **Explicit `--new` over auto-reset:** The user must intentionally start a fresh conversation. This prevents accidental context loss and matches the explicit-control pattern of pi's own command syntax.
- **Environment variable over config file:** `PRAGENTS_URL` is sufficient for a local-first tool with one tunable. A config file adds carrying cost with no meaningful benefit.
- **Silent `done` event:** The `done` event is used only for state management, not rendered. This keeps the terminal output clean — the user already saw the substantive `message` events.

## Dependencies / Assumptions

- pi's extension API supports `pi.registerCommand()`, `pi.appendEntry()`, and HTTP fetch in the extension runtime
- The pragents server chat API (`POST /api/v1/chat`) and SSE event format are stable and match the chat protocol requirements doc (R1–R12)
- `pi.appendEntry()` persists state across pi sessions and survives restarts
- The extension runtime has access to standard `fetch` or a pi-provided HTTP client

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Exact rendering style for each SSE event type in pi's terminal — should `thinking` use `ctx.ui.notify()` or inline dimmed text? Should `tool_call` show full args or just tool name?
- [Affects R2][Technical] Should `conversationId` be scoped per pi working directory (different projects = different conversations) or global to the pi session? The pragents server supports `projectId`; if pi's `cwd` maps to a pragents project, auto-injecting `projectId` would be valuable.
- [Affects R5][Technical] Should `--project <id>` be included in the initial version, or deferred to a follow-up? The pragents API supports it; the extension just needs to pass it through.
