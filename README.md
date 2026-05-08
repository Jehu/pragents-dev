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
