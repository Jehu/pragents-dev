# PrAgents

Pragmatic agent observability and orchestration — a sidecar server that extends your coding agents with project management, persistent memory, workflow automation, and a web dashboard.

## What & Why

**PrAgents gives your coding agents a persistent brain, a project manager, and an office manager.** It runs alongside [pi](https://pi.dev/) as a sidecar, so your agents remember across sessions, coordinate across projects, and execute recurring work without you babysitting them.

The problem: solo agency operators run multiple client projects with specialized agents (Dev, SEO, Content, PM, Office). But agents forget everything between sessions, have no shared context, and can't coordinate across projects. The operator gets trapped *in* the business — manually syncing skills, holding cross-project context in their head, and triaging agent requests one by one.

PrAgents fixes that:

- **Persistent memory** — agents remember facts, decisions, and learnings across sessions and projects
- **Autonomous workflows** — recurring multi-step processes (content pipelines, reporting cycles) that run without human involvement
- **Human-in-the-loop gates** — when an agent needs your input, it shows up in a unified **inbox feed** with approve/reject actions
- **Web dashboard** — cross-project visibility into what every agent is doing, right now
- **Config-driven** — agents, skills, models, and token budgets are defined in a single YAML file; no hardcoded agents

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

**What goes where:**

```
~/.pragents/
├── pragents.yaml         # your config (agents, projects, models, costs)
├── .env                  # API keys (auto-loaded on start)
│
├── data/                 # ← auto-created
│   ├── pragents.db       # SQLite — tasks, workflows, memory, skills, events
│   └── lancedb/          # vector index (if LanceDB is configured)
│
├── logs/                 # ← auto-created
│   └── pragents.log      # structured JSON logs (debug level)
│
├── sessions/             # ← auto-created
│   └── <agent-id>/       # one pi SDK session directory per agent
│
└── skills/               # ← auto-created
    └── <skill-name>/     # one subdirectory per skill
        ├── SKILL.md      # agentskills.io-compatible skill definition
        ├── scripts/      # optional: executable helpers
        ├── references/   # optional: detailed docs
        └── assets/       # optional: templates, data files
```

## Run

```bash
# Start the server (auto-reloads on changes)
cd server && npm run dev

# Start the web UI (separate terminal)
cd web && npm run dev
```

Open `http://localhost:3000` for the API and `http://localhost:5173` for the dashboard.

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
| `x-pragents-extraction` | — | Metadata if the skill was LLM-extracted from a session |
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

Skills can be automatically extracted from agent session traces via the API:

```bash
curl -X POST http://localhost:3000/api/v1/skills/extract \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "your-session-id"}'
```

Extracted skills are created with status `proposed` and appear in the web dashboard feed for human review and approval.

**Using skills in pi:**

To make pragents skills visible to pi, add the skills directory to pi's settings:

```json
// ~/.pi/settings.json
{
  "skills": ["~/.pragents/skills"]
}
```

Set `disable-model-invocation: true` in a skill's frontmatter to hide it from pi's system prompt while keeping it available via `/skill:name`.
