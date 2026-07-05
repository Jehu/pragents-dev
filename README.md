# PrAgents

Pragmatic agent observability and orchestration — a sidecar server that extends your coding agents with project management, persistent memory, workflow automation, and a web dashboard.

## What & Why

**PrAgents gives your coding agents a persistent brain, a project manager, and an office manager.** It runs alongside [pi](https://pi.dev/) as a sidecar, so your agents remember across sessions, coordinate across projects, and execute recurring work without you babysitting them.

The problem: solo agency operators run multiple client projects with specialized agents (Dev, SEO, Content, PM, Office). But agents forget everything between sessions, have no shared context, and can't coordinate across projects. The operator gets trapped *in* the business — manually syncing skills, holding cross-project context in their head, and triaging agent requests one by one.

PrAgents fixes that:

- **Persistent memory** — agents remember facts, decisions, and learnings across sessions and projects
- **Autonomous workflows** — recurring multi-step processes (content pipelines, reporting cycles) that run without human involvement
- **Auto-skill extraction** — completed sessions are automatically scanned for repeatable patterns; skills are extracted via LLM, deduplicated, and optionally auto-approved
- **Human-in-the-loop gates** — when an agent needs your input, it shows up in a unified **inbox feed** with approve/reject actions
- **Web dashboard** — cross-project visibility into what every agent is doing, right now
- **Config-driven** — agents, capabilities, models, and token budgets are defined in a single YAML file; no hardcoded agents

PrAgents is built for the one-person agency that wants agents working *for* them — not the other way around.

## Dependencies

| Layer | Technology | Role |
|-------|-----------|------|
| **Runtime** | Node.js 20+ | Server & agent host |
| **Agent SDK** | [`@mariozechner/pi-coding-agent`](https://pi.dev/) | Agent session management |
| **Server** | [Hono 4](https://hono.dev/), Zod, Pino | HTTP framework, validation, logging |
| **Database** | better-sqlite3 (WAL) + [LanceDB](https://lancedb.com/) | Persistent state + vector search |
| **Scheduling** | croner | Recurring goal & workflow triggers |
| **Frontend** | React 19, TanStack Router/Query, Zustand, UnoCSS | Dashboard SPA |

Everything is installed via `npm install` at the repo root — npm workspaces wire `server/` and `web/` together.

## Install

```bash
# Prerequisites: Node.js 20+

git clone <repo-url> && cd pragents
npm install
```

## Configure

All configuration and runtime state lives in `~/.pragents/` — a hidden directory in your home folder. The server creates subdirectories automatically on first start; you only need to provide the config file and API keys.

```bash
mkdir -p ~/.pragents
cp pragents.example.yaml ~/.pragents/pragents.yaml
cp .env.example ~/.pragents/.env
# edit ~/.pragents/.env — uncomment and fill in your API keys
```

**Company-level settings:**

```yaml
# ~/.pragents/pragents.yaml
company:
  name: My Agency
  similarityThreshold: 0.8        # semantic dedup sensitivity
  skillApproval:
    confidenceThreshold: 0.9      # auto-promote when extraction confidence ≥ this
    blockedTools: [bash, write, computer]   # skills using these tools stay in quarantine
pool:
  maxWarmSessions: 10             # global cap for keepWarm agents
chat:
  classifierThreshold: 0.7        # IntentClassifier confidence below this → fallback to NL decomposer
```

| Field | Default | Description |
|-------|---------|-------------|
| `similarityThreshold` | `0.8` | Semantic deduplication threshold (0–1). When an extracted skill is >80% similar to an existing active skill, the existing skill's confidence is raised instead of creating a duplicate. |
| `skillApproval.confidenceThreshold` | `0.9` | Auto-extracted skills land in `skills/_quarantine/` first. If extraction confidence ≥ this **and** none of the skill's `allowed-tools` appear in `blockedTools`, the skill is promoted to active. Otherwise it waits in quarantine for manual review. |
| `skillApproval.blockedTools` | `[bash, write, computer]` | Tools that block auto-promotion regardless of confidence. |
| `pool.maxWarmSessions` | `10` | Global cap on `keepWarm: true` agent sessions held in memory. |
| `chat.classifierThreshold` | `0.7` | When the IntentClassifier reports confidence below this, the chat falls back to the full NL decomposer instead of running the classified tool. |

**What goes where:**

```
~/.pragents/
├── pragents.yaml         # your config (agents, projects, models, costs)
├── .env                  # API keys + PRAGENTS_API_TOKEN (auto-loaded on start)
│
├── data/                 # ← auto-created
│   ├── pragents.db       # SQLite — tasks, workflows, memory, skills, events, plans
│   ├── backups/          # rolling DB snapshots (5 generations, taken on each boot)
│   └── lancedb/          # vector index (if LanceDB is configured)
│
├── logs/                 # ← auto-created
│   └── pragents.log      # structured JSON logs (debug level)
│
├── sessions/             # ← auto-created
│   └── <agent-id>/       # one pi SDK session directory per agent
│
└── skills/               # ← auto-created
    ├── _quarantine/      # auto-extracted skills awaiting promotion (never loaded into prompts)
    │   └── <name>/SKILL.md
    └── <skill-name>/     # active skills
        ├── SKILL.md      # agentskills.io-compatible skill definition
        ├── scripts/      # optional: executable helpers
        ├── references/   # optional: detailed docs
        └── assets/       # optional: templates, data files
```

## Auth

On first boot the server generates a 32-byte hex token and writes it to `~/.pragents/.env` as `PRAGENTS_API_TOKEN=...`. The token is also logged once at warn-level so you can copy it out of the log.

All `/api/*` routes, the SSE event stream, and the WebSocket are gated by an auth middleware that accepts:

- `Authorization: Bearer <token>` header
- `?token=<...>` query param (used by the WebSocket upgrade, since browsers can't set headers there)
- requests from `localhost` / `127.0.0.1` / `::1` (bypass, so local dev keeps working without copying the token)

Set the token explicitly in `~/.pragents/.env` before boot to skip auto-generation:

```bash
PRAGENTS_API_TOKEN=your-token-here
```

## Run

```bash
# Start the server (auto-reloads on changes)
cd server && npm run dev

# Start the web UI (separate terminal)
cd web && npm run dev
```

Open `http://localhost:3000` for the API and `http://localhost:5174` for the dashboard.

To change the API port, set `interfaces.web.port` in `~/.pragents/pragents.yaml`:

```yaml
interfaces:
  web:
    port: 8080
    host: 0.0.0.0   # optional: bind to all interfaces
```

To change the dashboard dev-server port, edit `web/vite.config.ts`:

```ts
server: {
  port: 5174,                                            // was 5173
  proxy: {
    '/api': 'http://localhost:8080',                     // match the API port
    '/ws':  { target: 'ws://localhost:8080', ws: true },
    '/sse': 'http://localhost:8080',
  },
},
```

## Goals

Goals define recurring managed outcomes, not just cron jobs. A goal says what result should exist on a cadence, which workflow pursues it, how success is evaluated, and when a PM escalation is needed.

Goal files live in `goals/*.yaml` and are hot-reloaded alongside workflows:

```yaml
id: weekly-article
description: "1 well-researched blog article per week"
cadence: "0 8 * * 1"      # trigger every Monday at 08:00
deadline: "0 16 * * 5"    # expected done by Friday at 16:00
workflow: content-pipeline
acceptance:
  - article is published
  - min 1500 words
  - at least 3 cited sources
  - matches customer styleguide
  - SEO keyword integrated
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Stable goal identifier. |
| `description` | yes | Human-readable outcome description. |
| `cadence` | yes | Cron expression for when the goal cycle starts. |
| `deadline` | no | Cron expression used to compute when a run should be complete. |
| `workflow` | yes | Workflow name from `workflows/*.yaml` that executes the goal. |
| `acceptance` | no | Checklist describing what counts as done. Exposed to agents, API, and UI. |

Lifecycle:

1. The scheduler triggers the goal on `cadence` and creates a `goal_runs` row.
2. The linked workflow starts asynchronously and the goal run becomes `running`.
3. Workflow completion/failure events mark the goal run `complete` or `failed`.
4. The PM monitor checks active runs every 5 minutes and escalates overdue runs to the PM agent.

This is the key distinction:

- **Cron** answers "when should something start?"
- **Workflow** answers "which steps execute the work?"
- **Goal** answers "what recurring outcome are we responsible for, what counts as done, and what happens if it stalls?"

Use the API to inspect goals and history:

```bash
curl -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/goals

curl -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/goals/runs
```

The web dashboard's Goals view shows each goal's cadence, next trigger, deadline, acceptance criteria, and recent run history.

## Skills

PrAgents uses the [Agent Skills standard](https://agentskills.io/specification) — the same format pi and other coding agents understand. Each skill is a directory with a `SKILL.md` file at its root.

**Location:** `~/.pragents/skills/` (overridable via `PRAGENTS_SKILLS_DIR`)

**Format:**

```markdown
---
# agentskills.io standard (required)
name: seo-keyword-research
description: Analysiert Keywords für E-Commerce-Produktseiten.

# agentskills.io standard (optional)
license: MIT
compatibility: Requires puppeteer, googleapis
allowed-tools: Bash(grep:*) Read

# pi-specific
argument-hint: "[product categories]"
disable-model-invocation: true

# pragents extensions (x-pragents-* — ignored by other clients)
x-pragents-scope: project
x-pragents-status: active
x-pragents-version: 1
x-pragents-tags: [seo, keyword-research]
x-pragents-agent-types: [seo, pm]
x-pragents-parameters:
  - name: product_categories
    type: string[]
    default: []
---

# SEO Keyword-Recherche

## Setup
npm install

## Steps
1. Extrahiere Produkte aus {product_categories}
2. Recherchiere Suchvolumen via Search Console API
3. Bewerte nach Volumen, Relevanz, Wettbewerb
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Max 64 chars, lowercase letters, digits, hyphens only |
| `description` | ✅ | Max 1024 chars. What the skill does and when to use it |
| `license` | — | License name or reference |
| `compatibility` | — | Max 500 chars. Environment requirements |
| `allowed-tools` | — | Space-separated list of pre-approved tools |
| `x-pragents-scope` | — | `company` / `project` / `agent` (default: `project`) |
| `x-pragents-status` | — | `draft` / `proposed` / `approved` / `active` / `rejected` |
| `x-pragents-tags` | — | String array for skill-based routing |
| `x-pragents-agent-types` | — | Agent types this skill targets (e.g. `[seo, pm]`) |
| `x-pragents-parameters` | — | Typed parameters with defaults for templated execution |
| `x-pragents-extraction` | — | Metadata if the skill was extracted from a session (`source`, `source_session_id`, `confidence`, `extracted_at`). Set automatically by both manual and auto-extraction. |
| `x-pragents-changelog` | — | Version history |

**Optional directories per skill:**

```
seo-keyword-research/
├── SKILL.md          # required
├── scripts/          # executable helpers (Python, Bash, JS)
├── references/       # detailed docs loaded on-demand
└── assets/           # templates, data files, images
```

**Extracting skills from sessions:**

Skills can be extracted from agent sessions — manually via API, or automatically via the built-in pipeline.

**Manual extraction (API):**

```bash
curl -X POST http://localhost:3000/api/v1/skills/extract \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "your-session-id"}'
```

**Automatic extraction (zero-config):**

The server automatically scans completed sessions for repeatable patterns:

1. **Session-end hooks** — when a session is disposed (idle timeout or shutdown), the system checks eligibility (>10 messages, not already extracted) and triggers LLM extraction asynchronously. Extraction never blocks session disposal.

2. **PM monitor** — every 5 minutes, the GoalScheduler scans the last 10 unchecked sessions as a backup (catches sessions missed by the hook — e.g., after a server restart).

3. **Deduplication** — two-stage dedup prevents duplicate skills:
   - **Name-based** (free): if a skill with the same name exists, extraction is skipped
   - **Semantic** (LLM-backed): compares the extracted body against active skills via an isolated LLM session. If >80% similar (configurable via `similarityThreshold`), the existing skill's confidence is raised instead of creating a duplicate

4. **Quarantine + graduated promotion** — every newly extracted skill is first written to `skills/_quarantine/<name>/SKILL.md`. Quarantined skills are **never** loaded into agent system prompts. The skill is then evaluated against `company.skillApproval`:
   - confidence ≥ `confidenceThreshold` **and** none of the skill's `allowed-tools` appear in `blockedTools` → auto-promoted to active
   - otherwise → stays in quarantine until manually approved via the inbox or `POST /api/v1/skills/:name/approve`

5. **Lifecycle events** — extraction emits events through the EventBuffer:
   - `skill.quarantined` — skill extracted into quarantine
   - `skill.promoted` — graduated approval moved it to active
   - `skill.demoted` — skill auto-demoted to `proposed` after 3 rejections
   - `skill.reject_counted` — rejection recorded but threshold not yet reached
   - `skill.deduplicated` — duplicate detected, existing skill confirmed

**Rejecting skills:**

A skill that proves unhelpful can be rejected via:

```bash
curl -X POST -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/skills/<name>/reject
```

After 3 rejections an active skill is auto-demoted back to `proposed` and removed from system prompts.

**Using skills in pi:**

To make pragents skills visible to pi, add the skills directory to pi's settings:

```json
// ~/.pi/settings.json
{
  "skills": ["~/.pragents/skills"]
}
```

Set `disable-model-invocation: true` in a skill's frontmatter to hide it from pi's system prompt while keeping it available via `/skill:name`.

## Chat API

PrAgents exposes a conversational interface at `POST /api/v1/chat`. Clients send a JSON message and receive a typed SSE (Server-Sent Events) stream. Multi-turn conversations are linked via `conversationId`.

### Quick start

```bash
# One-shot command (DirectRouter — no LLM)
curl -X POST http://localhost:3000/api/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Zeig alle Agents"}'

# Complex request (falls through to NL Decomposer → returns plan_proposal)
curl -X POST http://localhost:3000/api/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Bau eine Landing Page für mein Startup"}'

# Multi-turn (pass conversationId from the done event)
curl -X POST http://localhost:3000/api/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Ja, führ den Plan aus","conversationId":"<id-from-done-event>","confirm":true}'
```

### SSE event types

| Event | When | Data |
|-------|------|------|
| `thinking` | Processing started | `{ message: string }` |
| `tool_call` | DirectRouter matched a tool | `{ tool: string, args: object }` |
| `tool_result` | Tool execution completed | `{ tool: string, result: string }` |
| `message` | Human-readable response | `{ subtype, content, plan? }` |
| `error` | Processing failed | `{ code: string, message: string }` |
| `done` | Stream finished | `{ conversationId: string }` |

### Message subtypes

| Subtype | Meaning |
|---------|---------|
| `text` | Plain text response (after tool execution) |
| `plan_proposal` | NL Decomposer created a plan — awaiting confirmation. The envelope carries a `planId` referencing a row in the `plans` table; use `POST /api/v1/plans/:planId/approve` to execute or send `confirm: true` in a follow-up chat request. |
| `status` | Status update |
| `error_message` | Non-fatal error feedback |

### Routing

Two tiers, zero-config:

1. **DirectRouter** — keyword matching against the 12 most common M6 tools (query tasks, list agents, search memory, run workflow, …). No LLM call, sub-100ms latency.
2. **NL Decomposer** — fallback for complex requests. Delegates to a lightweight LLM that produces a structured plan. The plan is returned as `plan_proposal` and pauses for confirmation.

### Request body

```typescript
{
  message: string;           // required
  conversationId?: string;   // omit to start a new conversation
  projectId?: string;        // scope to a specific project
  attachments?: Array<{
    name: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "text/plain" | "application/json" | "text/markdown";
    data: string;            // base64-encoded, max ~10 MB
  }>;
  confirm?: boolean;         // confirm a proposed plan
  modifications?: string;    // modifications when confirming a plan
}
```

## Plans API

Natural-language requests, chat plan proposals, and (eventually) task creations all flow through a single canonical Plan store. A `Plan` has a status lifecycle (`draft → approved → executing → done|failed|cancelled`) and is persisted to the `plans` table.

```bash
# List plans (filter by status/origin/conversationId)
curl -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  'http://localhost:3000/api/v1/plans?status=draft&origin=nl'

# Get a single plan
curl -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/plans/<plan-id>

# Approve and dispatch a draft
curl -X POST -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/plans/<plan-id>/approve

# Cancel
curl -X POST -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/plans/<plan-id>/cancel
```

Entry points that create plans:

- `POST /api/v1/nl/decompose` — returns `{ planId, plan, steps }`, status `draft`
- `POST /api/v1/chat` — when a `plan_proposal` message is emitted, the envelope carries `planId` referencing a draft plan
- `POST /api/v1/nl/execute` — accepts either `{ planId }` (preferred) or the legacy `{ prompt, plan }` shape

The `/api/v1/tasks` POST endpoint still creates standalone tasks; migrating it onto the Plan store is deferred.

## Metrics API

```bash
curl -H "Authorization: Bearer $PRAGENTS_API_TOKEN" \
  http://localhost:3000/api/v1/metrics
```

Returns four objective KPIs aggregated from `events`, `tasks`, `goal_runs`, and `cost_log` over a 7-day rolling window. Results are cached for 30 seconds.

| Field | Meaning |
|-------|---------|
| `skillSuccessRate` | Fraction of `skill.used` events whose parent task ended `complete` |
| `memoryHitRate` | Fraction of `memory.recall` events that returned ≥1 result |
| `escalationsPerGoalRun` | Ratio of escalation tasks created to goal runs in the window |
| `tokensPerCompletedTask` | Average `tokens_in + tokens_out` per completed task |

Metrics that can't be computed (missing data, no linkable events) return `null` and a reason string in the `notes` object — never zero, so dashboards can distinguish "no data" from "actually zero."
