---
title: "feat: Agent-Native Task Feed (Inbox)"
type: feat
status: completed
date: 2026-05-07
origin: docs/brainstorms/2026-05-07-agent-native-task-feed-requirements.md
---

# feat: Agent-Native Task Feed (Inbox)

## Summary

Der Plan erweitert pragents um einen agent-nativen Task-Feed: eine priorisierte Inbox-Ansicht im Web-UI, die Agent-Intents (Gates, Reviews, Blockaden) auf einen Blick sichtbar macht. Dazu werden das Task-Modell um `blocked`-Status und strukturierte Reasons erweitert, Gate-Status-Änderungen mit Events versehen, Agent-Tools angepasst und ein dedizierter `GET /api/v1/feed`-Endpunkt sowie eine Feed-UI-Komponente gebaut. Die bestehende Architektur (Hono-Routes, TanStack Query, UnoCSS, EventBuffer) wird konsequent weiterverwendet.

---

## Problem Frame

pragents bietet bereits ein Task-Modell mit `needs_review`-Status und Human Gates — aber keinen Ort, an dem der Agency Owner auf einen Blick sieht, welche Agenten gerade seine Aufmerksamkeit brauchen. Tasks und Gates sind getrennt, es fehlt ein strukturiertes Intent-Konzept („blockiert", „Review nötig", „Gate wartet"), und die Web-UI zeigt eine flache Task-Liste ohne Priorisierung. Siehe Origin-Dokument für die vollständige Problemstellung.

---

## Requirements

- **R1.** `TaskStatus` um `blocked` erweitern; Tasks können als blockiert markiert werden
- **R2.** Feed gruppiert: (1) offene Gates, (2) needs_review, (3) blocked, (4) kürzlich abgeschlossen
- **R3.** Web-UI: dedizierte Feed-Ansicht mit Badges, Agent/Projekt-Info, Kurzbeschreibung, relativen Timestamps
- **R4.** Offene Human Gates erscheinen im Feed mit Approve/Reject-Buttons
- **R5.** Feed-Filter: nach Projekt, Agent, Intent-Typ
- **R6.** Abgeschlossene Tasks/Gates in „Kürzlich abgeschlossen"-Sektion
- **R7.** `query_tasks`-Tool-Filter um `needs_review` und `blocked` erweitern
- **R8.** Neues Agent-Tool `list_pending_attention`
- **R9.** `create_task`-Tool erlaubt direktes Setzen von `needs_review`-Status
- **R10.** Task-Modell bereitet externen Tracker-Adapter vor (`external_ref`-Feld)
- **R11.** `setNeedsReview` akzeptiert strukturiertes `reason`-Feld

**Origin actors:** A1 (Agency Owner), A2 (Agent: Dev/SEO/Content/PM/Office), A3 (pragents Server)
**Origin flows:** F1 (Agent signalisiert Review nötig), F2 (Agent stößt an Human Gate), F3 (Human verschafft sich Überblick), F4 (Agent fragt nach Input)
**Origin acceptance examples:** AE1 (covers R1, R2), AE2 (covers R3, R6), AE3 (covers R4, R5), AE4 (covers R7, R8), AE5 (covers R1, R11)

---

## Scope Boundaries

- Kein externer Issue-Tracker (Plane, Linear, GitHub Issues) in dieser Version
- Keine Kanban-Boards, Cycles, Sprints, Estimates, Time Tracking
- Kein Kunden-Zugriff auf den Feed
- Keine Migration bestehender Tasks
- Das TanStack-Router-Migration (routes/ → main.tsx) wird nicht abgeschlossen; die Feed-UI wird in die monolithische main.tsx eingebaut, konsistent mit dem aktuellen Rendering-Pfad
- Kein Echtzeit-Push für Feed-Updates (Polling + SSE-Invalidation reichen)
- Keine Task-Kommentare oder Multi-User-Interaktion

### Deferred to Follow-Up Work

- TanStack-Router-Migration abschließen (main.tsx durch file-based routes ersetzen) — separates Refactoring
- Externer Tracker-Adapter (Plane/Linear) implementieren, sobald R10 (`external_ref`-Feld) etabliert ist — separates Feature

---

## Context & Research

### Relevant Code and Patterns

- **TaskTracker:** `server/src/tasks/tracker.ts` — `TaskStatus`-Enum, `setNeedsReview()`, `setRunning()`, etc. Pattern für neue `setBlocked()`-Methode
- **Tool Definitions:** `server/src/agents/tool-definitions.ts` — TypeBox-Schema-Pattern für neue/extended Tools
- **Tool Executor:** `server/src/agents/tool-executor.ts` — `case`-Switch für neue Tool-Handler, dispatch-Logik für `create_task`
- **API Routes:** `server/src/api/routes/tasks.ts`, `gates.ts` — Hono-Factory-Pattern für neue Feed-Route; Gate-Routen für Event-Emissions
- **Database Migrations:** `server/src/db/migrations/006_human_gates.sql` — Pattern für neue Migration `008_task_feed.sql`
- **Web UI:** `web/src/main.tsx` — monolithischer SPA-Einstiegspunkt, `view`-State-Switch, UnoCSS-Utility-Klassen, `useQuery`-Pattern
- **Task List UI:** `web/src/main.tsx` (Tasks-View) — Status-Badge-Pattern mit Farb-Map, Polling-Intervall
- **SSE Hook:** `web/src/hooks/useSSE.ts` — Event-Stream-Verbindung mit Reconnect-Logik
- **EventBuffer:** `server/src/events/buffer.ts` — `push()`-Pattern für neue Event-Typen

### Institutional Learnings

- **Unbounded Listener Leak (high):** SSE/WebSocket-Listener-Arrays wachsen unbegrenzt bei Reconnects → Feed-Komponente muss Listener beim Unmount clearen und Reconnect-Limit (15) setzen. Siehe `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md`.
- **ToolExecutor Pattern (medium):** Neue Tools müssen sowohl in `tool-definitions.ts` (TypeBox-Schema) als auch in `tool-executor.ts` (case-Handler) registriert werden. Service-Logik nicht duplizieren — Tools rufen bestehende Tracker/Engine-Methoden. Siehe `docs/plans/2026-05-07-005-feat-pragents-m6-agent-tooling-plan.md`.
- **Hono Route Factory (medium):** API-Routen als Factory-Funktionen mit Dependency Injection, eine Datei pro Resource, Plural-Nomen. Siehe `AGENTS.md` und M1-Core-Plan.

### External References

Keine — der Codebase hat starke lokale Patterns für alle betroffenen Bereiche.

---

## Key Technical Decisions

- **Dedizierter Feed-Endpoint statt Client-Konsolidierung:** `GET /api/v1/feed` aggregiert Gates + Tasks serverseitig und liefert vor-gruppierte, priorisierte Ergebnisse. Begründung: R10 verlangt eine API-Abstraktion, die später einen Tracker-Adapter aufnehmen kann. Der Endpoint ist diese Abstraktionsgrenze. Das `traces`-Aggregat im Codebase ist das Vorbild.
- **`reason`-Spalte statt `result`-Überladung:** `setNeedsReview(reason)` und das neue `setBlocked(reason)` schreiben in eine dedizierte `reason TEXT`-Spalte. `result` bleibt für Abschluss-Outputs reserviert. Begründung: R11 verlangt strukturierte Reasons; Überladung von `result` zwingt den Feed zu client-seitiger Heuristik („ist das ein Review-Grund oder ein Ergebnis?").
- **`blocked`-Übergänge:** Von `blocked` sind erlaubt: → `pending` (Entblockung durch Human), → `needs_review` (Eskalation), → `failed` (aufgegeben). Nicht erlaubt: → `complete` (kein Überspringen der Arbeit). Begründung: `blocked` ist ein Warte-Zustand — die Arbeit wurde nicht gemacht, also kann sie nicht „complete" sein.
- **Gate-Event-Emissions:** Gate-Status-Änderungen (approve, reject, timeout) emittieren Events via EventBuffer. Begründung: Der Feed zeigt Approve/Reject-Buttons (R4); nach Klick muss das Item sofort aus „pending gates" verschwinden, ohne auf den nächsten Poll-Zyklus zu warten.
- **Feed-UI im monolithischen main.tsx:** Die Feed-Ansicht wird als neuer `view`-State in main.tsx integriert, parallel zu den bestehenden Views (dashboard, tasks, workflows etc.). Begründung: Die TanStack-Router-Migration ist nicht Teil dieses Features und main.tsx ist der aktive Rendering-Pfad. Ein `routes/feed/index.tsx` wird zusätzlich angelegt für die geplante Router-Migration, aber zunächst nicht importiert.
- **`list_pending_attention` scoped auf eigenes Projekt + eigene blocked-Tasks:** Das Tool liefert: (a) alle offenen Gates für das Projekt, (b) alle `needs_review`-Tasks für das Projekt, (c) nur die `blocked`-Tasks des aufrufenden Agenten. Begründung: AE4 sagt explizit „keine blocked-Tasks anderer Agents". Die eigenen Blocked-Tasks braucht der Agent, um zu wissen, worauf er selbst wartet.

---

## Open Questions

### Resolved During Planning

- **Q1 (blocked-Übergänge):** → `pending`, `needs_review`, `failed`. Siehe Key Technical Decisions.
- **Q2 (create_task mit needs_review):** Ja, `dispatchTask()` wird übersprungen, wenn `status=needs_review`. Der Task ist eine Nachricht an den Menschen, keine Arbeitsaufgabe für einen Agenten.
- **Q3 (Gate-Events):** Ja, werden emittiert. Siehe Key Technical Decisions.
- **Q4 (Feed-Endpoint):** Dedizierter `GET /api/v1/feed`. Siehe Key Technical Decisions.
- **Q5 (list_pending_attention-Scope):** Projekt-weite Gates + needs_review, eigene blocked-Tasks. Siehe Key Technical Decisions.
- **Q6 (reason-Spalte):** Dedizierte `reason TEXT`-Spalte. Siehe Key Technical Decisions.
- **Q7 (Event-Typen):** Neue Typen: `task.blocked`, `gate.approved`, `gate.rejected`, `gate.timed_out`. Existierende: `task.complete`, `task.failed`, `task.needs_review` (bereits emittiert), `workflow.human_gate_pending`.
- **Q8 (Server-Restart-Fenster):** Akzeptiert als bekannte Limitation. Feed holt Daten primär via REST; SSE ist supplementär. Bei Reconnect wird ein REST-Refetch getriggert.

### Deferred to Implementation

- Exaktes CSS-Layout der Feed-Komponente (UnoCSS-Klassen, responsive Details)
- Präzise Farbwahl für `blocked`-Badge (neben bestehenden: grün/blau/rot/amber/grau)
- Threshold für „kürzlich abgeschlossen" (wie viele Items, wie alt maximal)
- Exakte Formatierung der relativen Timestamps („vor 5 min" vs. „vor 5 Minuten")

---

## Implementation Units

### U1. Database Migration: `blocked`-Status, `reason`- und `external_ref`-Spalten

**Goal:** Die `tasks`-Tabelle um die neuen Felder erweitern, ohne bestehende Daten zu verlieren.

**Requirements:** R1, R10, R11

**Dependencies:** None

**Files:**
- Create: `server/src/db/migrations/008_task_feed.sql`
- Modify: `server/src/db/sqlite.ts` (keine Änderung nötig — `initDb()` läuft Migrationen automatisch)

**Approach:**
- Neue Migration `008_task_feed.sql` mit drei Operationen:
  1. `ALTER TABLE tasks ADD COLUMN reason TEXT` (nullable, für R11)
  2. `ALTER TABLE tasks ADD COLUMN external_ref TEXT` (nullable, für R10)
  3. Tabelle `tasks_v2` mit erweitertem CHECK-Constraint erstellen, Daten kopieren, alte Tabelle droppen, umbenennen:
     ```sql
     CREATE TABLE tasks_v2 (
       ... -- alle Spalten wie original, plus reason, external_ref
       CHECK(status IN ('pending','running','complete','failed','needs_review','blocked'))
     );
     INSERT INTO tasks_v2 SELECT id, project_id, agent_id, status, description, result, NULL, NULL, created_at, updated_at FROM tasks;
     DROP TABLE tasks;
     ALTER TABLE tasks_v2 RENAME TO tasks;
     ```
- SQLite unterstützt kein `ALTER TABLE ... ALTER CONSTRAINT` — der CREATE-TABLE-Neuaufbau ist der Standard-Weg
- Migration ist idempotent durch das `_migrations`-Tracking
- Zusätzliches einmaliges Update für existierende `needs_review`-Tasks: `UPDATE tasks SET reason = result WHERE status = 'needs_review' AND result IS NOT NULL` — verhindert Split-Brain zwischen `result` (alte Schreibweise) und `reason` (neue Spalte)

**Patterns to follow:**
- `server/src/db/migrations/006_human_gates.sql` — gleiches Muster: CREATE TABLE, INSERT, DROP, RENAME

**Test scenarios:**
- Happy path: Migration läuft auf frischer DB — Tabelle hat `blocked` im CHECK, `reason`- und `external_ref`-Spalten
- Happy path: Migration läuft auf DB mit existierenden Tasks — alle Daten erhalten, neue Spalten sind NULL
- Edge case: Migration wird zweimal ausgeführt (idempotent via `_migrations`-Tracking — wird übersprungen)
- Error path: Wenn `tasks_v2`-Erstellung fehlschlägt (z.B. Disk voll), bleibt die originale `tasks`-Tabelle intakt (kein DROP vor erfolgreichem INSERT)
- Integration: `TaskTracker.create()` erstellt weiterhin Tasks mit `status='pending'` nach der Migration

**Verification:**
- `sqlite3 ~/.pragents/data/pragents.db "PRAGMA table_info(tasks)"` zeigt `reason` und `external_ref` als Spalten
- `sqlite3 ~/.pragents/data/pragents.db "INSERT INTO tasks (...) VALUES (..., 'blocked', ...)"` schlägt nicht fehl
- Existierende Tasks haben `reason IS NULL` und `external_ref IS NULL`

---

### U2. TaskTracker: `setBlocked()`-Methode und `reason`-Spalten-Unterstützung

**Goal:** `TaskTracker` um den neuen `blocked`-Status und das dedizierte `reason`-Feld erweitern.

**Requirements:** R1, R11

**Dependencies:** U1

**Files:**
- Modify: `server/src/tasks/tracker.ts`
- Modify: `server/src/tasks/__tests__/tracker.test.ts`

**Approach:**
- `TaskStatus`-Type um `'blocked'` erweitern
- `Task`-Interface um `reason?: string` und `externalRef?: string` ergänzen
- `create()`-Methode: neue Felder in INSERT und Return-Wert aufnehmen (initial NULL)
- `get()` und `list()`: neue Spalten in SELECT und Mapping aufnehmen
- Neue Methode `setBlocked(taskId: string, reason: string)`: `UPDATE tasks SET status = 'blocked', reason = ?, updated_at = ? WHERE id = ?`
- `setNeedsReview(taskId, reason)`: umschreiben auf `reason`-Spalte statt `result`-Spalte
  - BREAKING: bestehende Aufrufer, die `result` für den Reason lesen, müssen migriert werden. Betroffene Stellen:
    - `server/src/agents/tool-executor.ts` (liest `task.result` zur Anzeige) → muss stattdessen `task.reason` lesen
    - `server/src/api/routes/tasks.ts` (liest `t.result` in API-Response) → `reason`-Feld zur Response hinzufügen
- `recoverStaleTasks()`: auf `reason`-Spalte umstellen — `UPDATE tasks SET status = 'needs_review', reason = ?, updated_at = ? WHERE status = 'running'` (statt `result`)
- `create()`-Methode: `TaskCreate`-Interface um optionales `status?: TaskStatus` erweitern (default `'pending'`), damit U4 Tasks direkt mit `needs_review`-Status erstellen kann
- Event-Emission: `setBlocked()` und die API/Tool-Schicht, die `setNeedsReview()` aufruft, emittieren Events (`task.blocked`, `task.needs_review`) via EventBuffer. Die Emission folgt dem bestehenden Pattern aus `server/src/index.ts` (dort werden `task.complete`/`task.failed`-Events nach Tracker-Aufrufen gepushed)

**Patterns to follow:**
- `setComplete()`, `setFailed()`, `setNeedsReview()` in `tracker.ts` — identisches UPDATE-Pattern für `setBlocked()`

**Test scenarios:**
- Happy path: `setBlocked('task-1', 'Warte auf API-Zugang')` → `get('task-1').status === 'blocked'` und `reason === 'Warte auf API-Zugang'`
- Happy path: `setNeedsReview('task-2', 'PR bitte reviewen')` → `get('task-2').status === 'needs_review'` und `reason === 'PR bitte reviewen'`, `result` unverändert
- Edge case: `setBlocked` auf bereits `blocked`-Task → kein Fehler, Reason wird aktualisiert
- Edge case: `list()` gibt Tasks mit `reason` und `externalRef` korrekt zurück
- Integration: `create()` erstellt Task, `setBlocked()` ändert Status, `get()` liest `reason`

**Verification:**
- `TaskTracker`-Tests laufen alle grün
- `get(taskId).status` kann `'blocked'` sein
- `setNeedsReview(taskId, reason)` schreibt `reason` in `reason`-Spalte, nicht `result`

---

### U3. Gate-Event-Emissions

**Goal:** Gate-Status-Änderungen (approve, reject, timeout) emittieren Events via EventBuffer, damit der Feed ohne Polling auf Änderungen reagieren kann.

**Requirements:** R4 (Feed-Approve/Reject-Buttons brauchen sofortiges Feedback)

**Dependencies:** None (logisch unabhängig, kann parallel zu U1/U2 laufen)

**Files:**
- Modify: `server/src/api/routes/gates.ts` (Event-Emission bei approve/reject)
- Modify: `server/src/workflows/engine.ts` (Event-Emission bei timeout)
- Modify: `server/src/api/routes/__tests__/gates.test.ts` (oder neuer Test-File)
- Modify: `server/src/workflows/__tests__/engine.test.ts`

**Approach:**
- `createGatesRoute`-Factory bekommt `eventBuffer: EventBuffer` als zusätzliche Dependency
- `POST /:id/approve`-Handler: nach erfolgreichem `db.run("UPDATE ... SET status = 'approved'")` → `eventBuffer.push({ type: 'gate.approved', ... })`
- `POST /:id/reject`-Handler: analog → `eventBuffer.push({ type: 'gate.rejected', ... })`
- `WorkflowEngine.waitForGate()`: nach Timeout (`status = 'timed_out'`) → `eventBuffer.push({ type: 'gate.timed_out', ... })`
  - `WorkflowEngine` braucht Zugriff auf `EventBuffer` — als Constructor-Dependency oder via `waitForGate()`-Parameter
  - Da `WorkflowEngine` bereits in `startServer()` instanziiert wird, ist Constructor-Injection der sauberste Weg
- Event-Payload enthält `gateId`, `workflowRunId`, `stepId`, `projectId`, `agentId`
- Wiring in `server/src/index.ts`: `EventBuffer`-Instanz an `createGatesRoute(...)` und `WorkflowEngine`-Constructor übergeben

**Patterns to follow:**
- Event-Push in `server/src/index.ts` (Zeilen ~120-170): `eventBuffer.push({ type: 'task.complete', projectId, agentId, data: { ... } })` — identisches Payload-Schema
- Dependency Injection: `createGatesRoute(gateTracker, eventBuffer)` analog zu `createTasksRoute(tracker, agents, sessionMgr, eventBuffer)`

**Test scenarios:**
- Happy path: Gate-Approval emittiert `gate.approved`-Event mit korrektem `gateId`
- Happy path: Gate-Rejection emittiert `gate.rejected`-Event
- Happy path: Gate-Timeout emittiert `gate.timed_out`-Event nach Ablauf der Timeout-Dauer
- Edge case: Approve auf bereits approved-Gate → API gibt 400 zurück, kein Event emittiert
- Integration: Event erscheint im EventBuffer und wird via SSE/WS an Clients gebroadcasted

**Verification:**
- Nach `POST /api/v1/gates/:id/approve` enthält EventBuffer ein Event mit `type: 'gate.approved'`
- Nach Gate-Timeout enthält EventBuffer ein Event mit `type: 'gate.timed_out'`
- Bestehende Gate-Tests (approve/reject-API) laufen weiterhin

---

### U4. Agent-Tooling: query_tasks-Filter, list_pending_attention, create_task-Erweiterung

**Goal:** Agenten können `blocked`- und `needs_review`-Tasks abfragen, pending attention items listen und Tasks direkt mit `needs_review`-Status erstellen.

**Requirements:** R7, R8, R9

**Dependencies:** U2 (TaskTracker braucht `blocked`-Status und `reason`-Spalte)

**Files:**
- Modify: `server/src/agents/tool-definitions.ts`
- Modify: `server/src/agents/tool-executor.ts`
- Modify: `server/src/agents/__tests__/tool-executor.test.ts`

**Approach:**

**R7 — query_tasks-Filter erweitern:**
- In `tool-definitions.ts`: `status`-Parameter-Enum um `'needs_review'` und `'blocked'` ergänzen
- In `tool-executor.ts`: `case 'query_tasks'` — bereits generisch (filtert per `tracker.list()` + client-seitigem Status-Filter), keine Logik-Änderung nötig, da das Enum nur die Schema-Validierung betrifft

**R8 — list_pending_attention:**
- Neues Tool in `tool-definitions.ts`:
  ```ts
  {
    name: 'list_pending_attention',
    description: 'List all items waiting for human attention: pending gates, needs_review tasks, and your own blocked tasks. Use this before asking the human for input to avoid duplicates.',
    parameters: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] }
  }
  ```
- Neuer `case 'list_pending_attention'` in `tool-executor.ts`:
  - Query `human_gates WHERE status = 'pending'` (nur für das Projekt)
  - Query `tasks WHERE status = 'needs_review' AND project_id = ?`
  - Query `tasks WHERE status = 'blocked' AND project_id = ? AND agent_id = ?` (nur eigene)
  - Rückgabe als JSON mit drei Arrays: `{ gates: [...], needsReview: [...], blocked: [...] }`

**R9 — create_task mit needs_review:**
- In `tool-definitions.ts`: optionalen `status`-Parameter zu `create_task` hinzufügen mit `enum: ['pending', 'needs_review']`
- In `tool-executor.ts` `case 'create_task'`:
  - Wenn `status === 'needs_review'` → `tracker.create()` mit Status `needs_review`, dann `tracker.setNeedsReview(task.id, description)` (Reason = Description), **kein** `dispatchTask()`
  - Wenn kein Status oder `status === 'pending'` → bestehendes Verhalten (create + dispatch)

**Patterns to follow:**
- Tool-Definition: `query_tasks` in `tool-definitions.ts` — exakt gleiches Schema-Pattern
- Tool-Executor: `case 'query_tasks'` in `tool-executor.ts` — Tracker-Aufruf-Pattern

**Test scenarios:**
- Happy path: `query_tasks` mit `status=blocked` → gibt nur `blocked`-Tasks zurück
- Happy path: `list_pending_attention` → gibt Gates, needs_review-Tasks und eigene blocked-Tasks
- Happy path: `create_task` mit `status=needs_review` → Task hat Status `needs_review`, `dispatchTask` wurde nicht aufgerufen
- Covers AE4: `list_pending_attention` gibt keine `blocked`-Tasks anderer Agents zurück
- Edge case: `create_task` ohne `status`-Parameter → bestehendes Verhalten (pending + dispatch)
- Error path: `list_pending_attention` mit ungültigem `projectId` → leere Arrays

**Verification:**
- Agent kann `list_pending_attention` aufrufen und erhält strukturierte JSON-Response
- Agent kann Task mit `status=needs_review` erstellen; Task erscheint nicht als dispatched
- `query_tasks` mit `status=blocked` wird von der Schema-Validierung akzeptiert

---

### U5. Feed-API: `GET /api/v1/feed`

**Goal:** Dedizierter Endpoint, der Gates und Tasks zu einer priorisierten, gruppierten Feed-Response aggregiert.

**Requirements:** R2, R5, R10

**Dependencies:** U2 (TaskTracker-Erweiterung), U3 (Gate-Events — parallel lauffähig, aber Feed braucht die Daten)

**Files:**
- Create: `server/src/api/routes/feed.ts`
- Modify: `server/src/index.ts` (Route wiring)
- Create: `server/src/api/routes/__tests__/feed.test.ts`

**Approach:**
- Neue Route-Factory `createFeedRoute(tracker: TaskTracker, eventBuffer: EventBuffer)`:
  ```ts
  GET /api/v1/feed?project=<id>&agent=<id>&intent=<gates|review|blocked|completed>
  ```
- Response-Struktur:
  ```json
  {
    "gates": [{ "id": "...", "label": "...", "workflowName": "...", "stepId": "...", "createdAt": "...", "timeoutAt": "..." }],
    "needsReview": [{ "id": "...", "agentId": "...", "projectId": "...", "description": "...", "reason": "...", "createdAt": "..." }],
    "blocked": [{ "id": "...", "agentId": "...", "projectId": "...", "description": "...", "reason": "...", "createdAt": "..." }],
    "completedTasks": [{ "id": "...", "agentId": "...", "projectId": "...", "status": "complete|failed", "description": "...", "result": "...", "createdAt": "..." }],
    "completedGates": [{ "id": "...", "label": "...", "workflowName": "...", "status": "rejected|timed_out", "updatedAt": "..." }]
  }
  ```
- Query-Logik:
  - `gates`: `SELECT ... FROM human_gates WHERE status = 'pending' ORDER BY created_at DESC`
  - `needsReview`: `SELECT ... FROM tasks WHERE status = 'needs_review' ORDER BY created_at DESC`
  - `blocked`: `SELECT ... FROM tasks WHERE status = 'blocked' ORDER BY created_at DESC`
  - `completedTasks`: `SELECT ... FROM tasks WHERE status IN ('complete', 'failed') ORDER BY created_at DESC LIMIT 20`
  - `completedGates`: `SELECT ... FROM human_gates WHERE status IN ('rejected', 'timed_out') ORDER BY updated_at DESC LIMIT 20`
- Filter-Parameter (`project`, `agent`, `intent`) werden als optionale Query-Parameter in der SQL-WHERE-Clause angewendet
- `intent`-Filter schränkt die Response auf die angefragte Gruppe ein (für R5)

**Patterns to follow:**
- `server/src/api/routes/tasks.ts` — Hono-Factory, Query-Parameter, JSON-Response
- `server/src/api/routes/gates.ts` — Hono-Factory mit `gates/`-Präfix
- Wiring in `index.ts`: `app.route('/api/v1/feed', createFeedRoute(tracker, eventBuffer))`

**Test scenarios:**
- Happy path: `GET /api/v1/feed` gibt alle vier Gruppen mit korrekten Items
- Happy path: `GET /api/v1/feed?intent=gates` gibt nur das `gates`-Array
- Happy path: `GET /api/v1/feed?project=proj-1` filtert Tasks und Gates auf Projekt
- Covers AE2: Response-Reihenfolge ist gates → needsReview → blocked → completed (Client sortiert nach `createdAt` innerhalb der Gruppen)
- Edge case: Keine pending gates → `gates` ist leeres Array, kein 404
- Edge case: Keine Tasks im Projekt → alle Arrays leer
- Error path: Datenbank-Fehler → 500 mit `{ error: '...' }`

**Verification:**
- `curl localhost:3000/api/v1/feed` gibt 200 mit JSON-Struktur wie oben
- Filter `?project=proj-1` gibt nur Items für dieses Projekt
- `completedTasks`- und `completedGates`-Arrays sind auf je 20 Items limitiert

---

### U6. Feed-UI: Inbox-Ansicht im Web-UI

**Goal:** Neue Feed-Ansicht im Web-UI, die Agent-Intents priorisiert, gruppiert und filterbar darstellt, inklusive Approve/Reject-Buttons für Gates.

**Requirements:** R2, R3, R4, R5, R6

**Dependencies:** U5 (Feed-API-Endpoint)

**Files:**
- Modify: `web/src/main.tsx` (neuer Feed-View, Nav-Eintrag)
- Create: `web/src/routes/feed/index.tsx` (für spätere Router-Migration, zunächst nicht importiert)
- Create: `web/src/stores/feed.ts` (Zustand-Store für Feed-Filter-State)

**Approach:**

**main.tsx-Integration:**
- Neuer `view`-State-Wert `'feed'` zum existierenden `useState` hinzufügen
- Nav-Eintrag „Feed" (oder „Inbox") zwischen Dashboard und Tasks
- Neue Komponente `<FeedView>` rendert, wenn `view === 'feed'`

**FeedView-Komponente:**
- Daten-Fetching via TanStack Query:
  ```ts
  const { data } = useQuery({
    queryKey: ['feed', filters],
    queryFn: () => fetch(`${API}/api/v1/feed?${params}`).then(r => r.json()),
    refetchInterval: 5000,
  });
  ```
- SSE-Integration: `useSSE`-Hook abonnieren, `queryClient.invalidateQueries({ queryKey: ['feed'] })` bei relevanten Event-Types (gate.approved, gate.rejected, task.blocked, etc.)
- Gruppierte Darstellung (von oben nach unten):
  1. **„Warten auf dich"** — offene Gates: Karten mit Label, Workflow-Name, Approve/Reject-Buttons, Timeout-Countdown
  2. **„Review nötig"** — needs_review-Tasks: Karten mit Agent, Projekt, Reason-Text (erste ~120 Zeichen), relativem Timestamp
  3. **„Blockiert"** — blocked-Tasks: Karten mit Agent, Projekt, Reason, Timestamp, **Unblock-Button**
  4. **„Kürzlich abgeschlossen"** — completed/failed Tasks + rejected/timed_out Gates: kompaktere Karten mit Status-Badge und Timestamp
- **Karten-Interaktion:** Statt Navigation zu einer externen Task-Detail-View (die im monolithischen main.tsx-Rendering-Pfad nicht erreichbar ist), expandieren Karten inline: ein Klick öffnet eine erweiterte Ansicht unterhalb der Karte mit voller Description, Reason/Result, Agent-Info und Aktionen (Approve/Reject für Gates, Unblock für blockierte Tasks). Keine separate Route-Navigation.
- Approve/Reject-Buttons: `fetch()` an `/api/v1/gates/:id/approve` oder `/reject`, dann `queryClient.invalidateQueries`
- **Unblock-Button:** `fetch()` an `POST /api/v1/tasks/:id/unblock` (setzt Status auf `pending`, ruft `tracker.setPending()`), dann `queryClient.invalidateQueries`. Der Button ist nur auf blocked-Task-Karten sichtbar.
- **Loading-Zustand:** Beim ersten Laden (`isLoading`) werden die vier Gruppen-Header mit je 2-3 Skeleton-Karten (graue Platzhalter-Balken) gerendert. Bei Hintergrund-Updates (`isFetching`) bleibt die bestehende UI sichtbar — kein Spinner.

**Filter-Bar:**
- Dropdown/Select für `project` (Projekte aus Config/API)
- Dropdown für `agent` (Agenten aus Config)
- Button-Gruppe für `intent` („Alle", „Gates", „Review", „Blockiert", „Erledigt")
- Filter-State im neuen `feed.ts` Zustand-Store: `{ project?: string, agent?: string, intent?: string }`

**Badge-Styling:**
- `blocked`-Badge: neuer Farbwert (z.B. `bg-purple-100 text-purple-700`), konsistent mit bestehender Status-Badge-Farb-Map
- Intent-Badges für Feed-Gruppen: größer, Icon (z.B. `⏳` für Gates, `👀` für Review, `🚫` für Blockiert)

**SSE-Listener-Leak-Prävention:**
- `useSSE`-Hook oder manueller `EventSource`-Listener im `useEffect`-Cleanup clearen
- Max 15 Reconnects (siehe Institutional Learnings)
- Nach Reconnect: `queryClient.invalidateQueries({ queryKey: ['feed'] })` triggern

**Patterns to follow:**
- Task-Liste in `main.tsx` (Tasks-View) — `useQuery`, Status-Badges, `refetchInterval`
- Activity-Stream in `main.tsx` (Dashboard-View) — Event-Karten-Layout
- `web/src/stores/scope.ts` — Zustand-Store-Pattern für `feed.ts`

**Test scenarios:**
- Covers AE2: Feed zeigt Gate (2h) → Review (30min) → Trennlinie → Completed (5min) in korrekter Reihenfolge
- Covers AE3: Filter auf Projekt „kunde-a" zeigt nur Items für dieses Projekt
- Covers AE5: Feed-Karte für needs_review-Task zeigt Reason-Text „Bitte PR reviewen: auth-middleware refactored"
- Edge case: Leerer Feed (keine Gates, keine Tasks) → zeigt leere Zustands-Meldung pro Gruppe, keinen 404
- Edge case: Schnelles Approve/Reject-Klicken → Button wird disabled nach erstem Klick, verhindert Doppel-Submission
- Edge case: SSE reconnect → `useEffect`-Cleanup verhindert Listener-Duplizierung; nach 5 Mount/Unmount-Zyklen ist genau ein Listener aktiv
- Integration: Klick auf Task-Karte expandiert inline mit voller Description, Reason/Result und Aktionen (Unblock für blocked, Ergebnis-Anzeige für completed)

**Verification:**
- Feed-Ansicht ist unter dem „Feed"-Nav-Eintrag erreichbar
- Items sind korrekt gruppiert und nach `createdAt` sortiert
- Approve/Reject im Feed updated den Gate-Status und verschiebt das Item aus „pending gates"
- Filter reduzieren die angezeigten Items korrekt
- Nach Browser-Refresh ist der Feed-State (inkl. Filter) wiederhergestellt (via URL-Search-Params oder Store-Persistenz)

---

## System-Wide Impact

- **Interaction graph:** Feed-API (`GET /api/v1/feed`) aggregiert Tasks + Gates → neue Abfrage, die Tasks- und Gates-Tabellen joint. Feed-UI konsumiert Feed-API + Gate-API (approve/reject). Gate-API-Route bekommt `EventBuffer`-Dependency. WorkflowEngine bekommt `EventBuffer`-Dependency.
- **Error propagation:** Feed-API-Fehler (DB down) → UI zeigt leeren Feed mit Error-Banner. Gate-Approve/Reject-Fehler → UI zeigt Error-Toast, Button wird re-enabled. Tool-Ausführungsfehler → Agent erhält `Error: ...` String (bestehendes Pattern).
- **State lifecycle risks:** Migration U1 erstellt `tasks_v2` → bei Abbruch zwischen DROP und RENAME können Tasks verloren gehen. Risiko minimal (SQLite ist transaktional innerhalb einer Connection), aber Plan adressiert: original table bleibt bis nach erfolgreichem INSERT erhalten.
- **API surface parity:** `GET /api/v1/feed` ist neu. `GET /api/v1/tasks` wird nicht verändert (Rückwärtskompatibilität). `POST /api/v1/tasks` bleibt unverändert (needs_review-Creation geht nur via Agent-Tool, nicht via REST).
- **Integration coverage:** Feed-UI → Feed-API → TaskTracker + Human-Gates-DB → EventBuffer → SSE → Feed-UI (vollständiger Kreis). Unit-Tests decken jede Schicht einzeln; ein Integration-Test-Szenario (E2E-ähnlich) für den vollen Kreislauf ist wünschenswert, aber nicht Teil dieses Plans (Test-Infrastruktur für E2E existiert nicht).
- **Unchanged invariants:** `GET /api/v1/tasks` Response-Format unverändert. `TaskTracker.list()` unverändert. `create_task`-Tool ohne `status`-Parameter verhält sich identisch. Gate-API-Antworten unverändert (Events sind zusätzlich, ersetzen keine Responses).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Migration U1 (DROP + RENAME) schlägt auf Produktions-DB fehl | SQLite-Transaktion rollt zurück; originale Tabelle intakt. Vorher Backup der DB-Datei empfehlen |
| `setNeedsReview` schreibt jetzt in `reason` statt `result` — breaking change für API-Consumer | Alle betroffenen Stellen (tool-executor, tasks-API-Route) in U2 identifiziert und migriert |
| SS-Event-Listener-Leak in Feed-UI | Institutional Learning aus `multi-agent-review-bug-patterns` befolgt: Cleanup in useEffect, Reconnect-Limit 15, Test-Szenario in U6 |
| WorkflowEngine bekommt neue Dependency? (EventBuffer) | EventBuffer ist bereits eine bestehende Constructor-Dependency von WorkflowEngine mit `emit()`-Helper. U3 fügt nur einen `this.emit('gate.timed_out', ...)`-Aufruf im `waitForGate()`-Timeout-Pfad hinzu — keine neue Dependency, keine null-Safety nötig |
| Feed-UI-Komponente wächst main.tsx weiter auf → technische Schulden für Router-Migration | `routes/feed/index.tsx` wird parallel angelegt (U6), aber nicht importiert. Migration ist als Deferred to Follow-Up Work dokumentiert |

---

## Documentation / Operational Notes

- `AGENTS.md` braucht kein Update — die neuen Tools sind in der Tool-Tabelle bereits durch den generischen „Agent Tools (M6)"-Eintrag abgedeckt
- Die neue Migration `008_task_feed.sql` wird automatisch bei `initDb()` ausgeführt, kein manueller Eingriff nötig
- Nach Deployment: `sqlite3 ~/.pragents/data/pragents.db ".schema tasks"` prüfen, ob `reason`- und `external_ref`-Spalten existieren

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-07-agent-native-task-feed-requirements.md](../brainstorms/2026-05-07-agent-native-task-feed-requirements.md)
- Related code: `server/src/tasks/tracker.ts`, `server/src/agents/tool-definitions.ts`, `server/src/agents/tool-executor.ts`, `server/src/api/routes/gates.ts`, `server/src/workflows/engine.ts`, `web/src/main.tsx`
- Related plans: `docs/plans/2026-05-07-005-feat-pragents-m6-agent-tooling-plan.md`
- Institutional learnings: `docs/solutions/best-practices/multi-agent-review-bug-patterns-2026-05-07.md`
