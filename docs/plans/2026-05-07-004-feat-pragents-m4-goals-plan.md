---
title: "feat: pragents M4 — Goal System & PM Agent"
type: feat
status: active
date: 2026-05-07
origin: docs/superpowers/specs/2026-05-06-pragents-design.md
---

# feat: pragents M4 — Goal System & PM Agent

## Summary

Add autonomous goal tracking to pragents. Goals define recurring outcomes ("1 article per week") with cadence, deadline, and a linked workflow. The PM Agent periodically checks all goals, starts workflows when cadence triggers, monitors progress via the existing EventBuffer, and escalates when deadlines approach. Goals are defined as YAML files, scheduled via node-cron, and visible in the Web UI.

---

## Requirements

- **R1.** Goals defined as YAML files (`goals/*.yaml`) with `id`, `description`, `cadence` (cron), `deadline` (cron), `workflow` (reference to existing workflow)
- **R2.** PM Agent checks all goals on cadence, creates workflow runs when triggered
- **R3.** PM monitors active goal-driven workflow runs via EventBuffer events
- **R4.** PM escalates when deadline approaches (configurable warning threshold, default 2h before deadline)
- **R5.** Goal history tracked in SQLite — which cadence triggered, workflow run ID, completion status
- **R6.** Goals visible in Web UI with progress bar, history, next trigger time
- **R7.** PM Agent is a configured agent from `pragents.yaml` (type: pm), uses its model for escalation messages

---

## Key Technical Decisions

- **Goals as YAML files** (matching workflow pattern): `goals/*.yaml`, one goal per file
- **node-cron for scheduling**: Already in dependencies. Scheduler runs in-process.
- **PM reuses existing AgentSessionManager**: PM dispatches escalation messages as regular agent tasks
- **Goal state in SQLite**: New `goal_runs` table tracks each cadence execution

---

## Implementation Units

### U1. Goal Schema, Loader & Migration

**Files:** `server/src/goals/schema.ts`, `server/src/goals/loader.ts`, `server/src/db/migrations/005_goals.sql`, `goals/weekly-article.yaml`

Zod schema for GoalDef (id, description, cadence cron, deadline cron, workflow name). Loader reads `goals/*.yaml`. SQLite: `goal_runs` table (id, goal_id, workflow_run_id, status, triggered_at, completed_at).

### U2. Goal Scheduler & PM Agent

**Files:** `server/src/goals/scheduler.ts`, `server/src/goals/pm-agent.ts`

Scheduler: node-cron jobs per goal cadence. On trigger → create goal_run → start workflow via WorkflowEngine. PM Agent: monitors active goal_runs via EventBuffer, checks deadline proximity, dispatches escalation to PM agent if approaching.

### U3. Goal API & Web UI

**Files:** `server/src/api/routes/goals.ts`, modify `web/src/main.tsx`

API: GET /api/v1/goals, GET /api/v1/goals/:id, GET /api/v1/goals/runs. Web UI: Goals tab with list, progress bar, next trigger, run history.

---

## Verification

- Goal triggers workflow at correct cron time
- PM escalates when deadline approaches
- Goal history visible in Web UI
- Server restart resumes scheduler correctly
