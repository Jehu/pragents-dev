---
title: "feat: Chat Protocol — Conversational Interface for pragents"
type: feat
status: completed
date: 2026-05-11
origin: docs/brainstorms/2026-05-11-chat-protocol-requirements.md
---

# feat: Chat Protocol — Conversational Interface for pragents

## Summary

Ein generisches Chat-Protokoll (HTTP POST + SSE) auf dem pragents-Server. Clients senden Nachrichten an `POST /api/v1/chat`, der Server streamt Antworten per SSE — mit Multi-Turn-Kontext über `conversationId`, Datei-Anhängen, und Two-Tier-Routing (Keyword → Tool, Fallback → NL Decomposer). Implementiert als neue Route-Factory im bestehenden Hono-Server, persistiert in SQLite, gebaut nach den etablierten Mustern des Projekts (Zod, Factory Functions, SSE-ReadableStream, Migrationen).

---

## Problem Frame

Der Agency Owner arbeitet in pi, Claude Code, Hermes und Telegram. Keiner dieser Clients kann heute mit dem pragents-Orchestrator sprechen. Das Web Dashboard ist reine Beobachtung. Die existierende Task-Input-Bar ist ein Formular, keine Konversation. Das Requirements-Dokument definiert ein Chat-Protokoll, das diese Lücke schließt.

---

## Requirements

- **R1.** `POST /api/v1/chat` mit JSON-Body: `{ message, conversationId?, projectId?, attachments? }`. Antwort als SSE-Stream.
- **R2.** SSE-Events: `thinking`, `tool_call`, `tool_result`, `message`, `error`, `done`. Pflichtfelder: `type`, `data`.
- **R3.** `conversationId` optional. Fehlt sie, startet neue Konversation. Server gibt ID im `done`-Event zurück.
- **R4.** Konversationen haben 24h TTL nach letzter Aktivität.
- **R5.** Two-Tier-Routing: Keyword-Matching → M6-Tool (Direct), Fallback → NL Decomposer (Complex).
- **R6.** Multi-Turn: Konversationsverlauf wird für Kontext-Referenzen genutzt.
- **R7.** NL-Decomposition-Pläne pausieren vor Ausführung zur Bestätigung.
- **R8.** Attachments: Array von `{ name, mimeType, data }` (base64). MIME: image/png, image/jpeg, image/webp, text/plain, application/json, text/markdown.
- **R9.** Client-Adapter sind dünn: POST → SSE parsen → nativ rendern. Keine Orchestrierungslogik.
- **R10.** Telegram-Bot als erster Client-Adapter.
- **R11.** pi-, Claude-Code-, Hermes-Adapter folgen gleichem Muster.
- **R12.** Jede Chat-Nachricht wird in SQLite persistiert (`chat_messages`).

**Origin actors:** A1 (Agency Owner), A2 (pragents Orchestrator), A3 (Client Adapter)
**Origin flows:** F1 (One-shot Command), F2 (Multi-Turn Project Briefing), F3 (Verfeinerung laufender Task), F4 (Telegram Bot)
**Origin acceptance examples:** AE1 (covers R1, R2), AE2 (covers R3, R4, R5), AE3 (covers R5, R7), AE4 (covers R8), AE5 (covers R10)

---

## Scope Boundaries

- Client-Adapter (pi-Extension, Claude-Code-Command, Hermes-Modul, Telegram-Bot) sind separate PRs — dieser Plan baut nur das Server-Protokoll
- Web-Dashboard-Chat-Widget ist nicht Teil dieses Scopes
- Agent-zu-Agent-Chat ist ausgeschlossen
- Datei-Upload-Limit >10 MB ist deferred
- Auth-Layer ist ausgeschlossen (local-first)

### Deferred to Follow-Up Work

- Telegram Bot Implementation: separates Ticket, nutzt das Chat-Protokoll als Backend
- pi/Claude Code/Hermes Adapter: je ein separates Ticket pro Client
- MCP Tool Server (Ansatz 2): separate PR nach Stabilisierung des Chat-Protokolls
- Web Dashboard Chat Widget: separate PR, spätere Iteration
- Direct-Routing-Disambiguierung durch kleines Modell: nach Messung der Keyword-Matching-Fehlerquote entscheiden

---

## Context & Research

### Relevant Code and Patterns

- `server/src/api/routes/events.ts` — SSE-Streaming-Muster (`ReadableStream` + `TextEncoder`, Heartbeat, Cleanup via `abort`-Signal)
- `server/src/api/routes/nl.ts` — NL-Decomposer-Aufruf, Plan-Parsing, Workflow-Erzeugung
- `server/src/agents/tool-executor.ts` — Tool-Dispatch per `switch`, 18 M6-Tools, Rückgabe `JSON.stringify(result)`
- `server/src/routing/router.ts` — `SkillRouter.resolveAgent()` Tokenisierung + Keyword-Matching
- `server/src/db/migrations/009_session_messages.sql` — Message-Persistenz-Muster (Referenz für `chat_messages`)
- `server/src/db/migrations/008_task_feed.sql` — `reason`-Spalten-Pattern, CHECK-Constraints via Table-Rebuild
- `server/src/index.ts` — Route-Mounting, Dependency-Injection, TTL-Cleanup-Intervalle

### Institutional Learnings

- `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md` — SSE-Infrastruktur ist bereits ausgereift; `reason`-Spalten-Pattern als semantisches Vorbild für dedizierte Chat-Persistenz
- `docs/solutions/integration-issues/api-response-shape-change-breaks-consumers-2026-05-09.md` — SSE-Event-Shape von Tag 1 an mit Zod-Schemas definieren; `type`-Discriminator für Change-Tolerance; 4 Clients brechen simultan bei Shape-Änderung
- `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md` — Pattern 5 (unbounded SSE-Listener), Pattern 4 (concurrent session disposal), Pattern 6 (timeout resolves statt rejects) — alle relevant für Chat-SSE-Implementierung

---

## Key Technical Decisions

- **Server-seitiger Conversation-State:** `ConversationManager` hält Konversationen in-memory + SQLite. Clients sind stateless. Ermöglicht Context-Switches zwischen Clients.
- **Two-Tier-Routing vor LLM:** `DirectRouter` prüft zuerst Keyword-Match auf 18 M6-Tools. Nur bei Miss trifft `NLDecomposer`. Spart Latenz und Kosten für einfache Befehle.
- **SSE-Format nach bestehendem `events.ts`-Muster:** `data: <JSON>\n\n` mit `type`-Feld im JSON, kein `event:`-Header. Bewährter Ansatz, einfacher für Clients zu parsen.
- **Zod-Schemas für alle Event-Typen:** Verhindert das API-Shape-Change-Problem (4 Clients brechen simultan). Jeder Event-Typ bekommt ein eigenes Schema.
- **Persistenz in eigener Tabelle:** `chat_messages` parallel zu `session_messages`, nicht als Overload auf Tasks oder Events. Dedizierte Semantik, einfachere Queries.
- **Plan-Bestätigung als eigener SSE-Event-Typ:** `message` mit `subtype: "plan_proposal"` signalisiert dem Client, dass eine Bestätigung erwartet wird. Client sendet nächste Nachricht mit `confirm: true/false` und optional `modifications: "..."` (Änderungswünsche). Der NL Decomposer erhält den vorherigen Plan + Modifikationen als Kontext für eine erneute Dekomposition.

---

## Implementation Units

### U1. Chat Protocol Schemas & Validation

**Goal:** Zod-Schemas für eingehende Chat-Nachrichten, SSE-Events und Attachments definieren. Typ-Export via `z.infer`.

**Requirements:** R1, R2, R8

**Dependencies:** None

**Files:**
- Create: `server/src/chat/schema.ts`
- Test: `server/src/chat/__tests__/schema.test.ts`

**Approach:**
- `ChatRequestSchema`: `{ message: string, conversationId?: string, projectId?: string, attachments?: Attachment[], confirm?: boolean, modifications?: string }`
- `AttachmentSchema`: `{ name: string, mimeType: string, data: string }` mit MIME-Type-Enum
- `SSEEventSchema`: Discriminated Union auf `type` — `ThinkingEvent`, `ToolCallEvent`, `ToolResultEvent`, `MessageEvent`, `ErrorEvent`, `DoneEvent`
- Jedes Event-Schema trägt einen `version: 1`-Feld für zukünftige Migration (Lesson aus API-Shape-Change-Learning)
- `MessageSubtype`-Enum: `text`, `plan_proposal`, `status`, `error_message`

**Execution note:** Start with Zod validation tests before any route code.

**Patterns to follow:**
- `server/src/config/schema.ts` — Zod-Enum + Discriminated-Union-Pattern

**Test scenarios:**
- Happy path: Valid `ChatRequest` mit allen optionalen Feldern wird erfolgreich geparst
- Happy path: `ChatRequest` ohne optionale Felder ist valide
- Edge case: `message` ist leerer String → Validation Error
- Edge case: `attachments` mit nicht-unterstütztem MIME-Type → Validation Error
- Edge case: `attachments` mit base64-Daten über 10 MB → Validation Error (später konfigurierbar)
- Happy path: Jeder SSE-Event-Typ wird korrekt als Discriminated Union geparst
- Edge case: `SSEEvent` ohne `type`-Feld → Validation Error
- Future-proof: Event mit `version: 2` wird trotzdem geparst (forward-compatible)

**Verification:**
- Alle Zod-Schemas exportiert und via `z.infer` typisiert
- Test-Suite: `npm test` im server-Verzeichnis, alle Schema-Tests grün

---

### U2. Database Migration — Chat Persistence

**Goal:** SQLite-Tabellen `chat_conversations` und `chat_messages` für R12 (Persistenz) und R4 (TTL) anlegen.

**Requirements:** R4, R12

**Dependencies:** None

**Files:**
- Create: `server/src/db/migrations/014_chat_messages.sql`

**Approach:**
- Tabelle `chat_conversations`: `id TEXT PRIMARY KEY`, `project_id TEXT`, `last_activity_at TEXT NOT NULL`, `created_at TEXT NOT NULL`
- Tabelle `chat_messages`: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE`, `role TEXT NOT NULL CHECK(role IN ('user','assistant','system'))`, `content TEXT NOT NULL`, `type TEXT`, `attachments_json TEXT`, `created_at TEXT NOT NULL`
- Indexes: `idx_chat_messages_conv` auf `conversation_id`, `idx_chat_messages_created` auf `created_at`, `idx_chat_conv_activity` auf `last_activity_at`
- Migration folgt bestehendem SQL-Pattern: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`

**Patterns to follow:**
- `server/src/db/migrations/009_session_messages.sql` — Message-Persistenz-Struktur
- `server/src/db/migrations/008_task_feed.sql` — CHECK-Constraint-Pattern (für `role`-Enum)

**Test scenarios:**
- Happy path: Migration läuft ohne Fehler auf frischer DB
- Happy path: Migration läuft idempotent (`IF NOT EXISTS`)
- Edge case: `chat_messages` akzeptiert nur `role IN ('user','assistant','system')`
- Edge case: `chat_messages` mit `conversation_id` die nicht in `chat_conversations` existiert → Foreign Key Error

**Verification:**
- Migration wird via `runMigrations()` in `sqlite.ts` ausgeführt
- `PRAGMA table_info(chat_messages)` zeigt korrekte Spalten
- `PRAGMA foreign_key_list(chat_messages)` zeigt FK auf `chat_conversations`

---

### U3. ConversationManager

**Goal:** Service-Klasse für Konversations-Lebenszyklus: Erstellen, Nachrichten hinzufügen, Verlauf abrufen, TTL-Expiry.

**Requirements:** R3, R4, R6, R12

**Dependencies:** U2 (Migration)

**Files:**
- Create: `server/src/chat/manager.ts`
- Test: `server/src/chat/__tests__/manager.test.ts`

**Approach:**
- `ConversationManager`-Klasse mit Dependency auf `getDb()` (wie `TaskTracker`, `WorkflowTracker`)
- `getOrCreate(conversationId?: string, projectId?: string): string` — gibt bestehende oder neue ID zurück
- `addMessage(convId: string, role: 'user'|'assistant'|'system', content: string, type?: string, attachments?: Attachment[]): void` — persistiert in SQLite + updated `last_activity_at`
- `getHistory(convId: string, limit?: number): ChatMessage[]` — gibt letzten N Nachrichten zurück (Default: 50)
- `getConversation(convId: string): Conversation | null` — Konversations-Metadaten
- `expireStale(): number` — löscht Konversationen älter als 24h seit `last_activity_at`, gibt Anzahl zurück
- TTL als Konstruktor-Parameter mit Default `24 * 60 * 60 * 1000`

**Execution note:** Test-first: Schreibe Tests für `getOrCreate`, `addMessage`, `getHistory` vor der Implementierung.

**Patterns to follow:**
- `server/src/tasks/tracker.ts` — Service-Klasse mit `getDb()`-Zugriff, `create`/`list`/`update`-Methoden
- `server/src/memory/engine.ts` — `remember`/`recall`-Pattern für Key-Value-Persistenz

**Test scenarios:**
- Happy path: `getOrCreate()` ohne ID erzeugt neue Konversation mit UUID
- Happy path: `getOrCreate()` mit existierender ID gibt selbe ID zurück
- Happy path: `addMessage()` persistiert und updated `last_activity_at`
- Happy path: `getHistory()` gibt Nachrichten chronologisch zurück
- Covers AE2: `getHistory()` mit existierender conversationId gibt vorherige Nachrichten zurück
- Edge case: `getOrCreate()` mit nicht-existenter ID erzeugt neue Konversation (Graceful Degradation)
- Edge case: `getHistory()` mit Limit 5 gibt max 5 Nachrichten
- Edge case: `expireStale()` löscht nur Konversationen älter als TTL, nicht aktive
- Edge case: `expireStale()` löscht kaskadierend alle `chat_messages` der expired Konversation
- Error path: Datenbank-Fehler bei `addMessage` → wirft Error (Caller fängt)

**Verification:**
- Test-Suite: Alle Manager-Tests grün mit temporärer Test-DB
- `expireStale()` gibt korrekte Anzahl gelöschter Konversationen zurück

---

### U4. DirectRouter — Keyword-to-Tool Mapping

**Goal:** Keyword-basierte Zuordnung von Chat-Nachrichten zu M6-Tools. Kein LLM.

**Requirements:** R5

**Dependencies:** U1 (Schemas)

**Files:**
- Create: `server/src/chat/direct-router.ts`
- Test: `server/src/chat/__tests__/direct-router.test.ts`

**Approach:**
- `DirectRouter`-Klasse mit statischer Keyword→Tool-Map
- `tryRoute(message: string): { tool: string; args: Record<string, unknown> } | null` — tokenisiert die Nachricht, matched gegen Keywords, extrahiert Argumente (z.B. Agent-Name, Status)
- Keyword-Map basierend auf den 18 M6-Tools:
  - `query_tasks`: "zeig tasks", "welche tasks", "failed tasks", "tasks von", "status"
  - `create_task`: "erstell task", "neuer task", "mach einen task"
  - `run_workflow`: "start workflow", "führ workflow aus", "trigger", "deploy"
  - `list_workflows`: "welche workflows", "zeig workflows"
  - `search_memory`: "erinner", "was weißt du über", "memory", "facts"
  - `remember_fact`: "merk dir", "speicher"
  - `list_agents`: "welche agents", "zeig agents", "agent status"
  - `get_cost_summary`: "kosten", "cost", "token verbrauch"
  - `list_skills`: "welche skills", "zeig skills"
  - `delete_fact`: "lösch fact", "vergiss", "delete memory", "entfern fact"
  - `list_pending_gates`: "gates", "genehmigung", "approval"
  - `list_goals`: "goals", "ziele"
  - `list_events`: "events", "aktivität", "was ist passiert"
  - `query_tasks`: "blocked", "needs review", "pending"
- Argument-Extraktion: erkennt Agent-Namen, Projekt-Namen, Status-Werte via einfachem Regex
- Gibt `null` zurück wenn kein Match → Caller routet an NL Decomposer

**Execution note:** Test-first: Schreibe Tests mit konkreten Chat-Nachrichten und erwarteten Tool-Mappings vor der Keyword-Map.

**Patterns to follow:**
- `server/src/routing/router.ts` — `resolveAgent()` Tokenisierung + Keyword-Matching

**Test scenarios:**
- Happy path: "Zeig alle failed Tasks" → `{ tool: "query_tasks", args: { status: "failed" } }`
- Happy path: "Welche Agents gibt es?" → `{ tool: "list_agents", args: {} }`
- Happy path: "Start den weekly-article Workflow" → `{ tool: "run_workflow", args: { name: "weekly-article" } }`
- Covers AE1: "Welche Tasks sind failed?" → `query_tasks` mit `status: "failed"`
- Edge case: "Was ist kaputt?" → `null` (kein Keyword-Match, fällt an NL Decomposer)
- Edge case: "Erinner mich an den Bug von letzter Woche" → `search_memory` mit passendem Query
- Edge case: Leere Nachricht → `null`
- Edge case: "Deploy" ohne Workflow-Namen → `null` (unvollständig, NL Decomposer fragt nach)
- Happy path: Deutsche Keywords matchen genauso wie englische

**Verification:**
- Test-Suite: Alle Router-Tests grün
- Keine False Positives: uneindeutige Nachrichten geben `null` zurück (nicht raten)

---

### U5. Chat SSE Route — `POST /api/v1/chat`

**Goal:** Hono-Route-Factory, die Chat-Nachrichten entgegennimmt, DirectRouter → NLDecomposer-Pipeline ausführt, und Ergebnisse als SSE-Stream zurücksendet.

**Requirements:** R1, R2, R3, R5, R6, R7, R8

**Dependencies:** U1, U3, U4

**Files:**
- Create: `server/src/api/routes/chat.ts`
- Test: `server/src/api/routes/__tests__/chat.test.ts`

**Approach:**
- Factory-Funktion: `createChatRoute(conversationManager, directRouter, decomposer, toolExecutor, agents, eventBuffer)`
- **Heartbeat-Risiko:** Während `decomposer.decompose()` blockiert (bis 120s Timeout), kann der `ReadableStream`-interne `setInterval`-Heartbeat nicht feuern — `start()` ist synchron und das Promise blockiert. Der `thinking`-Event wird sofort emittiert; Heartbeats setzen nach Rückkehr der Decomposition wieder ein. Bei sehr langen Decompositionen (>60s) können Proxies/nginx den Stream timeouten. Eine spätere Iteration kann Decomposition in einen separaten Prozess auslagern und per Queue in den Stream schreiben.
- POST-Handler:
  1. Body mit `ChatRequestSchema` validieren
  2. Konversation via `conversationManager.getOrCreate()` auflösen
  3. User-Nachricht via `conversationManager.addMessage()` persistieren
  4. SSE-Stream starten (`ReadableStream` + `TextEncoder`, nach `events.ts`-Muster)
  5. Pipeline im Stream:
     a. `emit('thinking', { message: '...' })` — Status-Signal
     b. `directRouter.tryRoute(message)` — falls Match: `emit('tool_call', ...)`, `toolExecutor.execute()`, `emit('tool_result', ...)`, `emit('message', ...)`
     c. Falls kein Match: `decomposer.decompose(message, agents)` → `emit('message', { subtype: 'plan_proposal', plan })` — Plan zur Bestätigung
     d. `emit('done', { conversationId })`
  6. Assistant-Nachricht via `conversationManager.addMessage()` persistieren
  7. Error-Handling: `emit('error', { code, message })` im catch-Block
- Heartbeat: `: heartbeat\n\n` alle 15s (wie `events.ts`)
- Cleanup: `AbortSignal`-Listener für Client-Disconnect

**Execution note:** Test-first: Schreibe Integration-Tests für den SSE-Stream (parsen der Events, prüfen der Typen und Daten) vor der Route-Implementierung.

**Patterns to follow:**
- `server/src/api/routes/events.ts` — `ReadableStream`-SSE-Muster, Heartbeat, Cleanup
- `server/src/api/routes/nl.ts` — NL-Decomposer-Aufruf, Error-Handling
- `server/src/api/routes/tasks.ts` — Route-Factory mit Dependency-Injection

**Test scenarios:**
- Covers AE1: One-shot Command ohne conversationId → SSE-Stream mit `tool_call`, `tool_result`, `message`, `done`
- Covers AE2: Nachricht mit conversationId → vorheriger Kontext wird genutzt
- Covers AE3: NL-Decomposition → `thinking`, `message` mit `plan_proposal` subtype
- Covers AE4: Nachricht mit Bild-Attachment → wird an Decomposer weitergegeben
- Happy path: Einfacher Befehl matched DirectRouter, kein LLM
- Happy path: Komplexes Briefing matched nicht, fällt an NL Decomposer
- Happy path: `done`-Event enthält conversationId
- Edge case: Ungültiger JSON-Body → `400` (kein SSE-Stream)
- Edge case: Leeres `message`-Feld → `400`
- Edge case: Client disconnect während Stream → Cleanup via AbortSignal
- Edge case: NL Decomposer wirft Error → `error`-Event im Stream, nicht 500
- Error path: `toolExecutor.execute()` wirft → `error`-Event mit Tool-Namen
- Covers F2 Steps 6-8: User sendet `confirm: true` oder `modifications: "Füg Tests hinzu"` → Server re-kallt NL Decomposer mit vorherigem Plan als Kontext → updated Plan wird gestreamt
  - Integration: Heartbeat-Kommentare erscheinen im Stream (nicht als Events parse-bar)
- Integration: Zwei parallele Requests mit selber conversationId → zweiter Request sieht vorherige Nachricht im Verlauf

**Verification:**
- `curl -X POST /api/v1/chat -d '{"message":"Zeig alle Agents"}'` → SSE-Stream mit korrekten Events
- `curl -X POST /api/v1/chat -d '{"message":"Bau eine Landing Page"}'` → SSE-Stream mit `plan_proposal`
- Alle Route-Tests grün

---

### U6. Server Integration & TTL Cleanup

**Goal:** `ConversationManager`, `DirectRouter` und Chat-Route in `index.ts` verdrahten. TTL-Cleanup-Intervall einrichten.

**Requirements:** R4

**Dependencies:** U2, U3, U4, U5

**Files:**
- Modify: `server/src/index.ts`

**Approach:**
- `ConversationManager` nach DB-Init instanziieren
- `DirectRouter` instanziieren
- `createChatRoute(...)` mit allen Dependencies aufrufen und via `app.route('/api/v1/chat', ...)` mounten
- TTL-Cleanup: `setInterval(() => conversationManager.expireStale(), 60 * 60 * 1000)` (stündlich, analog zu bestehenden Cleanup-Intervallen)
- Logging: `logger.info({ deleted }, 'Chat conversations TTL cleanup')` bei Cleanup mit >0 deletions
- Export `conversationManager` für zukünftige Client-Adapter (Telegram Bot etc.)

**Patterns to follow:**
- `server/src/index.ts` — bestehende Route-Mounts, `setInterval`-TTL-Cleanups (session_messages, events)

**Test scenarios:**
- Happy path: Server startet ohne Fehler mit Chat-Route
- Happy path: `GET /health` zeigt Server als healthy
- Integration: `POST /api/v1/chat` ist nach Server-Start erreichbar
- Integration: `conversationManager` wird exportiert (von `startServer()` returned)

**Verification:**
- `npm run dev` im server-Verzeichnis startet ohne Fehler
- `curl -X POST http://localhost:PORT/api/v1/chat -H 'Content-Type: application/json' -d '{"message":"Zeig alle Agents"}'` liefert SSE-Stream
- TTL-Cleanup-Log erscheint nach Ablauf des ersten Intervalls im Log

---

## System-Wide Impact

- **Interaction graph:** Neue Route `/api/v1/chat` → nutzt `NLDecomposer`, `ToolExecutor`, `SkillRouter` (via DirectRouter), `EventBuffer` (für Logging). Keine Änderungen an bestehenden Routes.
- **Error propagation:** Chat-Fehler werden als `error`-SSE-Event gestreamt, nicht als HTTP-500. Bestehende Error-Handling-Patterns bleiben unverändert.
- **State lifecycle risks:** `ConversationManager` hält in-memory state. Bei Server-Neustart gehen nur nicht-persistierte Nachrichten verloren (geschrieben vor Stream-Start). Persistenz erfolgt synchron via SQLite.
- **API surface parity:** Chat-Protokoll ist additiv. Bestehende REST-API (`/api/v1/tasks`, `/api/v1/nl`, etc.) bleibt unverändert.
- **Integration coverage:** SSE-Stream-Parsing muss mit verschiedenen SSE-Client-Implementierungen getestet werden (EventSource API, node-fetch, curl).
- **Unchanged invariants:** NL Decomposer, ToolExecutor, AgentSessionManager — alle unverändert. Chat-Protokoll ist ein neuer Consumer, kein Modifier.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| SSE-Stream bricht auf Client-Disconnect nicht sauber ab → Ressourcen-Leak | `AbortSignal`-Listener wie in `events.ts`; Cleanup im `finally`-Block |
| Keyword-Matching produziert False Positives → falsches Tool wird aufgerufen | DirectRouter gibt `null` zurück bei Unsicherheit; NL Decomposer als Fallback |
| NL Decomposer ist langsam (LLM-Latenz) → User wartet auf `thinking`-Event | `thinking`-Event wird sofort emittiert, damit Client "wird verarbeitet..." anzeigen kann |
| Conversation-TTL ist zu kurz → User verliert Kontext zwischen Sessions | 24h Default ist konservativ; über Konfiguration anpassbar machen (spätere Iteration) |
| 4 Clients parsen SSE-Events unterschiedlich → Shape-Änderung bricht alle | Zod-Schemas mit `version`-Feld von Tag 1; Client-Adapter validieren Events vor Verarbeitung |

---

## Documentation / Operational Notes

- Chat-Protokoll-Spezifikation (SSE-Event-Typen, MIME-Types, Routing-Logik) als `docs/solutions/`-Eintrag nach Stabilisierung
- `README.md` um Chat-API-Beispiele ergänzen (curl one-shot, curl multi-turn)

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-11-chat-protocol-requirements.md](../brainstorms/2026-05-11-chat-protocol-requirements.md)
- Related code: `server/src/api/routes/events.ts`, `server/src/api/routes/nl.ts`, `server/src/agents/tool-executor.ts`, `server/src/routing/router.ts`
- Related learnings: `docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`, `docs/solutions/integration-issues/api-response-shape-change-breaks-consumers-2026-05-09.md`, `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md`
