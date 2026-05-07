---
title: "M6: Agent-Native Tooling — Agents as First-Class Platform Users"
type: feat
status: completed
date: 2026-05-07
---

# M6: Agent-Native Tooling — Agents as First-Class Platform Users

## Summary

Give agents running inside pragents programmatic access to the platform via the pi SDK's built-in `customTools` system. 10 tools wrap existing service classes (TaskTracker, WorkflowEngine, MemoryEngine, SkillRegistry, CostTracker) into callable tool definitions with TypeBox parameter schemas. Agents discover tools via system prompt injection and invoke them through the session event loop. No MCP server needed — the pi SDK provides native tool infrastructure.

---

## Problem Frame

pragents currently orchestrates agents but treats them as black-box text-in/text-out workers. All 31 API routes are consumed exclusively by the React Web UI. Agents cannot query their own tasks, trigger workflows, approve gates, or search memory programmatically. The PM agent's escalation dispatch is performative text — it can warn about a missed deadline but cannot inspect the workflow run or take action. This is the fundamental architectural gap at the heart of an agent orchestration platform.

---

## Requirements

- R1. Agents can query and create tasks via tool calls during a session
- R2. Agents can trigger workflows, inspect workflow runs, and approve/reject human gates
- R3. Agents can search and persist memory facts with scope awareness
- R4. Agents can list available skills, workflows, and peer agents
- R5. Tool availability is injected into the system prompt so agents know what they can do
- R6. Tool execution reuses existing service classes (TaskTracker, WorkflowEngine, MemoryEngine, SkillRegistry, CostTracker) — no duplicate logic

---

## Scope Boundaries

- Auth is deferred — all tools are callable by any agent in any project. Scoping to project boundaries is handled by existing projectId parameters in service classes.
- Only 10 high-impact tools in M6. Remaining 21 API routes (agent status, trace history, goal management, etc.) deferred to M7.
- No MCP server — pi SDK `customTools` is the integration surface. This is a design constraint, not a scope limitation.
- Tool output is text-only. No structured response streaming or async tool callbacks in M6.

### Deferred to Follow-Up Work

- M7: Remaining 21 tools (agent status, goal CRUD, trace history, NL decompose, skill CRUD, events)
- Auth system for tool access scoping (per-agent, per-project)
- Tool call logging and cost attribution
- Agent-to-agent messaging via tool calls

---

## Context & Research

### Relevant Code and Patterns

- `server/src/agents/manager.ts` — `create()` session creation, `dispatch()` prompt flow, `subscribe()` event loop. System prompt injection via `systemPromptOverride` callback.
- `server/src/api/routes/*.ts` — Each route module is a thin Hono wrapper around a service class. The service classes are the integration point for tools.
- `server/src/tasks/tracker.ts` — TaskTracker with `create()`, `list()`, `get()`, `setComplete()`, `setFailed()`. Tool: `create_task`, `query_tasks`.
- `server/src/workflows/engine.ts` — WorkflowEngine with `execute()`. Tool: `run_workflow`, `list_workflows`.
- `server/src/memory/engine.ts` — MemoryEngine with `recall()`, `remember()`, `searchGlobal()`. Tool: `search_memory`, `remember_fact`.
- `server/src/skills/registry.ts` — SkillRegistry with `list()`, `get()`. Tool: `list_skills`.
- `server/src/tracking/cost-tracker.ts` — CostTracker with `getProjectCost()`. Tool: `get_cost_summary`.
- `server/src/api/routes/gates.ts` — Gate approval via SQLite. Tool: `approve_gate`, `reject_gate`.

### Institutional Learnings

- `docs/solutions/best-practices/systematic-code-review-fix-sweep-2026-05-07.md` — Prior review found that service classes are well-factored and can be called directly without going through HTTP. This confirms the architecture is ready for tool integration.
- `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md` — The agent-native gap was the #1 finding: 0/31 capabilities agent-accessible. This plan closes the 10 highest-priority ones.

### External References

- pi SDK `createAgentSession` options — `customTools: ToolDefinition[]` parameter with TypeBox schemas. Tool call events dispatched as `CustomToolCallEvent` on the session event bus.

---

## Key Technical Decisions

- **pi SDK `customTools` over MCP server.** The SDK provides native tool infrastructure with TypeBox schema validation, event dispatch, and result handling. Adding an MCP server would duplicate this infrastructure and introduce a second integration surface. Decision: use `customTools` exclusively.
- **TypeBox over Zod for tool parameter schemas.** pi SDK validates tool calls against TypeBox schemas internally. Wrapping Zod schemas would add translation complexity. Decision: define tool parameter schemas in TypeBox.
- **Tool executor as a dedicated class.** A `ToolExecutor` class receives tool call events from the session subscription, dispatches to the appropriate service method, and returns results. This keeps the session subscription clean and makes tool execution independently testable.
- **10 tools, not 31.** The highest-impact tools (task CRUD, workflow control, gate approval, memory search, skill listing, cost summary) give agents 80%+ of what they need. The remaining 21 routes are informational or administrative and can be added incrementally.
- **Inline tool handler in session subscription.** Rather than a separate event bus, the tool handler runs inside the existing `session.subscribe()` callback in `dispatch()`. This keeps the event loop simple and avoids introducing async coordination between tool execution and prompt response capture.

---

## Open Questions

### Resolved During Planning

- MCP server or pi SDK native? → pi SDK `customTools` — simpler, zero new dependencies.
- TypeBox or Zod for schemas? → TypeBox (pi SDK requirement).
- How many tools in M6? → 10 (high-impact subset of 31 API routes).

### Deferred to Implementation

- Whether TypeBox package needs to be added as a dependency or is already included by the pi SDK.
- Exact TypeBox schema shapes for each tool's parameters — derived from existing route handler input shapes during implementation.
- Whether `remember_fact` uses the existing `REMEMBER:` regex extraction or a clean tool path — implementer decides based on code inspection.

---

## Implementation Units

### U1. Tool Definitions — TypeBox Schemas and Tool Registry

**Goal:** Define the 10 tool parameter schemas in TypeBox and register them as `ToolDefinition[]`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Create: `server/src/agents/tool-definitions.ts`

**Approach:**
- Create one TypeBox schema per tool parameter set
- Each tool gets: `name`, `description` (agent-visible), `parameters` (TypeBox schema)
- Export as `const TOOL_DEFINITIONS: ToolDefinition[]`
- Descriptions should be agent-actionable: "Create a new task for an agent to execute" not "POST /api/v1/tasks"

**Patterns to follow:**
- Tool names use snake_case for agent-friendliness: `create_task`, `search_memory`, `approve_gate`
- Parameter descriptions explain what the agent should pass, not the HTTP equivalent

**Test scenarios:**
- Happy path: Import TOOL_DEFINITIONS, verify all 10 tools have name, description, and parameters
- Edge case: Verify no duplicate tool names
- Edge case: Verify each tool's parameters schema accepts valid input and rejects invalid input

**Verification:**
- `TOOL_DEFINITIONS` array contains exactly 10 tool definitions
- Each definition has a non-empty `name`, `description`, and valid TypeBox `parameters` schema
- Parameter schemas match the expected input shapes from the corresponding service class methods

---

### U2. Tool Executor — Dispatch Tool Calls to Service Classes

**Goal:** Create a `ToolExecutor` class that receives tool call events and dispatches them to the correct service method.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1

**Files:**
- Create: `server/src/agents/tool-executor.ts`
- Create: `server/src/agents/__tests__/tool-executor.test.ts`

**Approach:**
- `ToolExecutor` constructor accepts: `TaskTracker`, `WorkflowEngine`, `MemoryEngine`, `SkillRegistry`, `CostTracker`, `AgentSessionManager` (for agent list), gate DB access
- Single method `async execute(toolName: string, args: Record<string, unknown>): Promise<string>`
- Switch on tool name, call the corresponding service method, return result as JSON string
- Errors return `Error: <message>` strings so agents see failures in their output
- No side effects beyond calling service methods — the executor is a pure dispatcher

**Patterns to follow:**
- Match the existing service class method signatures — don't add indirection
- Return human-readable error messages suitable for agent consumption
- Gate approval/rejection uses raw SQLite queries (matching existing gates.ts pattern) or calls through a gate service if one exists

**Test scenarios:**
- Happy path: Execute each of the 10 tools with valid args, verify correct service method is called
- Edge case: Unknown tool name returns error message
- Edge case: Service method throws — executor catches and returns error string
- Edge case: Invalid argument types — executor returns validation error
- Integration: `create_task` → verify TaskTracker.create was called with correct params

**Verification:**
- All 10 tools dispatch to the correct service method
- Error handling covers unknown tools, invalid args, and service failures
- Tests pass: `npx vitest run`

---

### U3. Session Integration — Inject Tools and Handle Tool Calls

**Goal:** Wire `customTools` into session creation and add tool call handling to the session event subscription.

**Requirements:** R5, R6

**Dependencies:** U1, U2

**Files:**
- Modify: `server/src/agents/manager.ts`
- Modify: `server/src/index.ts`

**Approach:**
- `AgentSessionManager` constructor accepts `ToolExecutor` instance
- `create()` method passes `customTools: TOOL_DEFINITIONS` in `createAgentSession()` options
- Session subscription in `dispatch()` adds a branch: if `event.type === 'custom_tool_call'`, call `this.toolExecutor.execute(event.name, event.args)` and send the result back via the session's tool result API
- System prompt override in `create()` appends tool availability context after the existing personality injection

**Patterns to follow:**
- Tool call handling is non-blocking within the prompt flow — the agent waits for tool results before continuing
- System prompt includes: list of available tools with short descriptions, project context, and available agents
- Keep the tool call handler in the same `subscribe()` callback that already handles `agent_end` — don't create a separate subscription

**Test scenarios:**
- Happy path: Session created with `customTools` — verify tools appear in session
- Happy path: Tool call event triggers executor and result is sent back
- Edge case: Multiple tool calls in sequence — each returns before next prompt
- Edge case: Tool call during streaming — handled as part of the normal event flow
- Integration: Full dispatch → agent calls tool → tool executes → result injected → agent continues

**Verification:**
- `createAgentSession` receives `customTools` in options
- Session subscription handles `custom_tool_call` events
- System prompt contains tool descriptions
- Existing tests (92) still pass
- New integration test verifies tool call round-trip

---

### U4. System Prompt Tool Awareness

**Goal:** Inject tool availability, project context, and peer agent information into the system prompt so agents know what they can do.

**Requirements:** R5

**Dependencies:** U1

**Files:**
- Modify: `server/src/agents/manager.ts`

**Approach:**
- Extend the existing `systemPromptOverride` callback in `create()`
- Append a concise "Available Tools" section listing each tool name + one-line description
- Append project context: project name, directory, configured agents and their skills
- Append memory scope rules: company vs project scope
- Keep the injection compact — aim for <500 tokens of tool context

**Patterns to follow:**
- The existing system prompt override already appends agent personality and REMEMBER: format instructions
- New sections added after personality, before task instructions
- Tool descriptions match the `description` field from TOOL_DEFINITIONS

**Test scenarios:**
- Happy path: System prompt includes tool list when ToolExecutor is configured
- Edge case: System prompt is still valid when no ToolExecutor (backward compatibility)
- Edge case: Tool descriptions are concise and don't exceed 500 tokens

**Verification:**
- System prompt contains "Available Tools:" section
- Each tool has a one-line description
- Prompt length does not dominate the available context window
- Existing tests still pass

---

## System-Wide Impact

- **Interaction graph:** `AgentSessionManager` gains a `ToolExecutor` dependency. `index.ts` wires it during `startServer()`. Session creation passes `customTools`. Session subscription adds tool call handling.
- **Error propagation:** Tool errors return as error strings in the agent's output — they don't crash the session. Failed tool calls are visible to the agent as part of the conversation.
- **State lifecycle risks:** Tool calls that mutate state (create_task, approve_gate, remember_fact) persist to SQLite synchronously within the tool executor. No partial-write risk since each call is a single DB transaction.
- **API surface parity:** All 10 tools mirror existing API routes. Any behavior change to a route should also update the corresponding tool. A test in U3 verifies this parity.
- **Unchanged invariants:** The existing dispatch flow, response capture, REMEMBER: auto-extraction, and event broadcasting are untouched. Tools are additive.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| pi SDK `customTools` API may differ from documented shape | U3 integration test verifies round-trip with actual pi SDK session |
| TypeBox may not be included in pi SDK dependencies | U1 added as devDependency if missing; implementation-time check |
| Tool call latency blocks agent response | Tools are synchronous within the event loop; no external API calls (all local service classes) |
| Agent misuses tools (wrong args, excessive calls) | Tool executor validates args and returns errors; rate limiting deferred to M7 |

---

## Sources & References

- Prior code review findings: `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md`
- Prior fix patterns: `docs/solutions/best-practices/systematic-code-review-fix-sweep-2026-05-07.md`
- Agent session manager: `server/src/agents/manager.ts`
- Service classes: `server/src/tasks/tracker.ts`, `server/src/workflows/engine.ts`, `server/src/memory/engine.ts`, `server/src/skills/registry.ts`, `server/src/tracking/cost-tracker.ts`
