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
└── sessions/             # ← auto-created
    └── <agent-id>/       # one pi SDK session directory per agent
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
