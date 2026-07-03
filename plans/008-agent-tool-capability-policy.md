# Plan 008: Per-agent tool capability policy (deny-by-default tool authorization)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 867809f..HEAD -- packages/schema/src/config.ts server/src/config/schema.ts server/src/agents/tool-executor.ts server/src/agents/manager.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 002 (runnable server test suite)
- **Category**: security / direction
- **Planned at**: commit `867809f`, 2026-07-03

## Why this matters

The M6 tool bridge gives every agent the **same 19 platform tools** with no
per-agent restriction. That set includes state-changing and trust-sensitive
tools: `approve_gate` / `reject_gate` (an agent can resolve a *human* gate —
partly defeating human-in-the-loop), `create_task` (fan-out / task creation),
`remember_fact` / `delete_fact` (mutate shared memory), and `run_workflow`
(trigger arbitrary workflows). Agent inputs are LLM-generated and increasingly
derived from untrusted content (project files, web output, chat). A confused or
prompt-injected agent can today call any of these.

This plan adds a **capability policy per agent**: config declares which tools
each agent may call, enforced at the single choke point where all tool calls
already pass (`ToolExecutor.execute`). It is deny-list-capable and backward
compatible: agents with no policy keep today's behavior, so nothing breaks on
upgrade, while operators can lock down sensitive agents immediately.

> Note on terminology: the existing `capabilities: string[]` field on an agent is
> **not** a permission list — AGENTS.md states it is free-form keyword tags used
> by `SkillRouter` for task-matching. Do **not** overload it. This plan adds a
> separate, explicitly-named field.

## Current state

- **Tool set** — the 19 tools are defined in
  `server/src/agents/tool-definitions.ts` (`TOOL_DEFINITIONS`, each with a `name`).
  The names: `query_tasks`, `create_task`, `run_workflow`, `list_workflows`,
  `approve_gate`, `reject_gate`, `search_memory`, `remember_fact`, `list_skills`,
  `get_cost_summary`, `list_agents`, `list_goals`, `get_goal_runs`,
  `list_pending_gates`, `list_pending_attention`, `get_workflow_runs`,
  `list_events`, `decompose_task`, `delete_fact`.
- **Single choke point** — `ToolExecutor.execute(toolName, args, agentContext?)`
  (`server/src/agents/tool-executor.ts:34`) is a `switch (toolName)` wrapped in
  try/catch; every agent tool call routes through it, and it already receives the
  calling agent as `agentContext?: ResolvedAgent`. On unknown tool it returns
  `Error: Unknown tool "<name>"...` (`tool-executor.ts:208-209`); errors are
  returned as `Error: <message>` strings (`tool-executor.ts:211-213`).
- **Agent config schema** — `packages/schema/src/config.ts`:
  ```ts
  export const AgentConfig = z.object({
    type: AgentType,
    role: z.enum(['fast', 'standard']).optional(),
    model: z.string().optional(),
    personality: z.string().optional(),
    memory: MemoryAccess.optional(),
    capabilities: z.array(z.string()).optional(),
    tokenBudget: z.number().int().positive().max(10_000_000).optional(),
    keepWarm: z.boolean().optional().default(false),
  });
  ```
  and the resolved shape (`config.ts:159-171`):
  ```ts
  export interface ResolvedAgent {
    id: string; projectId: string; type: AgentType; role?: 'fast' | 'standard';
    model: string; personality: string; memory: MemoryAccess;
    capabilities: string[]; projectDir: string; tokenBudget: number; keepWarm: boolean;
  }
  ```
- **Resolution** — `server/src/config/schema.ts:61-82` `resolveAgent()` builds a
  `ResolvedAgent` from `AgentConfig`, defaulting optional fields
  (e.g. `capabilities: agentConfig.capabilities ?? []`,
  `keepWarm: agentConfig.keepWarm ?? false`). This is where the new field's
  default is applied.
- **System prompt tool list** — `AgentSessionManager.create()`
  (`server/src/agents/manager.ts:143-149`) advertises tools to the agent by
  mapping `TOOL_DEFINITIONS` into the system prompt and registering them as
  `customTools`. Today every agent is told about all tools. (Restricting what is
  *advertised* is a nice-to-have; **enforcement in `execute` is the security
  boundary and is mandatory.**)

Conventions: Zod schema is canonical (`z.infer`), named exports, `.js` import
extensions, service methods throw / tools return `Error: <msg>` strings. Model the
new schema field on the existing optional fields in `AgentConfig`. Tests:
`server/src/agents/__tests__/tool-executor.test.ts`,
`server/src/config/__tests__/`.

## Commands you will need

| Purpose          | Command                                                                 | Expected   |
|------------------|-------------------------------------------------------------------------|------------|
| Server typecheck | `cd server && npx tsc --noEmit`                                         | exit 0     |
| Schema build     | `cd server && npx tsc --noEmit` (schema is a workspace dep, compiled together) | exit 0 |
| Tool-exec tests  | `cd server && npx vitest run src/agents/__tests__/tool-executor.test.ts` | all pass  |
| Config tests     | `cd server && npx vitest run src/config`                                | all pass   |
| Web typecheck    | `cd web && npx tsc --noEmit`                                            | exit 0     |

## Scope

**In scope** (the only files you should modify):
- `packages/schema/src/config.ts` — add the policy field to `AgentConfig` and `ResolvedAgent`
- `server/src/config/schema.ts` — default the field in `resolveAgent`
- `server/src/agents/tool-executor.ts` — enforce the policy in `execute`
- `server/src/agents/__tests__/tool-executor.test.ts` — enforcement tests
- `server/src/config/__tests__/` — resolution/default tests (match existing file naming)
- `pragents.example.yaml` — document the new field with a commented example
- `AGENTS.md` — one line under "Agent Tools (M6)" describing the policy

**Out of scope** (do NOT touch):
- The existing `capabilities` field's meaning or its use in `SkillRouter`.
- `tool-definitions.ts` — the tool set itself does not change.
- Removing tools or changing any tool's behavior.
- The web UI beyond a passing typecheck (a config-UI control for the policy is a
  follow-up, noted in Maintenance).

## Git workflow

- Branch: `advisor/008-agent-tool-capability-policy`
- One or two commits (schema+resolve, then enforce+tests). Message style:
  conventional commits. Example from `git log`:
  `feat(schema): expose project agent types and cap tokenBudget`. Suggested:
  `feat(agents): per-agent tool capability policy enforced in ToolExecutor`.
- Do NOT push or open a PR unless the operator instructed it.

## Design decisions (apply these; do not invent alternatives)

- **Field name**: `tools`. An **optional** object on the agent config:
  ```ts
  tools: z.object({
    allow: z.array(z.string()).optional(),  // if set, ONLY these tool names are permitted
    deny:  z.array(z.string()).optional(),  // these tool names are always blocked
  }).optional()
  ```
- **Semantics** (evaluate in this order in `execute`):
  1. If `deny` contains the tool name → **blocked**.
  2. Else if `allow` is present (non-undefined) and does **not** contain the tool
     name → **blocked**.
  3. Else → **permitted**.
- **Backward compatibility**: if `tools` is undefined (the default), every tool is
  permitted — identical to today. Upgrades are non-breaking.
- **Resolved default**: `resolveAgent` sets `tools: agentConfig.tools ?? {}` so
  `ResolvedAgent.tools` is always an object (`{ allow?, deny? }`), never undefined
  — simplifies enforcement (an empty object permits everything).
- **Read vs write**: this plan does **not** categorize tools; the operator lists
  names explicitly. (A named "readonly" preset is a follow-up.)

## Steps

### Step 1: Extend the config schema

In `packages/schema/src/config.ts`, add the `tools` field to `AgentConfig`
(after `capabilities`, matching the optional style) and add `tools: { allow?: string[]; deny?: string[] }` to the `ResolvedAgent` interface.

**Verify**: `cd server && npx tsc --noEmit` → exit 0 (the server imports the schema
workspace; a type error surfaces here).

### Step 2: Default the field in resolveAgent

In `server/src/config/schema.ts:68-81`, add `tools: agentConfig.tools ?? {}` to the
returned object.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 3: Enforce the policy in ToolExecutor.execute

At the top of `execute()` (before the `switch`, inside the existing `try`), add a
guard using `agentContext`:

```ts
if (agentContext?.tools) {
  const { allow, deny } = agentContext.tools;
  const denied = deny?.includes(toolName);
  const notAllowed = allow !== undefined && !allow.includes(toolName);
  if (denied || notAllowed) {
    logger.warn({ agentId: agentContext.id, tool: toolName }, 'Tool call blocked by agent capability policy');
    return `Error: Tool "${toolName}" is not permitted for this agent`;
  }
}
```

Import `logger` if not already imported (`import { logger } from '../logging/index.js';`
— plan 005 may have already added it; if present, reuse it). Returning an
`Error: ...` string matches the existing tool-error convention, so the agent
receives a normal tool-error result it can reason about, not a crash.

**Verify**: `cd server && npx tsc --noEmit` → exit 0.

### Step 4: (Optional, recommended) restrict the advertised tool list

In `AgentSessionManager.create()` (`manager.ts:143-149`), filter
`TOOL_DEFINITIONS` by the same policy before building the system-prompt list and
the `customTools` array, so an agent is not even told about tools it cannot use.
This is defense-in-depth and reduces wasted tool-call attempts; the Step 3 guard
remains the authoritative boundary. If filtering `customTools` risks breaking the
pi SDK registration typing, keep the full `customTools` set and only filter the
**system-prompt advertisement** — enforcement in Step 3 still holds. If unsure,
skip this step and note it; it is not required for correctness.

**Verify**: `cd server && npx tsc --noEmit` → exit 0. If done,
`cd server && npx vitest run src/agents/__tests__/manager.test.ts` → all pass.

### Step 5: Tests

In `tool-executor.test.ts` add cases (the file already constructs a `ToolExecutor`
with mocked deps — reuse that harness and pass an `agentContext` with a `tools`
policy):
- Agent with `tools: { deny: ['approve_gate'] }` calling `approve_gate` →
  returns the "not permitted" error string; the gate is **not** modified (assert
  the DB row / mock was not called).
- Agent with `tools: { allow: ['query_tasks'] }` calling `create_task` → blocked.
- Agent with `tools: { allow: ['query_tasks'] }` calling `query_tasks` → permitted
  (normal result).
- Agent with `tools: {}` (or undefined) calling any tool → permitted (backward
  compat).

In the config tests, add a case: an `AgentConfig` with a `tools` block resolves to
a `ResolvedAgent` whose `tools` matches; an agent without `tools` resolves to
`tools: {}`.

**Verify**:
- `cd server && npx vitest run src/agents/__tests__/tool-executor.test.ts` → all pass.
- `cd server && npx vitest run src/config` → all pass.

### Step 6: Document

- In `pragents.example.yaml`, add a commented example under an agent, e.g.:
  ```yaml
  # tools:
  #   deny: [approve_gate, reject_gate]   # this agent can never resolve human gates
  #   allow: [query_tasks, search_memory] # if set, ONLY these tools are permitted
  ```
- In `AGENTS.md` under "Agent Tools (M6)", add one line: "Each agent's tool access
  can be restricted via the `tools: { allow, deny }` policy (deny takes precedence;
  absent = all tools permitted); enforced in `ToolExecutor.execute`."

**Verify**: `grep -n "tools:" pragents.example.yaml` → shows the commented example.

## Test plan

- Enforcement tests in `tool-executor.test.ts` (deny, allow-restrict, allow-permit,
  no-policy) modeled on the existing mocked-deps harness in that file.
- Resolution/default test in the config test dir modeled on existing config tests.
- Verification: both vitest filters pass; `cd server && npm test` shows no new
  failures.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd server && npx tsc --noEmit` exits 0 and `cd web && npx tsc --noEmit` exits 0
- [ ] `AgentConfig` and `ResolvedAgent` have a `tools` field; `resolveAgent` defaults it to `{}`
- [ ] `ToolExecutor.execute` blocks denied / not-allowed tools and returns an `Error: ...` string
- [ ] The existing `capabilities` field is unchanged in meaning and usage
- [ ] New enforcement + resolution tests pass
- [ ] `cd server && npm test` passes (on the pinned Node)
- [ ] `pragents.example.yaml` and `AGENTS.md` document the policy
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Filtering `customTools` in Step 4 causes a pi SDK typing/registration error you
  cannot resolve within `manager.ts` — fall back to enforcement-only (Step 3) and
  advertisement-filtering, and note it.
- You find a tool-call path that does **not** go through `ToolExecutor.execute`
  (i.e. an agent can reach a service method directly) — that is a bigger hole;
  report it rather than trying to patch multiple sites.
- Adding the `tools` field to the shared schema breaks the web build
  (`cd web && npm run build`) because the web workflow/config UI validates against
  `AgentConfig` strictly — report the failing validation; do not loosen unrelated
  schema.

## Maintenance notes

- Natural follow-ups (out of scope here): a named `readonly` preset that expands to
  the non-mutating tool subset; a config-UI control on the agent form to edit the
  policy; per-tool audit events when a call is blocked (the log line is the seam).
- When a **new** tool is added to `TOOL_DEFINITIONS`, it is permitted by default
  for policy-less agents and must be added to any `allow` lists that should include
  it — document this next to the tool list so operators know allow-lists need
  maintenance.
- Reviewer should confirm `deny` precedence over `allow`, that a policy-less agent
  is unaffected, and that the block path returns a tool-error string (not a throw)
  so the agent loop continues cleanly.
