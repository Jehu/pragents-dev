---
title: Multi-Agent Code Review Findings — Common Bug Patterns
date: 2026-05-07
category: best-practices
module: code-review
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Running multi-agent code reviews on greenfield TypeScript/Node projects
  - Fixing tiered review findings (P0/P1/P2) systematically
  - Projects using Zod schema validation, SQLite, Express, WebSocket/SSE
tags: [code-review, bug-patterns, typescript, zod, sqlite, race-conditions]
---

# Multi-Agent Code Review Findings — Common Bug Patterns

## Context

An 8-agent code review of pragents (greenfield TypeScript/Node agent orchestration sidecar, 62 files, 5376 insertions) surfaced 23 findings across correctness, testing, maintainability, adversarial, reliability, typescript, agent-native, and learnings reviewers. All findings were fixed in 3 commits. Key bug patterns emerged that are applicable to any similar project.

## Guidance

### Pattern 1: Zod silently strips unrecognized YAML fields

Zod's `.parse()` is strict by default — fields in the YAML config that don't appear in the Zod schema are silently dropped. This caused cost tracking to always report $0 because the `costs` field was in the YAML but missing from the schema.

**Prevention:** When adding a new YAML config section, always add the matching Zod field FIRST. Use `z.strictObject()` if you want Zod to reject extra fields instead of silently dropping them.

```typescript
// Bug: costs in YAML but not in schema → silently dropped
const config = PragentsConfig.parse(yaml);
config.costs // undefined — Zod stripped it

// Fix: add the field to the schema before writing YAML
const PragentsConfig = z.object({
  costs: z.record(z.string(), CostRate).optional(),
});
```

### Pattern 2: `model.startsWith(key)` over-matches shorter prefixes

When matching model names to cost rates, `startsWith` is greedy: `gpt-4o-mini` starts with `gpt-4o`, so it gets charged at the wrong rate. The `includes()` check makes it worse.

**Prevention:** Sort keys longest-first and use boundary-aware matching (`startsWith(key + '/')` or `startsWith(key + '-')`).

```typescript
// Bug: gpt-4o-mini matches gpt-4o via startsWith → 16x overcharge
for (const [key, rate] of Object.entries(rates)) {
  if (model.startsWith(key)) return rate; // first match wins
}

// Fix: sort longest-first, match on boundaries
const sorted = Object.entries(rates).sort((a, b) => b[0].length - a[0].length);
for (const [key, rate] of sorted) {
  if (model === key || model.startsWith(key + '/') || model.startsWith(key + '-')) {
    return rate;
  }
}
```

### Pattern 3: SQL queries reference columns that don't exist

The `pmCheck()` cleanup scan queried `SELECT goal_run_id FROM goal_runs` but the migration defined the column as `id`. No type checker catches this — it's a runtime SQL error.

**Prevention:** Align SQL aliases with migration column names. If using column aliasing (`workflow_name as workflowName`), ensure the source column name matches the migration.

```sql
-- Bug: goal_run_id doesn't exist in migration
SELECT goal_run_id FROM goal_runs WHERE workflow_run_id = ?

-- Fix: use the actual column name with alias
SELECT id as goal_run_id FROM goal_runs WHERE workflow_run_id = ?
```

### Pattern 4: Concurrent session disposal loses in-flight work

When two dispatches target the same agent, the second dispatch disposes the first's streaming session, causing the first task to wait for a 10-minute timeout and resolve with garbage output.

**Prevention:** Never dispose a session that is currently streaming. Reuse the same session for sequential prompts — most SDKs support multiple sequential `prompt()` calls on one session.

```typescript
// Bug: dispose streaming session, lose task A's result
if (existing) {
  existing.session.dispose(); // task A's responsePromise is still pending
  return this.create(agent);
}

// Fix: reuse even if streaming — SDK handles sequential prompts
if (existing) {
  existing.lastActivityAt = Date.now();
  return existing;
}
```

### Pattern 5: WebSocket/SSE listener arrays grow unbounded

Module-level listener arrays that only grow (never shrink) on every mount/disconnect cycle cause N× duplicate event processing after N reconnects. In React Strict Mode (double mount), this happens on every development refresh.

**Prevention:** Clear listeners on disconnect. Add a maximum reconnect limit.

```typescript
// Bug: listeners only grow, never shrink
const listeners: EventCallback[] = [];
function connect(onEvent?: EventCallback) {
  if (onEvent) listeners.push(onEvent); // accumulates forever
}

// Fix: clear on disconnect, limit reconnects
function disconnect() {
  listeners.length = 0;
  // ...
}
function scheduleReconnect(retryCount: number) {
  if (retryCount >= 15) return; // max 15 retries
}
```

### Pattern 6: Dispatch timeout resolves instead of rejects

A 10-minute dispatch timeout that resolves with a success string makes callers treat timed-out tasks as successfully completed. The task tracker stores `"Task timed out without response"` as the task result and marks it `complete`.

**Prevention:** Timeouts should reject with an error. Callers already have `.catch()` handlers for failure — use them.

```typescript
// Bug: timeout resolves → task marked 'complete' with garbage result
setTimeout(() => { unsubscribe(); resolve('Task timed out'); }, 600000);

// Fix: timeout rejects → task marked 'failed', catch handler fires
setTimeout(() => { unsubscribe(); reject(new Error('Task timed out')); }, 600000);
```

### Pattern 7: Condition DSL test uses wrong format — passes accidentally

The condition evaluator expects `step_id.output includes 'text'` but the test used `$result1 contains 'done'`. The `$` prefix didn't match the regex, `contains` wasn't in the operator set, so the condition always evaluated to `false` — and the test name was *"skips conditional step when condition fails"*, making it appear correct.

**Prevention:** Always write at least one test for the positive path. A test with `result1.output includes 'done'` where the mock returns `'Task done successfully'` would have caught the DSL mismatch.

## Why This Matters

8 specialized reviewer agents found patterns that a single reviewer would miss. The adversarial reviewer caught the concurrent-dispatch race; the reliability reviewer caught the fetch timeout; the correctness reviewer caught the Zod silent-stripping. Multi-agent review produces findings at a density that justifies fixing in tiers (P0 → P1 → P2) rather than one-offs.

## When to Apply

- After any multi-agent code review that surfaces 10+ findings
- When seeing the same bug category across multiple modules (e.g., 4 modules with unbounded listener arrays)
- When establishing review checklists for greenfield TypeScript/Node projects

## Related

- `docs/solutions/best-practices/systematic-code-review-fix-sweep-2026-05-07.md` — Prior review fix patterns from the same project
- Branch `feat/pragents-m2-orchestrate` — 3 fix commits: `b399846`, `e22aab6`, `cfab113`
