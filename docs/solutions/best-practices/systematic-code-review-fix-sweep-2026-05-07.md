---
title: Systematic Code Review Fix Sweep
date: 2026-05-07
category: best-practices
module: code-review
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - A code review surfaces 10+ findings across multiple categories
  - Bugs have clear severity tiers (P0/P1) and maintainability issues
  - Fixes are mechanical enough to batch but need individual verification
tags: [code-review, bug-fix, test-coverage, quality, pragents]
---

# Systematic Code Review Fix Sweep

## Context

A code review of the pragents project (greenfield TypeScript/Node sidecar for the pi coding agent) ran 4 specialist agents (correctness, testing, maintainability, adversarial) over 41 files with 2724 insertions. The review surfaced 16+ findings: 3 P0 runtime bugs, 4 P1 bugs, and several maintainability issues — all in first-pass implementation code written over 48 hours.

The fix session delivered 4 commits: 3 P0 bugs fixed first, then P1 bugs + maintainability + test coverage in subsequent turns. All work was done inline by a single agent without subagent dispatch. 15 tests grew to 49 (6 modules, +227%).

## Guidance

When a code review surfaces a tiered set of findings, fix them in strict priority order — **never interleave P0/P1 with maintainability work.** Each tier forms a natural commit boundary that keeps the history bisectable.

### The 3-pass approach

**Pass 1: Critical bugs (P0).** Fix crashes, data corruption, dead code paths. Verify immediately. Commit.

```bash
# Example: 3 P0 bugs in 3 files
npx vitest run          # 15/15 still green after fixes
git add -A && git commit -m "fix: 3 P0 bugs from code review"
```

**Pass 2: High-priority bugs (P1) + dead code removal.** These are correctness issues that won't crash but degrade the product: hardcoded strings, resource leaks, missing deduplication.

**Pass 3: Maintainability + test coverage.** This is where the bulk of the work happens — wire the logger, remove unsafe casts, add tests for the critical untested modules. This pass produced the largest line count but touched zero business logic.

### What to prioritize in test coverage

After a review that finds zero test coverage on critical state machines, the first test modules to write are the ones closest to the bugs you just fixed:

| Bug found in | Test module to write |
|---|---|
| `manager.ts` dispatch timeout | — (already had 2 tests) |
| Cost tracker ($0 bug) | — (simple config fix) |
| Goal scheduler (deadline bug) | — (one-line fix) |
| Workflow engine (found in review) | `WorkflowTracker`, `WorkflowEngine` |
| Skill router (found in review) | `SkillRouter` |
| Session management (leak bug) | `EventBuffer` |

The rule: **if a module had a bug found by human review, it needs tests.** The tests force you to understand the module's contract well enough to spot further issues.

### Test modules that matter most

For a greenfield Node/TypeScript project with SQLite:
- **Tracker/state-machine tests**: pure logic, fast, no mocking needed — highest ROI
- **Router tests**: keyword matching + fallback behavior, also pure logic
- **Config loader tests**: catch Zod schema mismatches before they hit production
- **Engine integration tests**: mock the external agent call, test the orchestration logic

### Commit hygiene during fix sweeps

Don't create a single "fix everything" commit. The tier structure maps naturally to conventional commits:

```
fix: 3 P0 bugs from code review        # Runtime errors
fix: P1 bugs + dead code               # Correctness + cleanup
feat: complete test coverage           # Tests for untested modules
```

This keeps `git bisect` working and makes it obvious which commit introduced any regression from a fix.

## Why This Matters

A code review that finds 16 issues is a signal the implementation was done without enough self-review. The goal of a fix sweep isn't just closing findings — it's building the quality infrastructure (tests, logging, clean config) that prevents the next review from finding 16 more.

Without systematic test coverage, each bug fix is a gamble. With tests on the state machines, the next refactor can be verified in seconds.

## When to Apply

- After any code review that surfaces multi-tier findings
- When starting quality work on a greenfield project that has zero test coverage on critical components
- Before merging a large PR that had multiple reviewer comments

## Examples

### Before: dispatch timeout with ReferenceError

```typescript
setTimeout(() => {
  unsubscribe();
  resolve(messages.join('\n') || 'Task timed out without response');
  //     ^^^^^^^^ ReferenceError: messages is not defined
}, 10 * 60 * 1000);
```

### After: static fallback, no variable dependency

```typescript
setTimeout(() => {
  unsubscribe();
  resolve('Task timed out without response');
}, 10 * 60 * 1000);
```

### Before: cost tracking always $0 (Zod stripped `costs`)

```typescript
// schema.ts — costs field missing from PragentsConfig
export const PragentsConfig = z.object({
  company: CompanyConfig,
  projects: z.record(z.string(), ProjectConfig).default({}),
  interfaces: InterfacesConfig.default({}),
});
// → Zod silently drops any `costs:` from YAML
```

### After: typed costs field in schema

```typescript
const CostRate = z.object({ in: z.number(), out: z.number() });
export const PragentsConfig = z.object({
  company: CompanyConfig,
  projects: z.record(z.string(), ProjectConfig).default({}),
  interfaces: InterfacesConfig.default({}),
  costs: z.record(z.string(), CostRate).optional(),
});
// index.ts: new CostTracker(config.costs || {}) — no cast needed
```

## Related

- `docs/plans/2026-05-07-001-feat-pragents-m1-core-plan.md` — M1 Core implementation plan
- `docs/plans/2026-05-07-004-feat-pragents-m4-goals-plan.md` — Goals system (where the deadline bug originated)
- Branch `feat/pragents-m2-orchestrate` — all fixes committed to this branch
