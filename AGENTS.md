# AGENTS.md — pragents

> **pragents** is a pragmatic agent observability and orchestration layer on top of [pi](https://pi.dev/). It gives a one-person agency autonomous project management, multi-project awareness, living memory, and complete observability.

---

## Project Identity

- **What it is:** A sidecar server that orchestrates pi coding agents across multiple client projects. Agents remember across sessions, work on recurring goals, and coordinate via workflows.
- **What it is NOT:** A replacement for pi. pragents extends pi's teams, tasks, and tools — it does not reimplement them.
- **Target user:** One-person agency managing multiple client projects with specialized agents (Dev, SEO, Content, PM, Office).
- **Source of truth for product design:** `docs/superpowers/specs/2026-05-06-pragents-design.md`

### Architecture Philosophy

- **Sidecar model** — pragents server runs alongside pi, connected via WebSocket (pi Bridge extension)
- **Single source of truth** — pragents server owns all state; all interfaces (Web, Terminal, future Telegram) are clients
- **Local-first, remote-ready** — embedded databases (SQLite + LanceDB), no external services; architecture supports later remote deployment
- **Lazy agent spawning** — agent processes start only when a task is active, terminate after idle timeout (10 min default)
- **Skills are pi-native** — `.md` files with YAML frontmatter; pragents adds `x-pragents-` metadata that pi ignores

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Runtime** | Node.js / TypeScript (ESM) | Target ES2022, strict mode |
| **Web framework** | Hono 4.x | Lightweight, TS-first, good WS/SSE support |
| **Database** | better-sqlite3 (WAL mode) | Embedded, single-file. Use `getDb()` — never create connections directly |
| **Vector store** | LanceDB (embedded) + SimpleVectorStore fallback | Abstracted behind `VectorStore` interface |
| **Agent SDK** | `@mariozechner/pi-coding-agent` v0.73+ | pi SDK for agent session management |
| **Validation** | Zod 3.x | All config, workflow, goal, and skill schemas |
| **Config format** | YAML (`yaml` package) | Single file: `~/.pragents/pragents.yaml` |
| **Scheduling** | croner | For goal cadences and PM check intervals |
| **Logging** | pino | Structured JSON to file + pretty-print to console |
| **Testing** | vitest | Server uses globals; web uses explicit imports |
| **Frontend** | React 19 + TanStack Router + TanStack Query + Zustand + UnoCSS | SPA in `web/` |

---

## Project Structure

```
pragents/
├── AGENTS.md                     # This file
├── pragents.example.yaml         # Example config (actual config lives at ~/.pragents/pragents.yaml)
├── package.json                  # Workspace root (npm workspaces: server, web, packages/*)
├── tsconfig.base.json            # Shared TS config (strict, ES2022, bundler resolution)
│
├── packages/
│   └── schema/                   # Shared Zod schemas/types consumed by server and web
│       └── src/
│           ├── config.ts
│           ├── workflow.ts
│           ├── skill.ts
│           └── index.ts
│
├── server/                       # Backend: Hono server
│   ├── src/
│   │   ├── index.ts              # Entry point — server startup, wiring, hot-reload
│   │   ├── config/
│   │   │   ├── schema.ts         # Zod schemas + agent resolution (PragentsConfig, ResolvedAgent)
│   │   │   ├── loader.ts         # YAML config loading with env:VAR resolution
│   │   │   └── __tests__/
│   │   ├── db/
│   │   │   ├── sqlite.ts         # DB singleton (getDb, initDb, closeDb, migrations)
│   │   │   └── migrations/       # SQL migration files (001_initial.sql … current numbered migration)
│   │   ├── agents/
│   │   │   ├── manager.ts        # AgentSessionManager — creates/reuses pi SDK sessions
│   │   │   ├── model-resolver.ts # Model/pool resolution helpers
│   │   │   ├── tool-executor.ts  # ToolExecutor — agent-to-platform tool bridge (19 tools)
│   │   │   ├── tool-definitions.ts # Tool schemas (TypeBox-compatible, used by pi SDK customTools)
│   │   │   ├── runtime/          # pi runtime adapter boundary
│   │   │   └── __tests__/
│   │   ├── chat/
│   │   │   ├── manager.ts        # Conversation state and TTL
│   │   │   ├── intent-classifier.ts # Chat intent routing
│   │   │   └── schema.ts
│   │   ├── memory/
│   │   │   ├── engine.ts         # MemoryEngine — short-term + long-term (facts, vector search)
│   │   │   ├── vector-store/
│   │   │   │   ├── interface.ts  # VectorStore interface
│   │   │   │   ├── lancedb.ts    # LanceDB implementation
│   │   │   │   └── simple.ts     # In-memory fallback
│   │   │   └── __tests__/
│   │   ├── workflows/
│   │   │   ├── engine.ts         # WorkflowEngine — sequential/parallel steps, human gates
│   │   │   ├── loader.ts         # WorkflowRegistry — loads YAML from workflows/
│   │   │   ├── schema.ts         # WorkflowDef, WorkflowStep (Zod)
│   │   │   ├── tracker.ts        # WorkflowTracker — SQLite-backed run/step tracking
│   │   │   └── __tests__/
│   │   ├── routing/
│   │   │   ├── router.ts         # SkillRouter — keyword-based agent selection
│   │   │   └── __tests__/
│   │   ├── nl/
│   │   │   └── decomposer.ts     # NLDecomposer — LLM task decomposition into plans
│   │   ├── plans/
│   │   │   ├── store.ts          # NL plan persistence
│   │   │   ├── executor.ts       # Approved plan execution
│   │   │   └── schema.ts
│   │   ├── goals/
│   │   │   ├── loader.ts         # GoalRegistry — loads YAML from goals/
│   │   │   ├── scheduler.ts      # GoalScheduler — cron-based goal triggering + PM monitoring
│   │   │   └── schema.ts         # GoalDef (Zod)
│   │   ├── tasks/
│   │   │   ├── tracker.ts        # TaskTracker — SQLite-backed task lifecycle
│   │   │   └── __tests__/
│   │   ├── skills/
│   │   │   ├── registry.ts       # SkillRegistry — YAML file + SQLite persistence
│   │   │   ├── extractor.ts      # SkillExtractor — extract skills from session traces
│   │   │   ├── auto-extractor.ts # Disposal/PM-triggered automatic extraction
│   │   │   ├── operations.ts     # Skill filesystem operations
│   │   │   ├── schema.ts         # SkillDef (Zod)
│   │   │   └── __tests__/
│   │   ├── events/
│   │   │   ├── buffer.ts         # EventBuffer — ring buffer (last 1000 events)
│   │   │   └── __tests__/
│   │   ├── tracking/
│   │   │   └── cost-tracker.ts   # CostTracker — token usage + LLM cost aggregation
│   │   ├── api/
│   │   │   ├── middleware/auth.ts # API token auth with localhost bypass
│   │   │   ├── ws.ts             # WebSocket setup + broadcast
│   │   │   └── routes/           # Hono route modules (REST API)
│   │   │       ├── health.ts, events.ts, tasks.ts, projects.ts, agents.ts
│   │   │       ├── workflows.ts, workflowFiles.ts, nl.ts, plans.ts, chat.ts
│   │   │       ├── cost.ts, goals.ts, gates.ts, feed.ts, memory.ts, metrics.ts
│   │   │       ├── settings.ts, files.ts, skills.ts
│   │   ├── security/             # Path validation and allow-list helpers
│   │   ├── util/                 # Shared utilities
│   │   └── logging/
│   │       └── index.ts          # pino logger (file + pretty console)
│   ├── vitest.config.ts
│   └── tsconfig.json
│
├── web/                          # Frontend: React SPA
│   ├── src/
│   │   ├── main.tsx              # Entry point — QueryClient + RouterProvider setup
│   │   ├── stores/               # Zustand stores: connection, scope, eventBus, feed, theme, commandPalette
│   │   ├── hooks/                # useSSE (auto-reconnect), useWebSocket, useEventStream
│   │   ├── components/ui/        # Shared component library: StatusPill, StatCard, Sparkline, MasterDetail,
│   │   │                         #   ApprovalCard, ProgressBar, KbdHint, EmptyState
│   │   └── routes/               # TanStack Router file-based routes + __root.tsx
│   │       ├── __root.tsx        # App shell: header, sidebar nav, ⌘K palette overlay, SSE bootstrap
│   │       └── overview/, inbox/, projects/, agents/, tasks/, plans/, workflows/,
│   │           goals/, skills/, memory/, metrics/, costs/, health/, traces/,
│   │           settings/, chat/
│   └── vite.config.ts, uno.config.ts
│
├── workflows/                    # Workflow YAML definitions (hot-reloaded)
│   └── content-pipeline.yaml
│
├── goals/                        # Goal YAML definitions (hot-reloaded)
│   └── weekly-article.yaml
│
└── docs/
    ├── superpowers/specs/        # Design specification
    ├── brainstorms/              # Requirements documents (ce-brainstorm output)
    ├── plans/                    # Implementation plans (ce-plan output)
    └── solutions/                # Institutional learnings (ce-compound output)
```

---

## Key Design Decisions

### Config-Driven Agents
Agents are defined entirely in `~/.pragents/pragents.yaml` — types, models, personalities, capabilities, memory access, and token budgets. No hardcoded agents. The `ResolvedAgent` type (see `server/src/config/schema.ts`) is the canonical runtime representation. `capabilities` is a list of free-form keyword tags used by the `SkillRouter` to score-match an agent against a task; it does **not** reference real `SKILL.md` files in `~/.pragents/skills/`.

### pi SDK Session Model
Agent sessions are managed via `@mariozechner/pi-coding-agent`. Each agent gets one persistent session (reused across tasks), created lazily on first dispatch. The SDK handles model routing, tool definitions, and event streaming. pragents injects system prompt overrides (personality + tool list + REMEMBER: format) via the `resourceLoader.systemPromptOverride` hook.

### Tool Bridge (M6)
Agents access platform services through typed tools (`server/src/agents/tool-definitions.ts`). The `ToolExecutor` class (`server/src/agents/tool-executor.ts`) maps tool names to service method calls. Tools are registered with pi SDK as `customTools` on session creation. This lets agents query tasks, trigger workflows, search memory, approve gates, check pending attention, etc.

### Workflow Engine
Workflows are YAML-defined step sequences loaded from `workflows/`. The engine supports:
- **Sequential steps** with output chaining (`{research}` template variables)
- **Parallel step groups** via `Promise.allSettled`, with a configurable failure policy (`onStepFailure`: `abort` throws and stops the run, `continue` collects partial results into `<step.id>.results`)
- **Human gates** — workflow pauses until approved/rejected via API
- **Conditional branching** — step-level `condition` field

### Hot-Reload
The `workflows/`, `goals/`, and `skills/` directories are watched via `fs.watch`. File changes trigger a debounced reload (1s) of all registries. No server restart required.

### Event System
All significant actions (task lifecycle, workflow steps, gate changes, agent events) emit through the `EventBuffer` → broadcast to WebSocket + SSE clients. The buffer holds the last 1000 events. SSE clients receive missed events via `Last-Event-ID` header replay.

### Auth
All `/api/*` routes, SSE, and WebSocket access are protected by `PRAGENTS_API_TOKEN` except for localhost requests. On first boot, the server generates a token and appends it to `~/.pragents/.env` if one is not already present. Remote clients must use `Authorization: Bearer <token>` or `?token=<token>` for WebSocket upgrades.

### Database
Single SQLite file at `~/.pragents/data/pragents.db` with WAL mode. Migrations run sequentially from `server/src/db/migrations/`. Always access via `getDb()` — the singleton is initialized in `startServer()`. Never create new database connections directly.

### Memory Tiers
- **Short-term:** In-memory LRU (pi SDK session context)
- **Long-term facts:** SQLite `facts` table + LanceDB vector index
- **Session summaries:** Stored in `session_summaries` table after compression
- Memory scope: `company` (cross-project) or specific project ID

---

## Coding Conventions

### TypeScript
- **Strict mode always** — `strict: true` in tsconfig
- **ESM only** — `"type": "module"` in package.json, use `.js` extensions in imports
- **No default exports** — prefer named exports for all modules
- **Zod for validation** — all external data (config, API bodies, YAML files) goes through Zod schemas
- **Types via Zod inference** — `export type Foo = z.infer<typeof FooSchema>` pattern
- **Import style:** `import { thing } from './module.js'` (explicit `.js` extension for ESM compatibility)

### File Organization
- **Tests co-located** in `__tests__/` directories next to source files
- **Test file naming:** `<module-name>.test.ts`
- **API routes** in `server/src/api/routes/` — one file per resource, each exports a factory function
- **Service classes** own their domain — `TaskTracker`, `WorkflowEngine`, `MemoryEngine`, etc.

### Naming
- **Classes:** PascalCase (`AgentSessionManager`, `WorkflowEngine`)
- **Functions/methods:** camelCase (`getOrCreate`, `setComplete`)
- **Files/directories:** kebab-case (`tool-executor.ts`, `vector-store/`)
- **API routes:** plural nouns (`/api/v1/tasks`, `/api/v1/workflows`)
- **Database columns:** snake_case (`project_id`, `created_at`)

### Error Handling
- **Service methods** throw on failure; callers catch and convert to user-facing messages
- **Tool execution** wraps all calls in try/catch, returns `Error: <message>` string on failure
- **API routes** catch errors and return `{ error: message }` with appropriate HTTP status
- **Log via pino** (`logger.info`, `logger.warn`, `logger.error`) — use structured logging with context objects

### Testing
- **Framework:** vitest. Server config uses `globals: true` with Node environment; web config uses `globals: false` with jsdom.
- **Server tests:** Existing tests may rely on global `describe`/`it`/`expect`.
- **Web tests:** Import test helpers explicitly from `vitest`.
- **Test DB:** Create temp directory with `mkdtempSync`, init DB, clean up in `afterAll`
- **Mocking:** Use `vi.fn()` for dependencies; inject via constructor or factory functions
- **ToolExecutor tests:** Mock all 10+ dependencies, test each tool in isolation
- **No integration tests against real pi SDK** — the SDK is mocked

---

## Development Workflow

### Setup
```bash
npm install        # Installs server + web workspaces
```

### Run Server
```bash
cd server && npm run dev    # tsx watch — auto-reloads on file changes
```

### Run Web UI
```bash
cd web && npm run dev       # Vite dev server
```

### Run Tests
```bash
cd server && npm test              # Single run
cd server && npm run test:watch    # Watch mode
```

### Config
Create `~/.pragents/pragents.yaml` with your company and project agent definitions. See `pragents.example.yaml` in repo root for an example. Environment variables go in `~/.pragents/.env` (loaded at startup). The server also honors `PRAGENTS_CONFIG_PATH`, `PRAGENTS_SKILLS_DIR`, `PRAGENTS_API_TOKEN`, and `PRAGENTS_ALLOW_NO_PROJECTS=1` for the explicit legacy no-projects fallback.

---

## Protected Artifacts (Never Delete)

These directories are compound-engineering pipeline artifacts. Never flag their contents for deletion, removal, or `.gitignore`:

- `docs/brainstorms/*` — requirements documents (ce-brainstorm output)
- `docs/plans/*.md` — implementation plans (ce-plan output)
- `docs/solutions/*.md` — institutional learnings (ce-compound output). Searchable by YAML frontmatter fields (`module`, `tags`, `problem_type`). Consult before implementing features, debugging, or making decisions in documented areas.

---

## pi SDK Integration Notes

- Session creation uses `DefaultResourceLoader` with most features disabled (`noExtensions: true`, `noSkills: true`, etc.) — pragents manages its own skills, prompts, and context
- System prompt is assembled from: agent personality + REMEMBER: format instructions + tool list (when ToolExecutor is available)
- Custom tools are registered via `createAgentSession({ customTools: TOOL_DEFINITIONS })`
- Agent lifecycle events (`assistant_message`, `agent_end`) are subscribed to and forwarded to the pragents event system
- Session disposal is async — `disposeAll()` during shutdown drains in-flight dispatches with a 15s deadline
- Idle sessions are cleaned up every 60s via `disposeIdle()` (default timeout: 10 min)

---

## API Overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/health` | Server health, DB status, uptime |
| GET | `/api/v1/projects` | List configured projects |
| GET/POST/PUT/DELETE | `/api/v1/projects/*` | Project config and project workflow files |
| GET | `/api/v1/agents` | List agents with status |
| GET | `/api/v1/agents/:id` | Agent detail, recent tasks/events |
| POST | `/api/v1/tasks` | Create + dispatch task |
| GET | `/api/v1/tasks` | List tasks (optional `?project=`) |
| GET | `/api/v1/tasks/:id` | Get task detail |
| GET | `/api/v1/workflows` | List workflows |
| POST | `/api/v1/workflows/:name/run` | Trigger workflow |
| GET | `/api/v1/workflows/runs` | List workflow runs |
| POST | `/api/v1/nl/decompose` | Decompose NL prompt into plan |
| POST | `/api/v1/nl/execute` | Execute an approved plan |
| GET | `/api/v1/nl/plans` | List NL plans |
| GET/POST | `/api/v1/plans/*` | Persisted NL plan listing, detail, approval/execution |
| GET | `/api/v1/cost/summary` | Token usage + cost |
| GET | `/api/v1/cost/monthly` | Monthly cost summary |
| GET | `/api/v1/goals` | List goals |
| GET | `/api/v1/goals/runs` | Recent goal runs |
| GET | `/api/v1/gates/pending` | Pending human gates |
| POST | `/api/v1/gates/:id/approve` | Approve gate |
| POST | `/api/v1/gates/:id/reject` | Reject gate |
| GET | `/api/v1/feed` | Unified inbox/feed items |
| GET | `/api/v1/memory/facts` | Search facts (`?search=`) |
| GET | `/api/v1/memory/stats` | Memory statistics |
| GET | `/api/v1/metrics` | Operational metrics |
| GET/POST/PATCH | `/api/v1/skills/*` | List, extract, approve/reject, and manage skills |
| GET/PUT | `/api/v1/settings/*` | Read/write YAML config sections |
| GET | `/api/v1/files/meta` | File metadata for conflict detection on allow-listed paths |
| GET | `/api/v1/traces` | Event traces |
| GET | `/api/v1/traces/:id` | Event trace detail |
| GET | `/api/v1/events/stream` | SSE event stream |
| GET | `/api/v1/events` | Buffered event list |
| POST | `/api/v1/chat` | Chat protocol endpoint |
| GET | `/api/v1/chat/conversations` | Chat conversation list |
| GET | `/api/v1/chat/conversations/:id/messages` | Chat messages |

---

## Agent Tools (M6)

Each agent's tool access can be restricted via the per-agent `tools: { allow, deny }` policy in `pragents.yaml` (deny takes precedence; a present `allow` list is exclusive; absent policy = all tools permitted). Enforcement lives in `ToolExecutor.execute`. New tools added to `TOOL_DEFINITIONS` are permitted by default for policy-less agents and must be added to existing `allow` lists explicitly.

Agents can invoke these 19 platform tools:

| Tool | Category |
|------|----------|
| `query_tasks`, `create_task` | Task management |
| `run_workflow`, `list_workflows`, `get_workflow_runs` | Workflow control |
| `approve_gate`, `reject_gate`, `list_pending_gates`, `list_pending_attention` | Human attention and gates |
| `search_memory`, `remember_fact`, `delete_fact` | Knowledge base |
| `list_skills` | Skill discovery |
| `get_cost_summary` | Cost tracking |
| `list_agents` | Agent discovery |
| `list_goals`, `get_goal_runs` | Goal awareness |
| `list_events` | Event inspection |
| `decompose_task` | Task planning |
