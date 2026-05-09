---
title: "feat: pragents M5 — LLM Skill Extraction"
type: feat
status: active
date: 2026-05-09
origin: docs/superpowers/specs/2026-05-06-pragents-design.md
---

# feat: pragents M5 — LLM Skill Extraction

## Summary

Replace the regex-based `SkillExtractor` with an LLM-powered pipeline that analyzes full agent session traces — tool calls, revisions, corrections — to detect reproducible patterns, generalize concrete values into parameters, distill effective prompts, and propose structured skill templates. Human approval gates extracted proposals before activation. This is the core M5 extraction engine; Memory Explorer UI, Skills UI, cross-project memory polish, and conditional workflow improvements are deferred.

---

## Problem Frame

The current `SkillExtractor` uses regex heuristics (numbered steps, bullets, section headers) and keyword-based tagging. It cannot distinguish between a first attempt and a corrected approach, cannot identify which tools the agent used, cannot generalize concrete values like `"Winterjacken"` into `{product_category}`, and cannot distill the effective prompt from iterative refinement. A regex pipeline operating on raw output text is inherently unable to produce quality skill templates. The design spec (Section 11.2) calls for an LLM pipeline: pattern detection → generalization → prompt distillation → proposal → test-run validation → human approval.

---

## Requirements

- R1. **LLM Extraction Pipeline** — Accept a session ID, load the full message trace, run an isolated LLM pass that extracts a `SkillDef` (name, description, steps with generalized prompts, detected tools, parameters with types/defaults, examples), and persist the proposal in `proposed` status.
- R2. **Session Trace Persistence** — Persist the full `session.agent.state.messages[]` array on session dispose so the extraction pipeline has access to the complete message history (tool calls, revisions, corrections).
- R3. **Schema Extension** — Extend `SkillDef` with the fields the extraction pipeline produces: `parameters`, `tools`, `examples`, `scope`, `status`, `version`, and `extraction_metadata`.
- R4. **Human Approval Gate** — Extracted skills require human review before activation. Follow the existing human-gates pattern: proposals appear in the task feed, can be approved or rejected with feedback.
- R5. **API Ergonomics** — `POST /api/v1/skills/extract` accepts `{ sessionId }` instead of raw output text. Existing `GET/POST/DELETE` endpoints continue to work. New endpoints for approval lifecycle: `POST /api/v1/skills/:name/approve`, `POST /api/v1/skills/:name/reject`.

---

## Scope Boundaries

- **In scope:** LLM extraction pipeline, session trace persistence, SkillDef schema extension, human approval flow via existing feed/gates pattern, API updates.
- **Deferred to Follow-Up Work:**
  - Test-run validation (run extracted skill in isolated session against test input before approval) — separate PR
  - Version history and rollback — separate PR
  - Skills Web UI (list, detail, edit) — separate PR; approval uses existing FeedView
  - Memory Explorer UI, cross-project memory UI polish, conditional workflow improvements — M5 remainder

---

## Context & Research

### Relevant Code and Patterns

- `server/src/nl/decomposer.ts` — NLDecomposer: one-shot isolated pi SDK session, system prompt, JSON response parsing, immediate dispose. **Primary pattern to follow.**
- `server/src/agents/manager.ts` — AgentSessionManager.dispatch(): already reads `handle.session.agent?.state?.messages[]` to extract the last assistant message after `agent_end`. **Extend to persist all messages before dispose.**
- `server/src/skills/extractor.ts` — Current regex-based SkillExtractor (220 lines). **Complete rewrite.**
- `server/src/skills/registry.ts` — SkillRegistry: in-memory Map + YAML file + SQLite. `save()`, `delete()`, `get()`, `list()`, `findByTags()`. **Solid, extend for new fields.**
- `server/src/skills/schema.ts` — SkillDef Zod schema. **Extend with new fields.**
- `server/src/api/routes/skills.ts` — Hono route factory. `createSkillsRoute(registry, extractor)`. **Add dependencies, new endpoints.**
- `server/src/api/routes/gates.ts` — Human gates route factory. `POST /gates/:id/approve`, `POST /gates/:id/reject`. **Pattern to mirror for skill approval.**
- `server/src/db/sqlite.ts` — getDb() singleton. Migrations in `server/src/db/migrations/` (001–008). **Next: 009.**
- `web/src/routes/feed/index.tsx` — FeedView with GateCard component (Approve/Reject buttons, status badges, expandable detail). **Template for skill approval cards.**

### Institutional Learnings

- `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md` — Five-layer inbox pattern for agent-to-human signaling. Directly applicable to M5's approval stage: pending proposals appear alongside human gates in the feed, grouped by intent, with inline approve/reject. The extraction agent should check what's already pending before proposing a duplicate.

### External References

- None. The NLDecomposer pattern is sufficient as a local reference.

---

## Key Technical Decisions

- **Decision: `session_messages` table (not a column on `sessions`)**: A separate table avoids bloat on the frequently-queried `sessions` table, allows independent cleanup TTL (e.g., delete messages after 30 days while keeping session metadata), and supports future normalization (messages, tool_calls, tool_results). The `messages_json TEXT` column stores the full JSON array. Migration 009.

- **Decision: LLM extraction via isolated one-shot session (NLDecomposer pattern)**: Follow the existing pattern: create a temporary pi SDK session, set a system prompt describing the extraction task, feed the message trace as the user message, parse the JSON response, dispose. Reuses the proven infrastructure without introducing new SDK integration patterns.

- **Decision: Extraction happens on explicit API call, not auto-triggered**: The user (or PM agent) decides which sessions are worth extracting. Auto-extraction on every session completion would produce noise and waste tokens. The API endpoint `POST /skills/extract` with `{ sessionId }` is the single trigger point.

- **Decision: Skill approval reuses the human-gates pattern**: Extracted proposals get `status: 'proposed'` and appear in the existing FeedView as approval cards alongside human gates. No new UI routes needed for M5 v1 — the FeedView is the review surface. `POST /skills/:name/approve` and `POST /skills/:name/reject` mirror the gates API.

---

## Open Questions

### Resolved During Planning

- **Session trace access mechanism**: New `session_messages` table. Resolved via specialist team analysis — systems-architect recommended this approach for separation of concerns, migration safety, and cleanup flexibility.

### Deferred to Implementation

- **Extraction prompt design**: The exact system prompt for the LLM extraction session will be refined during implementation. The prompt must instruct the LLM to identify patterns, generalize values, detect tool usage, and output structured JSON matching the SkillProposal schema. Iterative prompt tuning is expected.
- **Message size limits**: If a session has 1000+ messages, the JSON blob may exceed reasonable LLM context windows. The extractor should truncate intelligently (keep first N and last M messages, summarize the middle). Exact truncation strategy deferred to implementation.
- **Extraction model selection**: Which model to use for extraction (cheapest capable model? configurable?). NLDecomposer uses Haiku. Same strategy applies here initially.
- **Draft proposal cleanup**: How long do draft/rejected proposals live before cleanup? Default: keep indefinitely until explicitly deleted. TTL deferred.

---

## Implementation Units

### U1. Session Trace Persistence

**Goal:** Persist full message history on session dispose so the extraction pipeline can load it later.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Create: `server/src/db/migrations/009_session_messages.sql`
- Modify: `server/src/agents/manager.ts`
- Test: `server/src/agents/__tests__/manager.test.ts`

**Approach:**
- Add migration 009: `CREATE TABLE session_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, messages_json TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))` with indexes on `session_id` and `created_at`.
- In `AgentSessionManager.disposeIdle()` and `disposeAll()`, before calling `handle.session.dispose()`, read `handle.session.agent?.state?.messages[]`, serialize to JSON, and INSERT into `session_messages`.
- Add a lightweight `getSessionMessages(sessionId: string): Message[]` method on `AgentSessionManager` (or a standalone query helper) for the extractor to call.
- Add a cleanup interval (every 6h, delete messages older than 30 days) in the server startup (`server/src/index.ts`).

**Patterns to follow:**
- Migration pattern from `001_initial.sql` through `008_task_feed.sql` — no-frills CREATE TABLE + CREATE INDEX.
- Session dispose pattern in `manager.ts` lines 271–290 — message persistence inserts between the idle check and `handle.session.dispose()`.

**Test scenarios:**
- Happy path: Dispatch a task, verify `session_messages` row is created on dispose with correct `session_id`, `message_count > 0`, and valid `messages_json`.
- Edge case: Session with zero messages (error before first prompt) — no row inserted, no crash.
- Edge case: Session dispose called twice (redundant dispose) — no duplicate rows, no crash.
- Integration: After dispose, `getSessionMessages(sessionId)` returns the same messages that were in `session.agent.state.messages[]` before dispose.

**Verification:**
- After `disposeIdle()` runs, the `session_messages` table contains a row for the disposed session with valid JSON.
- After `disposeAll()`, all disposed sessions have corresponding `session_messages` rows.

---

### U2. SkillDef Schema Extension

**Goal:** Extend the SkillDef Zod schema and SQLite skills table to support fields produced by the LLM extraction pipeline.

**Requirements:** R3

**Dependencies:** U1

**Files:**
- Modify: `server/src/skills/schema.ts`
- Modify: `server/src/skills/registry.ts`
- Create: `server/src/db/migrations/010_skill_extraction_fields.sql`
- Test: `server/src/skills/__tests__/registry.test.ts`

**Approach:**
- Add to `SkillDef`: `parameters` (optional array of `{ name, description, type, default }`), `tools` (optional string array of tool names used), `examples` (optional array of `{ input, expected_output }`), `scope` (optional `'company' | 'project' | 'agent'`), `status` (optional `'draft' | 'proposed' | 'approved' | 'active' | 'rejected'`), `version` (optional positive integer), `extraction_metadata` (optional `{ source_session_id, source_agent_id, extracted_at, model_used, confidence }`).
- Add migration 010: ALTER TABLE skills ADD COLUMN for new fields (parameters_yaml TEXT, tools TEXT, examples_yaml TEXT, scope TEXT DEFAULT 'project', status TEXT DEFAULT 'draft', version INTEGER DEFAULT 1, extraction_metadata_yaml TEXT).
- Update `SkillRegistry.save()` to serialize/deserialize new fields to YAML/JSON for both YAML file persistence and SQLite storage.
- Update `SkillRegistry.list()` to include new fields in the returned objects.
- `SkillDef` remains the canonical type; all new fields are optional for backward compatibility with existing manually-created skills.

**Patterns to follow:**
- Zod schema pattern from `skills/schema.ts` — `z.object()` + `z.infer<>` dual export.
- Migration pattern — ALTER TABLE with sensible defaults.
- Registry YAML+SQLite dual-persistence from `skills/registry.ts`.

**Test scenarios:**
- Happy path: Save a skill with all new fields populated, reload registry, verify all fields round-trip correctly.
- Happy path: Existing skill without new fields loads correctly (backward compatibility — all new fields optional).
- Edge case: `status` field — save with `'proposed'`, reload, status is `'proposed'`. Save without status, reload, status is `'draft'` (default).
- Edge case: Empty `parameters` array, empty `tools` array, null `extraction_metadata` — all handled without errors.
- Error path: Invalid scope value (`'invalid'`) — Zod validation rejects.

**Verification:**
- Skill with all extended fields persists to both YAML file and SQLite, and reloads faithfully.
- Existing skill YAML files in `skills/` directory load without errors or data loss.

---

### U3. LLM-Powered Skill Extractor

**Goal:** Replace the regex-based SkillExtractor with an LLM-powered pipeline that analyzes session traces and produces structured SkillProposals.

**Requirements:** R1, R2

**Dependencies:** U1, U2

**Files:**
- Rewrite: `server/src/skills/extractor.ts`
- Test: `server/src/skills/__tests__/extractor.test.ts`

**Approach:**
- New `SkillExtractor` class takes `AgentSessionManager` (for accessing persisted messages) and agent config (for model selection) as constructor dependencies.
- `extract(sessionId: string): Promise<SkillProposal>` method:
  1. Load messages from `session_messages` table via `sessionManager.getSessionMessages(sessionId)`.
  2. Handle large traces: if message count > 200, keep first 50 and last 50, summarize middle with a placeholder.
  3. Create an isolated pi SDK session (NLDecomposer pattern): temp dir, `DefaultResourceLoader` with all features disabled, `systemPromptOverride` set to the extraction prompt.
  4. The system prompt instructs the LLM to analyze the trace and output a JSON `SkillProposal` with: name, description, steps (each with prompt, agent hint, output), detected tools, parameters (with name, type, description, default), examples, tags, scope recommendation, confidence score.
  5. Parse the JSON response, validate against a `SkillProposal` Zod schema.
  6. Return the proposal. The caller (API route) persists it via `SkillRegistry`.
- The old regex methods (`detectPatterns`, `detectAgentHint`, `inferTags`, `generateSkillName`, `generateDescription`, `isActionable`) are removed.
- Extract the cheapest capable model from agent config (Haiku if present, else first agent's model) — same as NLDecomposer.

**Patterns to follow:**
- NLDecomposer pattern (`server/src/nl/decomposer.ts`): temp dir creation, resource loader setup, `createAgentSession`, `session.prompt()`, subscribe to `agent_end`, read messages, parse JSON, dispose.
- `AgentSessionManager.dispatch()`: tool call handling pattern (subscribe to `custom_tool_call`, execute, send result).

**Test scenarios:**
- Happy path: Provide a session trace with clear patterns (numbered research → draft → review steps), verify the extracted proposal has 3+ steps, detected tools, and meaningful parameters.
- Happy path: Session trace with tool calls — verify `tools` field lists the tools that were actually called.
- Edge case: Empty message trace — extractor returns null or throws descriptive error, does not crash.
- Edge case: Very short trace (2 messages, no patterns) — extractor returns a proposal with low confidence score, or gracefully reports "no extractable patterns found".
- Edge case: Trace with corrections (agent makes error, fixes it) — extraction captures the corrected approach, not the error path.
- Error path: Invalid session ID (no messages found) — throws `Error('No messages found for session <id>')`.
- Error path: LLM returns malformed JSON — extractor retries once with a correction prompt, then throws if still invalid.

**Verification:**
- An extraction from a real agent session trace produces a `SkillProposal` with non-empty `steps`, reasonable `parameters`, detected `tools`, and a `confidence` score between 0 and 1.
- The SkillProposal passes Zod validation and is persistable via `SkillRegistry.save()`.

---

### U4. Skill Extraction API Update

**Goal:** Update the skills API route to support LLM extraction from session IDs and add approval lifecycle endpoints.

**Requirements:** R4, R5

**Dependencies:** U3

**Files:**
- Modify: `server/src/api/routes/skills.ts`
- Test: `server/src/api/routes/__tests__/skills.test.ts`

**Approach:**
- Update `createSkillsRoute()` to accept additional dependencies: `sessionManager: AgentSessionManager`.
- Change `POST /skills/extract`: accept `{ sessionId: string }` instead of `{ output, agentId, sessionId }`. The route handler calls `extractor.extract(sessionId)`, then persists the proposal via `registry.save()` with `status: 'proposed'`. Returns `{ extracted: 1, skill: { name, steps, tools, confidence } }`.
- Add `POST /skills/:name/approve`: sets `status: 'active'` on the skill. Mirrors `POST /gates/:id/approve` pattern.
- Add `POST /skills/:name/reject`: accepts `{ reason?: string }`, sets `status: 'rejected'`. Emits a `skill.rejected` event to the EventBuffer for feed invalidation.
- Existing endpoints (`GET /`, `GET /:name`, `POST /`, `DELETE /:name`) remain unchanged.
- Emit events on approval lifecycle: `skill.proposed`, `skill.approved`, `skill.rejected` — these flow through EventBuffer → WebSocket/SSE → FeedView invalidation.

**Patterns to follow:**
- Hono route factory pattern: `export function createSkillsRoute(...) { const r = new Hono(); ... return r; }`.
- Manual body validation (consistent with existing routes — no Zod middleware).
- Gates route approval pattern (`server/src/api/routes/gates.ts`): `POST /:id/approve`, `POST /:id/reject`.

**Test scenarios:**
- Happy path: `POST /skills/extract` with valid `sessionId` returns 200 with skill proposal, skill is persisted with `status: 'proposed'`.
- Happy path: `POST /skills/:name/approve` sets status to `'active'`, returns 200.
- Happy path: `POST /skills/:name/reject` with reason sets status to `'rejected'`, returns 200.
- Edge case: `POST /skills/extract` with invalid `sessionId` (no messages found) returns 404 with error.
- Edge case: `POST /skills/extract` with `sessionId` that has already been extracted — returns 409 with message "Skill already extracted from this session".
- Error path: `POST /skills/:name/approve` for non-existent skill returns 404.
- Error path: `POST /skills/:name/reject` for already-approved skill returns 409.

**Verification:**
- `curl -X POST /api/v1/skills/extract -d '{"sessionId":"..."}'` returns a skill proposal with steps and tools.
- `curl -X POST /api/v1/skills/my-skill/approve` changes status to `'active'` and subsequent GET reflects it.
- Extraction from a session with no messages returns a 404 error, not a 500 crash.

---

### U5. FeedView Integration for Skill Approval

**Goal:** Extracted skill proposals appear in the agent-native task feed alongside human gates for human review.

**Requirements:** R4

**Dependencies:** U4

**Files:**
- Modify: `web/src/routes/feed/index.tsx`
- Modify: `web/src/components/FeedView.tsx`

**Approach:**
- Extend the feed endpoint (`GET /api/v1/feed`) to include `pendingSkills` in the response: `[{ name, description, steps, tools, extracted_from_session, extracted_at, confidence }]`.
- In the feed grouping, add a "Pending Skill Approval" section above or alongside "Pending Gates".
- Render each pending skill as a `SkillProposalCard` component (mirrors `GateCard`): shows skill name, description, step count, tool list, confidence badge, and Approve/Reject buttons.
- Approve/Reject buttons call `POST /api/v1/skills/:name/approve` and `POST /api/v1/skills/:name/reject` respectively.
- On approval, the card transitions to a "Skill activated" state. On rejection, the card shows the rejection reason and fades.
- The FeedView already supports TanStack Query invalidation on gate events — extend to invalidate on `skill.*` events.

**Patterns to follow:**
- GateCard component pattern: card layout, Approve/Reject buttons, status badges, optimistic updates.
- Feed grouping pattern: "Pending Gates", "Needs Review", "Blocked", "Recently Completed" → add "Pending Skill Approval".
- TanStack Query pattern: `useQuery` for feed data, `useMutation` for approve/reject with `onSuccess: () => queryClient.invalidateQueries(...)`.

**Test scenarios:**
- Happy path: After extraction, the feed shows a "Pending Skill Approval" card with correct name, description, step count, and confidence badge.
- Happy path: Click Approve → card transitions to "Skill activated" state, feed refreshes, skill no longer appears.
- Happy path: Click Reject → card shows rejection state, feed refreshes, skill no longer appears.
- Edge case: Multiple pending skills — all appear in the group, sorted by extraction time (newest first).
- Edge case: No pending skills — the "Pending Skill Approval" group does not render (no empty group header).

**Verification:**
- A freshly extracted skill proposal appears in the feed view within the "Pending Skill Approval" group.
- Approving via the feed card changes the skill status to `'active'` and removes it from the feed.
- The feed groups update correctly alongside existing gate cards.

---

## System-Wide Impact

- **Interaction graph:** `AgentSessionManager.disposeIdle/disposeAll` → inserts into `session_messages`. `POST /skills/extract` → reads from `session_messages` → creates isolated SDK session → writes to `skills` table + YAML files. `POST /skills/:name/approve|reject` → updates `skills.status` → emits event → FeedView invalidates.
- **Error propagation:** Extraction failures (LLM timeout, malformed JSON, empty trace) return structured errors via API. Extraction does not block session dispose — message persistence is best-effort, failures are logged but don't prevent dispose.
- **State lifecycle risks:** A skill proposal in `'proposed'` status that is never approved or rejected remains in the feed indefinitely. This is acceptable for M5 — the feed groups are capped at 20 items each. Rejected proposals stay in the database (soft-delete by status) for potential later review.
- **Unchanged invariants:** Existing `SkillRegistry.save/load/delete` behavior is preserved for manually-created skills. Existing skills API endpoints are unchanged. Session lifecycle is unchanged except for the added message persistence step before dispose.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM extraction quality varies by model and trace complexity | Confidence score on every proposal; human always approves. Low-confidence proposals are flagged in the feed card. |
| Large message traces exceed LLM context window | Truncation strategy: keep first 50 and last 50 messages, summarize the middle. Configurable limits. |
| `session_messages` table grows unbounded | 30-day TTL cleanup interval. CASCADE delete when sessions are cleaned up. |
| Extraction adds latency (LLM call) to what was a synchronous regex operation | Extraction is an explicit API call, not auto-triggered. The user initiates it and expects a wait. No latency regression for the critical path (task dispatch). |

---

## Sources & References

- **Origin document:** [docs/superpowers/specs/2026-05-06-pragents-design.md](../../superpowers/specs/2026-05-06-pragents-design.md) — Section 11.2 (Skill Extraction), Section 11.5 (Skill API)
- Related code: `server/src/skills/extractor.ts`, `server/src/skills/registry.ts`, `server/src/skills/schema.ts`, `server/src/agents/manager.ts`, `server/src/nl/decomposer.ts`, `server/src/api/routes/skills.ts`, `server/src/api/routes/gates.ts`, `web/src/routes/feed/index.tsx`, `web/src/components/FeedView.tsx`
- Related learning: `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`
