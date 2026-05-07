# pragents — Design Specification

**Date:** 2026-05-06  
**Status:** Draft — revised after expert review (architect, pi-expert, frontend, data-engineer, devops, devils-advocate)  
**Context:** One-person agency managing multiple client projects with specialized agents

---

## 1. Vision

pragents is a pragmatic agent observability and orchestration layer on top of [pi](https://pi.dev/). It gives a one-person agency:

- **Autonomous project management** — Agents work on recurring goals (e.g., weekly blog articles) with minimal human intervention
- **Multi-project awareness** — Company-wide agents (Office, PM) coordinate across projects; specialized agents (Dev, SEO, Content) work within project boundaries
- **Living memory** — Short-term session context and long-term project knowledge (codebase, decisions, conventions) with RAG retrieval
- **Complete observability** — Web UI dashboard for live status, deep traces for debugging, memory explorer for knowledge curation
- **Pi-native skills** — Skills as Markdown files with YAML frontmatter, extractable from successful sessions, version-controlled

---

## 2. MVP Strategy (Incremental Delivery)

To avoid the complexity trap, pragents is built in phases. Each phase delivers real, usable value. No 6-month speculative build.

| Phase | Scope | User Value |
|---|---|---|
| **M1: Core** | pi Bridge (WebSocket + Event Capture), SQLite-based Memory (facts, decisions), basic Task tracking | Agents remember across sessions. Tasks are traceable. |
| **M2: Orchestrate** | Sequential workflows, Skill-based routing, simple cron scheduler (node-cron) | Recurring tasks start automatically. Right task goes to right agent. |
| **M3: Observe** | Web UI Dashboard + Traces, Structured logging (pino), Health endpoint, Cost tracking | See what agents do. Know when system is down. Track LLM spending. |
| **M4: Autonomy** | Goal system + PM agent, Human Gates, LanceDB vector store, Context token budgeting | Autonomous project work with controlled human checkpoints. |
| **M5: Polish** | Skill extraction, Memory Explorer UI, Conditional/parallel workflows, Cross-project memory | System learns from sessions. Full power unlocked. |

**Critical prerequisite (M0):** BEFORE any implementation, validate that pi's Extension API supports the required lifecycle hooks (agent_start, tool_call, agent_end) and message injection at the level needed. If pi can't do this, the Bridge model needs fundamental redesign. See Section 15 (Open Questions).

---

## 3. Architecture Overview

### 2.1 Sidecar Model

pragents runs as a separate server process alongside pi. A lightweight pi extension (the "Bridge") connects both processes via WebSocket.

```
┌──────────────────────────────────────────────────────────────────┐
│                        INTERFACES                                 │
│                                                                   │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐            │
│  │ Web UI   │    │ pi Terminal  │    │ Telegram     │            │
│  │(TanStack)│    │ (Extension)  │    │ (später)     │            │
│  └────┬─────┘    └──────┬───────┘    └──────┬───────┘            │
│       │                 │                   │                     │
│       └─────────────────┼───────────────────┘                     │
│                         │ REST + WebSocket API                    │
└─────────────────────────┼─────────────────────────────────────────┘
                          │
┌─────────────────────────┼─────────────────────────────────────────┐
│                  PRAGENTS SERVER (Node/TypeScript)                 │
│                          │                                         │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Memory    │  │ Orchestrator │  │ Skill     │  │ Scheduler  │  │
│  │ Engine    │  │              │  │ Registry  │  │ (Goals)    │  │
│  └─────┬─────┘  └──────┬───────┘  └─────┬─────┘  └─────┬──────┘  │
│        │               │                │              │          │
│  ┌─────┴───────────────┴────────────────┴──────────────┴───────┐ │
│  │                         pi Bridge                            │ │
│  │   • Agent Lifecycle Hooks   • Team/Task Sync                 │ │
│  │   • Tool-Call Interception  • Event Streaming                │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                          │                                         │
└──────────────────────────┼─────────────────────────────────────────┘
                           │ WebSocket (persistent)
                    ┌──────┴──────┐
                    │  pi Runtime │
                    │ (unmodified)│
                    └─────────────┘
```

### 3.2 Process Layout

| Component | Process | Language |
|---|---|---|
| pragents Server | Daemon process | TypeScript (Node) |
| Web UI | Browser (SPA) | TypeScript (React/TanStack) |
| pi + Bridge | Terminal | pi (Python) + JS extension |
| Databases | Embedded in server | SQLite + LanceDB |

### 3.3 Key Principles + Lazy Agent Spawning

- **pi is the foundation, not the competition** — pragents extends pi's teams, tasks, and tools; it does not replace them
- **Single source of truth** — The pragents server owns all state; all interfaces (Web, Terminal, Telegram) are clients
- **Skills stay pi-native** — Skills are `.md` files with YAML frontmatter; pragents adds metadata fields pi ignores
- **Local-first, remote-ready** — Embedded databases, no external services; architecture supports later remote deployment
- **Controlled learning** — Skills can be extracted from sessions, but always require human approval before activation
- **Lazy agent spawning** — Agent processes start only when a task is active, terminate after idle timeout. Prevents process explosion with multiple projects.

---

## 4. Hybrid Company/Project/Agent Model

### 4.1 Structure

```
Company
├── Company-Agents (1×, cross-project)
│   ├── Office-Agent — deadlines, coordination, calendar
│   └── PM-Agent — task prioritization, quality gates, goal tracking
│
├── Projekt A
│   ├── Dev-Agent (project-scoped context)
│   ├── SEO-Agent (project-scoped context)
│   └── Content-Agent (project-scoped context)
│
├── Projekt B
│   ├── Dev-Agent (different instance)
│   └── Content-Agent (different instance)
│
└── Projekt C
    └── SEO-Agent (different instance)
```

### 4.2 Memory Access Matrix

| Agent-Type | Company Memory | Project Memory (own) | Project Memory (other) |
|---|---|---|---|
| Office, PM | read/write | read (all) | read (all) |
| Dev, SEO, Content | read | read/write | — |

### 4.3 Configuration Cascade

```
Agent config (most specific)
    ↓ if not set
Project config
    ↓ if not set
Company config
    ↓ if not set
System defaults
```

Only deviations from defaults need to be configured.

---

## 5. Memory Engine

### 5.1 Two-Tier Architecture

**Short-Term Memory** — volatile, session-scoped:
- Conversation threads, active tasks, intermediate results, tool-call history
- In-memory LRU cache with configurable size limit
- At session end: compressed (summarized) and stored in long-term memory

**Long-Term Memory** — persistent, scoped:
- **SQLite** for structured facts: decisions, conventions, client preferences, project metadata
- **LanceDB** (embedded) for semantic search: codebase snippets, documentation, content archives, RAG retrieval

### 5.2 Context Assembly (with Token Budgeting)

When agent `Dev@ProjektA` receives a task, the Memory Engine assembles context within a strict token budget:

```
┌─────────────────────────────────────────┐
│ Agent Context: Dev@ProjektA             │
│ Total budget: 40K tokens (configurable) │
├─────────────────────────────────────────┤
│ SYSTEM (fixed, ~2K)                     │
│ ├─ Agent personality                    │
│ └─ Active skill prompts                 │
│                                          │
│ SHORT-TERM (priority-ordered, ~8K max)  │
│ ├─ PRIO 1: Task definition              │
│ ├─ PRIO 2: Last 5 messages (truncated)  │
│ ├─ PRIO 3: Last 3 tool results          │
│ └─ PRIO 4: Older messages (summarized)  │
│                                          │
│ LONG-TERM RAG (remainder, ~30K max)     │
│ ├─ PRIO 1: Project decisions (last 30d) │
│ ├─ PRIO 2: Codebase insights (top-5)    │
│ ├─ PRIO 3: Coding conventions           │
│ └─ PRIO 4: Company standards            │
└─────────────────────────────────────────┘
```

**Token Budget Rules:**
- Total context target: configurable per agent type (e.g., Dev: 40K, SEO: 20K)
- Short-term: priority-ordered, older entries summarized when budget exceeded
- Long-term: top-k RAG results trimmed to fit remaining budget
- Stale memories detected: facts older than 30 days with lower relevance are de-prioritized
- Fallback: if RAG returns nothing useful, budget re-allocated to short-term history

### 5.3 VectorStore Abstraction

LanceDB is the first implementation. The engine programs against an interface to allow later swap:

```typescript
interface VectorStore {
  embed(docs: Document[]): Promise<void>;
  search(query: string, filter?: Filter, k?: number): Promise<ScoredDoc[]>;
  update(id: string, doc: Document): Promise<void>;
  delete(filter: Filter): Promise<void>;
  count(filter?: Filter): Promise<number>;
}

// Filter support: { projectId, scope, tags, dateRange }
interface Filter {
  projectId?: string;
  scope?: "company" | string;  // project ID
  tags?: string[];
  since?: Date;
  before?: Date;
}

class LanceDBStore implements VectorStore { /* embedded, zero-deps */ }
// Future: ChromaStore, QdrantStore, pgvectorStore...
```

> **Write safety:** A central write queue in the Memory Engine serializes all LanceDB writes. Concurrent write operations from multiple agent sessions are queued to prevent LanceDB write-locking conflicts.

### 5.4 Core API

```typescript
interface MemoryEngine {
  // Short-term
  context(sessionId: string): Promise<SessionContext>;
  append(sessionId: string, entry: Entry): Promise<void>;

  // Long-term
  remember(fact: Fact, scope: "company" | ProjectId): Promise<void>;
  recall(query: string, scope: "company" | ProjectId, k?: number): Promise<Fact[]>;
  forget(factId: string): Promise<void>;

  // Transition
  compress(sessionId: string): Promise<void>;  // Short-term → Long-term
}
```

---

## 6. Orchestrator

### 6.1 Three Operating Modes

| Mode | Trigger | Example |
|---|---|---|
| **NL Delegation** | Unstructured user request | "Build me a blog with SEO optimization" |
| **Direct Routing** | Known task, known agent | "Dev@A: Fix the login bug" |
| **Workflow** | Recurring process or manual start | Weekly article production pipeline |

### 6.2 NL Delegation Flow

1. **Parse** — LLM decomposes request into a plan with subtasks, agents, and project assignment
2. **Review** — Plan displayed to user in Web UI/Terminal for approval, editing, or rejection
3. **Route** — Each approved subtask is skill-matched to the best agent
4. **Dispatch** — Tasks sent to pi Bridge for execution
5. **Monitor** — Progress tracked, results stored in memory

### 6.3 Skill-Based Routing

Agents declare their skills in the config. The router matches task descriptions against skill tags using keyword matching with optional LLM embedding matching fallback:

```yaml
agents:
  dev@projekt-a:
    type: dev
    project: projekt-a
    skills:
      - typescript
      - react
      - prisma
      - postgresql
    priority: high  # Preferred for frontend tasks
```

### 6.4 Workflow Engine

Workflows define step sequences with support for:
- **Sequential** — Content → SEO → Review
- **Parallel** — Dev + SEO running independently
- **Conditional** — if tests fail → back to Dev, else → Office
- **Quality Gates** — programmatic checks (`npm test`, keyword density) or human approval
- **Timeouts & Retries** — configurable per step
- **Escalation** — on failure, escalate to PM with context
- **Human Gates** — pause workflow until user approves/rejects

### 6.5 Workflow Definition (YAML)

```yaml
workflows:
  article-production:
    steps:
      - id: research
        agent: content
        task: "Research topic, collect sources"
        output: research

      - id: write
        agent: content
        task: "Write article based on {research}"
        input: research
        output: draft

      - id: human_review_draft
        type: human_gate
        label: "Review article draft"
        input: draft
        timeout: 4h

      - id: seo_optimize
        agent: seo
        task: "Optimize for keywords and readability"
        input: draft
        output: optimized
        condition: human_approved

      - id: human_review_final
        type: human_gate
        label: "Final approval"
        input: optimized
        timeout: 24h

      - id: publish
        agent: dev
        task: "Deploy article to CMS"
        input: optimized
        condition: human_approved
```

---

## 7. Project Goals & Autonomous PM

### 7.1 Goal Definition

Goals define recurring outcomes that the PM agent pursues autonomously:

```yaml
goals:
  - id: weekly-article
    description: "1 well-researched article per week"
    cadence: "0 8 * * 1"       # Cron: every Monday 08:00
    deadline: "0 16 * * 5"     # Cron: Friday 16:00
    workflow: article-production
    acceptance:
      - min 1500 words
      - min 3 cited sources
      - matches styleguide
      - SEO keywords integrated
    human_gates:
      - step: after_draft
        label: "Review article draft"
        timeout: 4h
      - step: before_publish
        label: "Final approval"
```

Cadence and deadline use standard cron notation for maximum flexibility (`"0 9 * * 1-5"`, `"0 0 1 * *"`, etc.).

### 7.2 PM Autonomy Cycle

1. **Scheduler** triggers at cadence → PM checks all project goals
2. **PM** creates execution plan: which workflow, which agents, deadline tracking
3. **Orchestrator** dispatches workflow steps
4. **PM** monitors progress, reacts to delays, escalates on timeouts
5. **Human Gates** trigger notifications (Web UI badge + future: Telegram)
6. On timeout, PM escalates: "Draft review pending for 4h"
7. **Retrospective** after goal cycle: PM logs what went well/slow

### 7.3 Dashboard Progress View

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                          Projekt: ▼ Unternehmensblog │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Ziele & Fortschritt                                         │ │
│  │                                                              │ │
│  │ 📝 1 Artikel pro Woche               Ziel: Freitag 16:00    │ │
│  │  ████████████░░░░░░░░░░  67%                                │ │
│  │                                                              │ │
│  │  ✅ Research     done     Mon 10:15                         │ │
│  │  ✅ Draft        done     Tue 14:30   (1,600 words)         │ │
│  │  🔄 Human Review waiting  Tue 14:45   ⏰ pending 3h          │ │
│  │  ⏳ SEO-Optimize          ───                                │ │
│  │  ⏳ Final Review          ───                                │ │
│  │  ⏳ Publish               ───                                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────┐ ┌───────────────────────────────┐ │
│  │ History (last 4 weeks)   │ │ PM Log                        │ │
│  │ KW16 ████████  ✓         │ │ 10:15 PM: Start KW19 article  │ │
│  │ KW17 ████████  ✓         │ │ 10:16 → Content@Blog: Research│ │
│  │ KW18 ████████  ✓         │ │ 12:30 ← Research complete     │ │
│  │ KW19 ██████░░  running   │ │ 12:31 → Content@Blog: Draft   │ │
│  └──────────────────────────┘ └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. YAML Configuration

### 8.1 Single File: `pragents.yaml`

```yaml
company:
  name: "Meine Agentur"

  agents:
    office:
      type: office
      model: claude-sonnet
      personality: |
        Du bist der Office-Manager einer Agentur. Koordiniere Deadlines,
        Meetings und sorge für unternehmensweite Ordnung.
      memory:
        company: read/write
      skills:
        - calendar-management
        - email-drafting
        - task-tracking

    pm:
      type: pm
      model: claude-sonnet
      personality: |
        Du bist der Projekt-Manager. Priorisiere Aufgaben, prüfe
        Ergebnisse und tracke Goal-Fortschritt.
      memory:
        company: read/write
        projects:
          all: read
      skills:
        - task-prioritization
        - quality-review
        - estimation

  memory:
    short_term:
      max_entries: 100
    long_term:
      vector_store: lancedb
      embedding_model: text-embedding-3-small
      chunk_size: 512
    compression:
      strategy: summarize
      max_summary_tokens: 2000

projects:
  kunde-webshop:
    name: "Kunde Webshop Relaunch"
    directory: ~/projects/kunde-webshop
    agents:
      dev:
        type: dev
        model: claude-sonnet
        personality: |
          Senior Fullstack-Entwickler. Stack: Next.js 14, TypeScript, Prisma, PostgreSQL, Tailwind.
        memory:
          project: read/write
          company: read
        skills:
          - typescript
          - nextjs
          - prisma
          - postgresql
          - tailwind
          - testing

      seo:
        type: seo
        model: claude-haiku
        personality: |
          SEO-Spezialist für E-Commerce. Schwerpunkt: technisches SEO, Keyword-Recherche.
        memory:
          project: read/write
          company: read
        skills:
          - keyword-research
          - technical-seo
          - serp-analysis
          - product-page-optimization

      content:
        type: content
        model: claude-sonnet
        personality: |
          Schreibt Produkttexte, Blog-Artikel und Newsletter.
          Tonalität: professionell, vertrauenswürdig, verkaufsstark.
        memory:
          project: read/write
          company: read
        skills:
          - copywriting
          - product-descriptions
          - blog-writing
          - email-content

  unternehmensblog:
    name: "Unternehmensblog Kunde A"
    directory: ~/projects/blog-kunde-a
    goals:
      - id: weekly-article
        description: "1 recherchierter Artikel pro Woche"
        cadence: "0 8 * * 1"
        deadline: "0 16 * * 5"
        workflow: article-production
        acceptance:
          - min 1500 words
          - min 3 cited sources
          - matches styleguide
          - SEO keywords integrated
        human_gates:
          - step: after_draft
            label: "Review article draft"
            timeout: 4h
          - step: before_publish
            label: "Final approval"
    agents:
      dev:
        type: dev
        model: claude-sonnet
        skills: [astro, tailwind, markdown, cms-integration]
      seo:
        type: seo
        model: claude-haiku
        skills: [keyword-research, content-optimization, readability]
      content:
        type: content
        model: claude-sonnet
        skills: [research, copywriting, blog-writing, styleguide]

workflows:
  article-production:
    steps:
      - id: research
        agent: content
        task: "Research topic, collect min 5 sources, extract key findings"
        output: research
      - id: write
        agent: content
        task: "Write article based on {research}. Apply styleguide from company-memory."
        input: research
        output: draft
      - id: human_review_draft
        type: human_gate
        label: "Review article draft"
        input: draft
        timeout: 4h
      - id: seo_optimize
        agent: seo
        task: "Optimize for keywords, readability, meta tags, internal linking"
        input: draft
        output: optimized
        condition: human_approved
      - id: human_review_final
        type: human_gate
        label: "Final approval"
        input: optimized
        timeout: 24h
      - id: publish
        agent: dev
        task: "Deploy article as Markdown to CMS"
        input: optimized
        condition: human_approved

  bug-fix:
    steps:
      - agent: dev
        task: "Analyze and fix the bug"
        output: fix
      - run: "npm test"
        gate: exit_code == 0
      - agent: dev
        task: "Tests failed: {output}. Correct."
        condition: prev_failed
        on_failure: escalate_to_pm

interfaces:
  web:
    port: 3000
    host: localhost
  telegram:
    enabled: false
    bot_token: env:TG_TOKEN
  pi:
    enabled: true
```

### 8.2 Environment Variables

Sensitive values are referenced via `env:VAR` syntax and resolved at startup.

### 8.3 Defaults

Only deviations need to be configured. Defaults (not shown in example above):
- `model`: company default
- `memory.project`: `read/write`
- `memory.company`: `read`

---

## 9. Web UI

### 9.1 Views

| View | Purpose |
|---|---|
| **Dashboard** | Live agent status, active tasks, goal progress, activity stream, task input |
| **Tasks / Plan Review** | Review and edit NL-delegated plans, approve/reject, assign agents |
| **Traces** | Deep-dive debugging: trace list, detailed step view with prompts, tool-calls, results |
| **Agents** | Agent overview across all projects, status, history, skill assignments |
| **Memory Explorer** | Browse facts, search embeddings, view session summaries, curate knowledge |
| **Skills** | List, view, edit, rollback skills. Skill extraction review and approval. |
| **Config** | Edit `pragents.yaml` with validation and JSON-Schema-powered completion |

### 9.2 Technology

| Choice | Rationale |
|---|---|
| **TanStack Router** | Type-safe, file-based routing, nested layouts |
| **TanStack Query** | Server state caching, background refetch, optimistic updates |
| **unoCSS (pure utility-first)** | On-demand utility CSS, no unused styles. LLMs excel at Tailwind/utility patterns — agents write correct CSS 95%+ of the time |
| **Zustand** | Lightweight client state for WebSocket connection status, selected project, UI expand/collapse |
| **WebSocket** | Real-time agent status, tool-call streaming, task updates |
| **SSE (fallback)** | Server→Client events when WebSocket unavailable |
| **data-* attributes** | Semantic markers for debugging and E2E tests: `data-block="dashboard.agent-grid"` |

> **BEM note:** Rejected. Mixing BEM classes with utility classes creates inconsistency. unoCSS utility-first with `data-*` attributes for debugging is simpler, more consistent, and dramatically better for agent-generated code. See review feedback for detailed rationale.

### 9.3 Component Structure

```
src/
├── routes/                    # TanStack Router (file-based)
│   ├── __root.tsx
│   ├── index.tsx             # Dashboard
│   ├── tasks/
│   │   ├── index.tsx         # Task list
│   │   └── $taskId/
│   │       ├── index.tsx     # Task detail
│   │       └── review.tsx    # Plan review (NL Delegation)
│   ├── traces/
│   │   ├── index.tsx         # Trace list
│   │   └── $traceId.tsx      # Trace detail
│   ├── agents/
│   │   ├── index.tsx         # Agent overview
│   │   └── $agentId.tsx      # Agent detail + history
│   ├── memory/
│   │   └── index.tsx         # Memory Explorer
│   ├── skills/
│   │   ├── index.tsx         # Skill list
│   │   └── $skillName.tsx    # Skill detail + edit + versions
│   └── config.tsx            # YAML Editor

├── components/               # Utility-first with data-* markers
│   ├── dashboard/
│   │   ├── agent-grid.tsx           # data-block="dashboard.agent-grid"
│   │   ├── task-list.tsx
│   │   ├── goal-progress.tsx
│   │   ├── activity-stream.tsx
│   │   └── task-input-bar.tsx
│   ├── tasks/
│   │   ├── plan-review.tsx          # NL Delegation plan UI
│   │   └── human-gate.tsx           # Human Gate approval/rejection
│   ├── traces/
│   │   ├── timeline.tsx
│   │   └── tool-call.tsx
│   ├── memory/
│   │   ├── fact-list.tsx
│   │   └── vector-search.tsx
│   └── system/
│       ├── connection-status.tsx    # WebSocket state indicator
│       └── health-panel.tsx         # Server health, DB size, active connections

├── hooks/
│   ├── useWebSocket.ts       # Reconnect with exponential backoff + jitter
│   ├── useApi.ts             # TanStack Query wrappers
│   └── useProjectScope.ts    # Current project context

├── stores/                   # Zustand stores
│   ├── connection.ts         # WebSocket state
│   └── scope.ts              # Selected project/agent

└── styles/
    └── uno.config.ts
```

### 9.4 WebSocket Resilience

```
Client                          Server
  │                              │
  │──── WS Connect ─────────────→│
  │──── auth: { apiKey } ───────→│
  │←─── connected, lastEventId=0 │
  │                              │
  │  ... events streamed ...    │
  │                              │
  │  ✕ Connection lost          │
  │                              │
  │  (exponential backoff:       │
  │   1s → 2s → 4s → 8s → 30s   │
  │   with jitter ±25%)          │
  │                              │
  │──── WS Reconnect ───────────→│
  │──── lastEventId: 150 ───────→│
  │←─── replay events 151-...   │  Server buffers last 1000 events
  │                              │
```

- **Server**: Event buffer (last 1000 events per project), `lastEventId` protocol
- **Client**: Exponential backoff (1-30s, jittered), TanStack Query invalidation on reconnect
- **UI**: Connection status indicator (green/grey/red dot in header)
- **Fallback**: `GET /traces/:id` REST endpoint for full trace replay when WebSocket is unavailable

### 9.5 Human Gate & Plan Review UI

**Plan Review** (after NL Delegation):
- Shows decomposed subtasks with agent assignment
- Dropdown to reassign agent/project per subtask
- Editable task descriptions
- Approve/Reject/Edit & Approve buttons
- Project selector for multi-project dispatch

**Human Gate** (during workflow execution):
- Notification badge in header: "1 review pending"
- Inline content preview (draft text, code diff, etc.)
- Approve/Reject with optional comment textarea
- Timeout countdown display
- Auto-escalation warning when approaching timeout

**Task Input Bar** (on Dashboard):
- Free-text input with project context selector
- Slash-commands: `/workflow article-production`, `/agent dev@projekt-a`
- Submit triggers NL Delegation → Plan Review flow

---

## 10. pi Bridge

### 10.1 Purpose

A thin translation layer between pragents server and pi runtime. Does NOT modify pi — uses only extension APIs.

### 10.2 Responsibilities

| Direction | Actions |
|---|---|
| **pragents → pi** | Create tasks, provide agent context, trigger memory updates, apply agent config |
| **pi → pragents** | Report agent status, stream tool-call logs, return task results, propagate errors |

### 10.3 Implementation

- **Server side**: WebSocket handler in pragents server with event buffering, reconnect protocol, and heartbeat
- **Client side**: pi extension at `.pi/extensions/pragents/` that hooks into agent lifecycle (`agent_start`, `tool_call`, `agent_end`)
- **Sync strategy**: pragents is master — tasks are created through pragents API, pi's native task creation is bypassed (though terminal use remains possible for ad-hoc work)
- **State reconciliation**: On (re)connect, server and pi exchange current state to resolve discrepancies

### 10.4 Task-to-Turn Mapping

pi operates on turns and messages, not tasks. pragents maps tasks via explicit markers:

```
System prompt injected by pragents:
"... When you complete this task, end your response with:
PRAGENTS_TASK_COMPLETE: <one-line summary of what you did>"
```

The bridge intercepts `agent_end` events:
1. If response contains `PRAGENTS_TASK_COMPLETE:` → task marked complete
2. If response contains error patterns → task flagged for review
3. If agent stop reason is `length` or timeout → task marked partial with continuation

This heuristic-based mapping is not perfect but proven in agent systems. Multi-turn tasks (user gives follow-up while task is active) require the bridge to correlate turns by task context.

### 10.5 What the Bridge Does NOT Do

| Not | Instead |
|---|---|
| Modify pi's source | Use extension APIs exclusively |
| Replace pi's event loop | Hook into lifecycle events |
| Duplicate pi's skill system | Generate pi-compatible `.md` skills from registry |
| Override pi's team logic | Drive pi teams via API |

---

## 11. Skills System

### 11.1 Format: pi-Native Markdown

Skills are `.md` files with YAML frontmatter — pi's native format. pragents adds metadata fields with `x-pragents-` prefix that pi silently ignores (prevents future conflicts with pi's schema):

```markdown
---
name: seo-keyword-research
description: "Findet und bewertet Keywords für E-Commerce-Produktseiten"
version: "1.2.0"
license: MIT

# pragents fields (pi ignores; x- prefix prevents future conflicts)
x-pragents-agent-types: [seo, pm]
x-pragents-parameters:
  product_categories:
    type: string[]
    description: "Which product categories to analyze?"
  max_keywords:
    type: number
    default: 50
x-pragents-source: manual                    # manual | extracted
x-pragents-extracted-from:                  # only if source=extracted
  session: "KW23 SEO Optimization"
  date: 2025-06-18
  user_approved: true
x-pragents-history:
  - version: "1.2.0"
    date: 2025-06-18
    change: "Added keyword clustering"
  - version: "1.0.0"
    date: 2025-06-10
    change: "Initial"
---

# SEO Keyword-Recherche

Du bist SEO-Keyword-Spezialist. Analysiere das Produkt-Portfolio:
1. Extrahiere Kernprodukte und Kategorien
2. Recherchiere Suchvolumen (via Search Console / Tools)
3. Bewerte nach: Volumen, Relevanz, Wettbewerb
4. Cluster Keywords nach Suchintention
5. Gib konkrete Empfehlungen für Titel, H1, Meta-Description
Output: Immer als CSV mit Spalten keyword,volume,difficulty,intent
```

### 11.2 Skill Extraction

After a successful session, the user can request: "Turn this into a skill."

The Skill Extractor (LLM-powered) analyzes the session trace:
1. **Pattern detection** — identifies tools used, prompt structure, output format
2. **Generalization** — replaces concrete values with parameters (`"Winterjacken"` → `{product_categories}`)
3. **Prompt distillation** — extracts the most effective prompt from iterations and corrections
4. **Skill proposal** — generates name, prompt, tools, parameters, examples

The proposal is presented in the Web UI for user review, editing, and approval. **Before activation, the extracted skill must pass a test run** in an isolated session — running against a known test input, producing output matching expected structure. The user sees test results alongside the proposal. No automatic skill creation — human approval + test validation are always required.

**Limitations acknowledged:** Skill extraction is a hard problem. Generalization quality depends on the extraction prompt and session coherence. Skills should be treated as "good starting points" that improve with manual refinement and version iteration. Not a fully automated pipeline.

### 11.3 Skill Scope

| Scope | Visible to |
|---|---|
| `company` | All agents in all projects |
| `project` | All agents in one project |
| `agent` | A single agent |

### 11.4 Skill Usage

When a task is routed to an agent, the orchestrator:
1. Finds the best-matching skill via keyword/embedding match
2. Loads the skill's prompt, tools, and parameters
3. Enriches the agent's system prompt with the skill
4. Resolves `{parameters}` from the task context

### 11.5 Skill API (REST)

```
GET    /api/v1/skills                  # List all skills (frontmatter metadata)
GET    /api/v1/skills/:name            # Full skill markdown + metadata
POST   /api/v1/skills/extract          # Extract skill from session trace
PUT    /api/v1/skills/:name            # Edit skill (creates new version)
POST   /api/v1/skills/:name/rollback   # Revert to previous version
```

---

## 12. API Design

### 12.1 REST Endpoints

```
# Projects
GET    /api/v1/projects
GET    /api/v1/projects/:id
GET    /api/v1/projects/:id/progress

# Agents
GET    /api/v1/agents
GET    /api/v1/agents/:id
GET    /api/v1/agents/:id/history

# Tasks
POST   /api/v1/tasks
GET    /api/v1/tasks
GET    /api/v1/tasks/:id
POST   /api/v1/tasks/:id/approve
POST   /api/v1/tasks/:id/reject
POST   /api/v1/tasks/:id/cancel

# Traces
GET    /api/v1/traces
GET    /api/v1/traces/:id

# Memory
GET    /api/v1/memory
POST   /api/v1/memory/facts
DELETE  /api/v1/memory/facts/:id
POST   /api/v1/memory/search
POST   /api/v1/memory/sessions/compress

# Skills (see Section 10.5)

# Workflows
GET    /api/v1/workflows
POST   /api/v1/workflows/:id/run

# Goals
GET    /api/v1/projects/:id/goals
POST   /api/v1/projects/:id/goals/:gid/run
GET    /api/v1/projects/:id/goals/:gid/history
```

### 12.2 WebSocket Events

```
→ agent_status  { agent, status, task, timestamp }
→ tool_call     { agent, tool, input, task }
→ tool_result   { agent, tool, output, ms }
→ task_update   { task, status, progress? }
→ human_gate    { task, gate, label, timeout }
→ pm_log        { message, goal, timestamp }
→ error         { agent, message, task? }
```

### 12.3 SSE Fallback

`GET /sse/events?filter=project:a` — same events as WebSocket, server-sent.

### 12.4 Multi-Interface Architecture

All interfaces (Web UI, pi Terminal, future Telegram) communicate through the same REST + WebSocket API. Telegram will be a separate adapter: webhook receives messages → API Gateway → response back. No business logic in adapters.

### 12.5 Authentication

For local use: simple API key generated on first startup, stored in server config. Remote deployment: API key + optional TLS.

---

## 13. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Server runtime** | Node.js / TypeScript | Shared language with frontend, great WebSocket support |
| **Web framework** | Hono or Fastify | Lightweight, TypeScript-first, good WS/SSE support |
| **Web UI** | React + TanStack Router/Query | Type-safe routing, server state management |
| **Client state** | Zustand | Lightweight for connection state, project scope, UI state |
| **CSS** | unoCSS (utility-first) | On-demand utilities. No BEM — agents write correct utilities 95%+ of the time. `data-*` for debugging. |
| **Short-term memory** | In-memory LRU cache (priority-aware) | Fast, session-scoped. Priority-based eviction prevents loss of task definitions. |
| **Long-term memory (facts)** | SQLite (better-sqlite3, WAL mode) | Embedded, zero-config, SQL queries. WAL mode for concurrent read safety. |
| **Long-term memory (vectors)** | LanceDB | Embedded, file-based, no external service. Abstracted behind VectorStore interface. |
| **Embedding model** | text-embedding-3-small (OpenAI) | 1536 dimensions. ~$0.02/1M tokens. Good balance for content and code. |
| **Task scheduling** | node-cron or croner | Parse cron expressions, trigger goal workflows |
| **pi integration** | pi Extension API + WebSocket | Non-invasive, uses pi's native extension system. Requires M0 validation. |
| **Skills** | Markdown + YAML frontmatter (`x-` prefixed) | Pi-native format. `x-pragents-*` fields prevent future conflicts with pi's schema. |
| **Configuration** | YAML (yaml package) + Zod validation | Single `pragents.yaml`, env var references, validated at startup |
| **Logging** | pino | Structured JSON logging, stdout + file rotation |
| **Process management** | cli wrapper + systemd/launchd | `pragents up` starts server; pi connects as client |

---

## 14. Deployment Model

### 14.1 Local (Default)

- pragents server starts as a daemon (or alongside pi)
- Web UI at `localhost:3000`
- SQLite and LanceDB as files in `~/.pragents/data/`
- Skills in `~/.pragents/skills/` (symlinked or copied to pi's skills directory)
- Config at `~/.pragents/pragents.yaml`

### 14.2 Remote-Ready Design

- Server is a standard HTTP/WS process — deployable behind nginx/Caddy
- Databases are files — mountable as volumes
- API key auth for remote access
- Architecture separates API server from UI (SPA can be served statically)

### 14.3 Logging, Monitoring & Error Recovery

#### Structured Logging

Using `pino` for structured JSON logging:

| Level | What |
|---|---|
| `error` | Server crash, DB corruption, pi connection lost |
| `warn` | Agent timeout, config issue, cost threshold exceeded |
| `info` | Task start/complete, workflow step, goal triggered |
| `debug` | Tool calls, memory queries, routing decisions |

Output: stdout + file rotation in `~/.pragents/logs/`.

#### Health & Monitoring

- `GET /health` → `{ status, uptime, db, bridge, agents_active, recent_errors }`
- Agent liveliness: heartbeat every 30s via Bridge. PM alerted if agent goes stale (>2min no heartbeat)
- Server uptime and crash detection via process manager (see 14.4)
- Web UI `System` tab: server health, DB size, active connections, recent error log

#### Error Recovery

- **Workflow checkpointing:** Each completed workflow step persisted to SQLite `workflow_runs` table. On server restart: resume from last checkpoint.
- **DB corruption:** Startup `PRAGMA integrity_check`. On failure: restore from last daily backup, warn user.
- **Backup:** Daily SQLite `.backup` + LanceDB file copy via node-cron. Retain last 7 days.
- **Task state reconciliation:** On server startup, reconcile with pi: compare active tasks, adopt pi's state where it's more recent.
- **Bridge reconnection:** See Section 9.4 (WebSocket Resilience).

### 14.4 Cost Tracking

LLM costs are tracked per project, per agent, per month:

```typescript
interface CostTracker {
  recordCall(project: ProjectId, agent: string, model: string, tokens: {in: number, out: number}): void;
  budget(project: ProjectId): { limit: number; spent: number; remaining: number };
  alert(project: ProjectId, threshold: number): void; // e.g., at 80% of monthly budget
}
```

- Budget configured per project in `pragents.yaml`: `cost_budget: 50` (monthly USD limit)
- Web UI shows cost dashboard per project
- Embedding costs tracked separately (API calls to embedding model)
- Alerts when approaching budget threshold

### 14.5 Future: Telegram Adapter

- Webhook endpoint receives messages
- Translates natural language to API calls
- Sends notifications for human gates, goal updates, errors
- No business logic — thin translation layer

---

## 15. Data Flow Summary

### 15.1 User Creates a Task

```
User (Web/Terminal/Telegram)
  │  "Create a landing page for client X"
  ▼
API Gateway
  │
  ▼
NL Parser (LLM)
  │  Plan: [Design → Dev, Keywords → SEO, Copy → Content, Deploy → Office]
  ▼
User Review (Web UI)
  │  User approves plan
  ▼
Router (Skill Match)
  │  Design → Dev@ProjektB, Keywords → SEO@ProjektB, ...
  ▼
Workflow Engine
  │  Sequential dispatch: first Design, then parallel Keywords+Copy, then Deploy
  ▼
Memory Engine
  │  Assembles context for each agent
  ▼
pi Bridge
  │  Creates pi tasks with context
  ▼
pi Agents
  │  Execute tasks, tool-calls streamed back via Bridge
  ▼
Memory Engine
  │  Results stored, session compressed
  ▼
PM monitors → Human Gates → Approved → Done
```

### 15.2 Goal Cycle (Autonomous)

```
Scheduler triggers cadence
  │  "0 8 * * 1" → Monday 08:00
  ▼
PM Agent checks all project goals
  │  "weekly-article" → due Friday 16:00
  ▼
PM starts workflow "article-production"
  │
  ▼
Orchestrator dispatches steps
  │  Research → Write → HumanGate → SEO → HumanGate → Publish
  ▼
Human Gate: Web UI notification
  │  User reviews draft → approves
  ▼
Orchestrator continues
  │  SEO optimize → Final human gate → Publish
  ▼
PM logs: "KW19 completed in 3 days"
  ▼
Dashboard shows: KW19 ✓ done
```

---

## 16. Open Questions & Future Considerations

| Topic | Status | Notes |
|---|---|---|
| **M0: pi Extension API validation** | 🔴 **CRITICAL — Must be verified before M1** | Verify pi supports: agent_start/tool_call/agent_end lifecycle hooks, message injection, WebSocket connectivity. If not, Bridge model needs redesign (e.g., SDK approach or forked pi). |
| Telegram integration | Deferred | Thin adapter, no business logic |
| Remote deployment | Designed for | Server is standard HTTP/WS process. Two scenarios: (A) Server local, UI remote — simple. (B) Server remote, pi local — complex, deferred. |
| Alternative VectorStores | Abstracted | Interface allows LanceDB → Qdrant/Chroma swap |
| Multi-user support | Out of scope | Personal tool; single user assumed |
| Authentication | Basic | API key for local; API key + TLS for remote |
| pi version compatibility | TBD | Compatibility check at Bridge connect. Minimum version in package.json. |
| Import/Export | Future | Project memory export, skill sharing between instances |
| Process supervisor | M1+ | Start order: `pragents up` starts server → pi connects. Graceful shutdown via signal handling. Systemd/launchd integration for daemon mode. |
| Config validation & hot-reload | M2+ | Zod schema at startup (hard-fail on invalid). File watcher for non-breaking changes. Breaking changes require restart with warning. |

---

## 17. Project Structure (Preliminary)

```
pragents/
├── pragents.yaml               # User configuration (not in repo)
├── server/
│   ├── src/
│   │   ├── index.ts            # Server entry point
│   │   ├── cli.ts              # CLI wrapper (pragents up/down/status)
│   │   ├── config/
│   │   │   ├── loader.ts       # YAML config parser
│   │   │   └── schema.ts       # Zod validation schema
│   │   ├── memory/
│   │   │   ├── engine.ts       # MemoryEngine implementation
│   │   │   ├── short-term.ts   # Priority-aware LRU cache
│   │   │   ├── long-term.ts    # SQLite + VectorStore
│   │   │   ├── compression.ts  # Session compression strategies
│   │   │   └── vector-store/
│   │   │       ├── interface.ts
│   │   │       ├── lancedb.ts  # LanceDB implementation
│   │   │       └── write-queue.ts
│   │   ├── orchestrator/
│   │   │   ├── index.ts        # Orchestrator coordinator
│   │   │   ├── nl-parser.ts    # NL → Plan decomposition
│   │   │   ├── router.ts       # Skill-based agent routing
│   │   │   └── workflow.ts     # Workflow engine + checkpointing
│   │   ├── skills/
│   │   │   ├── registry.ts     # Skill loading from .md files
│   │   │   ├── extractor.ts    # Session → Skill extraction
│   │   │   └── validator.ts    # Test-run validation for extracted skills
│   │   ├── goals/
│   │   │   ├── scheduler.ts    # Cron-based goal scheduling
│   │   │   └── pm-agent.ts     # Autonomous PM logic
│   │   ├── bridge/
│   │   │   ├── pi-bridge.ts    # pi WebSocket handler
│   │   │   └── reconnect.ts    # Reconnect + state reconciliation
│   │   ├── api/
│   │   │   ├── index.ts        # API Gateway (Hono/Fastify)
│   │   │   ├── rest/           # REST route handlers
│   │   │   ├── ws.ts           # WebSocket + event buffer
│   │   │   └── sse.ts          # SSE fallback
│   │   ├── tracking/
│   │   │   └── cost-tracker.ts # LLM cost tracking per project
│   │   ├── logging/
│   │   │   └── index.ts        # Pino logger setup
│   │   └── db/
│   │       ├── sqlite.ts       # better-sqlite3 wrapper (WAL mode)
│   │       ├── migrate.ts      # Schema migrations
│   │       └── backup.ts       # Daily backup job
│   └── package.json
├── web/                        # TanStack SPA
│   ├── src/
│   │   ├── routes/             # File-based routes (see 9.3)
│   │   ├── components/         # Utility-first + data-* markers
│   │   ├── hooks/              # useWebSocket, useApi, useProjectScope
│   │   ├── stores/             # Zustand stores
│   │   └── styles/
│   ├── package.json
│   └── uno.config.ts
├── skills/                     # Skill .md files
│   ├── seo-keyword-research.md
│   └── code-review.md
├── pi-extension/               # pi Bridge extension
│   └── index.js
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-06-pragents-design.md  # This document
```
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-06-pragents-design.md  # This document
```
