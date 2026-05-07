---
title: "feat: pragents M2.5 — NL Delegation & Plan Review"
type: feat
status: active
date: 2026-05-07
origin: docs/brainstorms/2026-05-07-pragents-m2-orchestrate-requirements.md
---

# feat: pragents M2.5 — NL Delegation & Plan Review

## Summary

Add natural-language task decomposition to pragents. User types "Create a landing page with SEO optimization" → LLM decomposes into a plan with subtasks and agent assignments → Plan Review UI shows the plan for user approval/editing → approved plan dispatches as a workflow. Uses the cheapest configured model for decomposition calls, stores plans in SQLite, and reuses the existing Workflow Engine for execution.

---

## Problem Frame

M2 gave us structured workflows — powerful, but requires manual YAML authoring. For ad-hoc requests ("Optimize my site's performance"), the user must know which agents exist, how to break down the task, and manually create tasks. NL Delegation bridges the gap: unstructured natural language in, structured plan out, executed automatically.

---

## Requirements

- **R1.** NL Decomposition: LLM call takes user's natural language + available agents/skills → returns structured plan (subtasks with agent assignments)
- **R2.** Plan format: JSON with subtasks, each with `description`, `agentId` (matched to available agents), `dependsOn` (ordering)
- **R3.** Plan Review UI: plan displayed in Web UI with editable descriptions, reassignable agents, approve/reject buttons
- **R4.** Approved plan dispatched as ad-hoc workflow via existing WorkflowEngine
- **R5.** Plans stored in SQLite for history and review
- **R6.** Model selection: cheapest configured model (Haiku if present, else PM agent's model)

---

## Scope Boundaries

- No multi-turn plan refinement ("change step 3 to use SEO agent instead")
- No plan templates or saved plans
- No streaming plan generation

---

## Key Technical Decisions

- **Plan as ad-hoc workflow:** NL plan generates a temporary WorkflowDef, executes via existing Engine. No new execution path.
- **Model: cheapest configured.** Find `claude-haiku` among configured agents, fall back to first agent's model.
- **Plan Review UI: modal overlay on Dashboard.** Not a separate page — appears inline when plan is generated.
- **JSON schema for LLM output:** Structured prompt with Zod-validated response parsing.

---

## Implementation Units

### U1. NL Decomposition Service

**Goal:** LLM-powered decomposition of natural language into structured plans.

**Dependencies:** None (uses existing pi SDK + agent config)

**Files:**
- Create: `server/src/nl/decomposer.ts`
- Test: `server/src/nl/__tests__/decomposer.test.ts`

**Approach:**
- `Decomposer.decompose(prompt: string, agents: ResolvedAgent[]): Promise<Plan>`
- Constructs LLM prompt with: user's NL request + available agents (id, type, skills)
- Uses cheapest model: find Haiku-configured agent, else first agent. Uses pi SDK for the LLM call.
- LLM response parsed as JSON, validated with Zod schema.
- Plan format: `{ steps: [{ description, agentId, dependsOn? }] }`
- Timeout: 30s for decomposition call.

**Test scenarios:**
- Happy path: "Fix TypeScript bug" → 1 step, assigned to dev agent
- Happy path: "Create landing page with SEO" → 3+ steps, multiple agent types
- Edge case: No agents configured → clear error
- Error path: LLM returns invalid JSON → retry once, then error

**Verification:**
- Decomposer returns valid plan JSON for representative prompts

---

### U2. Plan Review UI

**Goal:** Modal overlay in Web UI showing the LLM-generated plan with edit/approve/reject.

**Dependencies:** U1

**Files:**
- Modify: `web/src/main.tsx` — add plan review modal, NL input in task bar
- Create: `server/src/api/routes/nl.ts` — POST /api/v1/nl/decompose endpoint

**Approach:**
- NL input: extend task-input-bar with a toggle: "Direct Task" / "NL Delegate"
- NL mode: larger textarea, "Decompose" button
- On submit → POST /api/v1/nl/decompose → returns plan JSON
- Plan Review modal: shows steps as cards with agent badges, editable descriptions, agent dropdown
- Approve → POST /api/v1/nl/execute → creates ad-hoc workflow → dispatches
- Reject → modal closes, plan discarded
- Modal shows loading state during decomposition

**Test scenarios:**
- Happy path: Type NL request → decompose → plan shown → approve → workflow starts
- Happy path: Edit step description in plan → approve → edited plan executes
- Happy path: Reassign agent in plan → approve → new agent executes
- Edge case: Empty NL input → validation error
- Error path: Decomposition fails → error shown in modal

**Verification:**
- Full flow from NL input to approved plan displayed

---

### U3. Plan Execution & Persistence

**Goal:** Store plans in SQLite, execute approved plans via WorkflowEngine.

**Dependencies:** U1, U2, M2 WorkflowEngine

**Files:**
- Create: `server/src/db/migrations/003_nl_plans.sql`
- Modify: `server/src/nl/decomposer.ts` — add execute method
- Modify: `server/src/index.ts` — wire NL routes

**Approach:**
- `nl_plans` table: id, prompt, plan_json, status, created_at
- `POST /api/v1/nl/execute` receives approved plan, stores in DB, creates ad-hoc WorkflowDef, dispatches via WorkflowEngine.execute()
- Ad-hoc workflow: sequential steps matching plan order, no conditions/parallel
- Returns workflow run ID for tracking

**Test scenarios:**
- Happy path: Execute approved plan → workflow run created, steps execute
- Happy path: Plan stored in DB, retrievable via GET /api/v1/nl/plans
- Edge case: Empty plan (no steps) → error

**Verification:**
- Plan persists in SQLite, workflow executes successfully

---

## System-Wide Impact

- Uses existing WorkflowEngine for execution — no new execution infrastructure
- LLM decomposition calls are stateless and don't affect agent sessions
- Plan Review UI is a modal overlay — doesn't change existing navigation structure

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM produces invalid JSON or hallucinated agent IDs | Zod validation catches schema errors. Agent IDs validated against config. Retry once on failure. |
| Cheapest model insufficient for complex decomposition | Configurable override in pragents.yaml (deferred, but architecture supports it) |
| Plan Review UI blocks dashboard during review | Modal is dismissible. Plan saved even if user navigates away. |

---

## Sources & References

- **M2 Plan:** [docs/plans/2026-05-07-002-feat-pragents-m2-orchestrate-plan.md](../plans/2026-05-07-002-feat-pragents-m2-orchestrate-plan.md) — WorkflowEngine, SkillRouter
- **M2 Requirements:** [docs/brainstorms/2026-05-07-pragents-m2-orchestrate-requirements.md](../brainstorms/2026-05-07-pragents-m2-orchestrate-requirements.md) — Deferred NL Delegation
