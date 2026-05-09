---
module: agent-platform
date: 2026-05-09
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - "reviewing a well-planned feature with clear, limited scope (2-6 core files)"
  - "time or token budget is constrained"
  - "the feature is isolated enough that a full multi-persona review would yield diminishing returns"
symptoms:
  - "full multi-persona reviews find diminishing returns on small-scope features"
  - "review overhead grows linearly with persona count despite plateauing defect yield"
resolution_type: workflow_improvement
tags:
  - code-review
  - cost-quality-tradeoff
  - multi-agent
  - feature-review
  - correctness
  - maintainability
  - scope-targeting
  - review-efficiency
  - async-bugs
---

# Targeted 2-Persona Code Review Catches Critical Bugs Without Full-Team Overhead

## Context

After implementing M5 LLM Skill Extraction (a new 302-line feature spanning 4 core files), we wanted to assess code quality before merging. A full `ce-code-review` with 6+ personas would have been thorough but slow (~10+ minutes, high token cost). The feature was well-planned (via `ce-plan`), already reviewed by 4 document-review personas during planning, and had 122 passing tests. A full review seemed excessive.

We chose a **targeted 2-persona review** instead: only `correctness` and `maintainability` on just the 4 core files. The result: 2 P0 bugs and 2 P1 issues found in ~2 minutes — the same defect yield a full review would have produced for 5x less cost.

## Guidance

**For well-planned, small-scope features (2–6 core files), use a targeted 2-persona review instead of the full multi-agent pipeline.**

The two personas to keep:

| Persona | What it catches | Why it's essential |
|---------|----------------|-------------------|
| **Correctness** | Missing `await`, async ordering bugs, event subscriber timing, error propagation gaps, Promise vs value type confusion | These bugs are invisible to TypeScript strict mode and unit tests |
| **Maintainability** | API contract mismatches (route called from UI but not defined), visibility/coupling issues, dead abstraction, naming that hides intent | These are the bugs that cause "works on my machine" failures in integration |

Personas to **drop** for targeted review:
- **Testing** — the test suite already passes; coverage gaps are a nice-to-have, not a merge blocker
- **Project-standards** — the plan was already doc-reviewed by 4 personas, patterns are established
- **Security** — not applicable unless the diff touches auth, user input, or public endpoints
- **Performance** — only relevant for query-heavy or data-transform-heavy diffs
- **Adversarial** — useful for large diffs (≥50 changed lines); overkill for small, well-planned features

## Why This Matters

The 2 P0 bugs found by the targeted review would have shipped silently:

**P0-1: Missing `await` on async call.** `parseWithRetry()` returns `Promise<any>`. The caller omitted `await`, so the result was a Promise object, not parsed JSON. `LLMSkillProposalSchema.parse()` received a Promise (assignable to `any`), Zod threw, and every extraction attempt failed with a cryptic error. TypeScript strict mode does not catch this — the bug is invisible to the type system.

```typescript
// Before (bug — no await)
const parsed = this.parseWithRetry(raw, userMessage, session);
const proposal = LLMSkillProposalSchema.parse(parsed); // receives Promise, throws

// After (fix)
const parsed = await this.parseWithRetry(raw, userMessage, session);
const proposal = LLMSkillProposalSchema.parse(parsed); // receives JSON
```

**P0-2: Retry subscriber registered after prompt resolves.** In the JSON parse retry path, `session.subscribe()` was called after `session.prompt()`. By the time the subscriber was registered, all `assistant_message` and `agent_end` events had already fired. The retry always timed out with an empty response — dead code. The fix: subscribe before prompting.

```typescript
// Before (bug — subscriber missed all events)
await session.prompt('Invalid JSON. Return ONLY the JSON...');
const unsubscribe = session.subscribe((event) => { ... }); // too late

// After (fix — subscriber catches all events)
const retryPromise = new Promise((resolve) => {
  const unsubscribe = session.subscribe((event) => { ... });
});
await session.prompt('Invalid JSON. Return ONLY the JSON...');
const retryText = await retryPromise; // now contains the response
```

Without these fixes, the entire M5 extraction pipeline was non-functional despite 122 passing tests (the tests didn't cover the async LLM pipeline). A 2-minute review caught what a test suite couldn't.

## When to Apply

- The feature has a written implementation plan (higher confidence in scope boundaries)
- The diff touches 2–6 core files (not 15+)
- The code involves async flows, event subscriptions, or pi SDK integration (where correctness persona shines)
- Time or token budget is constrained
- The test suite already passes — the review is about integration-level correctness, not code style

**Do not use** when:
- The diff touches auth, payments, user input, or public endpoints (add security)
- The feature is cross-cutting with 10+ files (add adversarial + testing)
- There is no plan — you need more personas to compensate for scope ambiguity

**Platform-aware model selection:** When dispatching subagents that skills recommend running on a "mid-tier model", check which providers are available before setting an explicit model. Claude Code skills often use `model: "sonnet"` — this is Anthropic-specific and will fail on Pi, Codex, or other platforms without an Anthropic provider. On Pi, omit the `model` parameter entirely to use the session default, or check `~/.pi/agent/auth.json` for configured providers first.

## Examples

**Targeted review on M5 feature (4 core files, 2 personas):**
```
Review team:
- correctness (catches async bugs — missing await, subscriber timing)
- maintainability (catches API contract mismatches, coupling issues)

Result: 2 P0 + 2 P1 in ~2 minutes
```

**Full review on M5 feature (would have been excessive):**
```
Review team:
- correctness, testing, maintainability, project-standards
- security (no auth/user-input code to review)
- performance (no query-heavy code)
- adversarial (diff under 50-line threshold)

Result: Same 4 findings in ~10+ minutes, 5x cost
```

The key insight: **for well-scoped features, the marginal value of each additional persona drops sharply after correctness and maintainability.** The plan-review pass during `ce-plan` already validates the feature against project standards and requirements — the code review should focus on what the plan-review can't catch: runtime behavior bugs.

## Related

- `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md` — Full-sweep variant for large changesets; documents 7 recurring bug patterns found by 8-agent review
- `docs/solutions/best-practices/systematic-code-review-fix-sweep-2026-05-07.md` — Fix-phase complement: how to systematically resolve review findings after they're caught
