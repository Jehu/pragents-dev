# PrAgents

Pragmatic agent observability and orchestration — a sidecar server that extends your coding agents with project management, persistent memory, workflow automation, and a web dashboard.

## Install

```bash
# Prerequisites: Node.js 20+

git clone <repo-url> && cd pragents
npm install
```

## Configure

Create `~/.pragents/pragents.yaml` (use the included `pragents.yaml` as a template) and an optional `~/.pragents/.env` for API keys.

```bash
mkdir -p ~/.pragents
cp pragents.yaml ~/.pragents/pragents.yaml
```

## Run

```bash
# Start the server (auto-reloads on changes)
cd server && npm run dev

# Start the web UI (separate terminal)
cd web && npm run dev
```

Open `http://localhost:3000` for the API and `http://localhost:5173` for the dashboard.

Data is stored in `~/.pragents/data/`.
