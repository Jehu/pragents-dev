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

## Install

```bash
# Prerequisites: Node.js 20+

git clone <repo-url> && cd pragents
npm install
```

## Configure

Create `~/.pragents/pragents.yaml` (use the included `pragents.example.yaml` as a template) and an optional `~/.pragents/.env` for API keys.

```bash
mkdir -p ~/.pragents
cp pragents.example.yaml ~/.pragents/pragents.yaml
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

Data is stored in `~/.pragents/data/`.
