---
title: pragents — Projekt-Analyse & Schwächen-Inventar
date: 2026-05-13
status: review
scope: konzept + umsetzung
reviewer: Claude (Opus 4.7)
---

# pragents — Projekt-Analyse & Schwächen-Inventar

## 1. Vision & Ziel (so wie es im Code und in den Docs steht)

**Quellen:** `STRATEGY.md`, `README.md`, `AGENTS.md`, `docs/superpowers/specs/2026-05-06-pragents-design.md`.

### Zielnutzer
Solo-Agenturbetreiber (1 Person, mehrere Client-Projekte gleichzeitig), die heute *in* der Agentur gefangen sind: Coding-Agents per Hand babysitten, Skills zwischen Projekten manuell syncen, Cross-Project-Kontext im Kopf halten.

### Versprechen
- **Persistent awareness across projects** — Agents lernen projektübergreifend; Skills kompoundieren.
- **Autonomous task completion** — Agents arbeiten ohne ständige Supervision.
- **Single source of truth** — pragents-Server kennt allen State; Web/Terminal/Telegram sind nur Clients.
- **Local-first, remote-ready** — embedded SQLite + LanceDB, alles unter `~/.pragents/`.

### Vier Tracks
1. **Autonomous Workflows** — wiederkehrende Mehrschritt-Pipelines.
2. **Office Operations** — Mail, Time, Invoice, Admin.
3. **Agent Memory & Coordination** — Wissen, das über Sessions hinweg trägt.
4. **Project Management** — PM-Agent als Cross-Project-Koordinator.

### Erfolgskriterien (self-reported außer letztes)
- Autonomous task completion rate
- Active projects per month
- Supervision hours per week
- Workflow reuse rate (aus DB)

### Architektur-Bet
Sidecar zu pi (`@mariozechner/pi-coding-agent`) per WebSocket-Bridge, lazy Agent-Spawn (10 min idle-Timeout), YAML-getriebene Konfiguration, Skills im agentskills.io-Standard mit `x-pragents-*`-Erweiterung. M1–M6 Milestones sind durch, M6 (Tool-Bridge mit 18 Plattform-Tools) ist live.

---

## 2. Konzeptuelle Schwächen

### K1. Die Erfolgsmetriken messen nicht das Kernversprechen
**Was fehlt:** Drei der vier Key Metrics sind *self-reported*. Die einzige objektive ("Workflow reuse rate") misst Wiederverwendung, aber **nicht ob die Wiederverwendung funktioniert hat**. Es gibt keine Metrik für:
- Skill-Erfolgsquote (wie oft führt Skill X zu approved Output?)
- Cross-Project-Memory-Hit-Rate (wird company-scope tatsächlich relevant gezogen?)
- Eskalationen pro Goal-Run (wie oft springt der PM-Agent ein?)
- Token-Kosten pro completed task

**Warum kritisch:** Ohne diese kannst du nicht entscheiden, ob "Compounding" passiert oder nur Datenmüll wächst.

### K2. "Compounding Skills" hat keinen Vergessen-Mechanismus
Skills werden auto-extrahiert (`skills/auto-extractor.ts`), dedupliziert per Similarity (default 0.8), aber **nie zurückgestuft**. Ein Skill, der einmal hilfreich war und jetzt fehlerhaft ist, lebt für immer als `active`. Es gibt keine Schwächungs-Schleife — kein "Skill wurde 5× rejected, zurück auf proposed".

### K3. Single-User-Annahme widerspricht "remote-ready"
- Kein Auth, keine Authz, keinerlei Token-Check auf `/api/*`, `/ws`, `/api/v1/events/stream`, `/api/v1/chat`.
- WebSocket-Broadcast streut alle Events an alle Clients (`server/src/api/ws.ts`).
- `chat/manager.ts` ist in-memory + global.

"Remote-ready" steht in der Architektur-Philosophie, aber keine einzige Code-Stelle bereitet das vor (kein `x-user-id` Header, keine Project-ACLs, kein Rate-Limit). Wenn du das Tool je außerhalb von localhost laufen lässt, ist es offen.

### K4. Memory-Scope-Modell ist sicherheitsblind
Scopes `company` / `project` / `agent` sind definiert, aber:
- Ein Agent mit `memory.company: 'read/write'` kann Fakten aus Projekt A in den company-Scope schreiben, die dann von einem Agent in Projekt B (Client B) gelesen werden.
- Es gibt keine PII-Klassifizierung, kein "Fact ist client-confidential".
- `memory/engine.ts:remember()` schreibt ohne Scope-Validierung gegen die `ResolvedAgent.memory`-Policy. Die Policy ist deklariert, aber nicht enforced.

**Risiko:** Bei mehreren Clients kannst du unbeabsichtigt vertrauliche Daten kreuzkontaminieren — und du wirst es nicht merken, weil "Cross-Project-Awareness" *ist* das Feature.

### K5. Token-Budget ist deklarativ, nicht durchgesetzt
`ResolvedAgent.tokenBudget` existiert (`config/schema.ts`), wird aber im Dispatch-Pfad (`agents/manager.ts`, `tool-executor.ts`, `nl/decomposer.ts`) **nirgendwo gegen tatsächliche Verbrauchszahlen geprüft**. CostTracker aggregiert nur retrospektiv. Ein Loop in einem Workflow kann unbegrenzt Geld verbrennen.

### K6. Lazy-Spawn + Cron-Goals = unsichtbare Cold-Start-Steuer
- Goals tickern via croner.
- Sessions sterben nach 10 Minuten Idle.
- Wenn ein Goal alle 5 min triggert und der Agent zwischen Triggern idle ist, baust du in der Regel **bei jedem Trigger eine pi-Session neu auf** (DefaultResourceLoader, Skills-Loading, System-Prompt-Assembly).
- Kein Pooling, kein Pre-Warm, kein Cap auf parallele Spawns.

Bei vier Tracks à mehrere Goals wird das zur Hauptlatenzquelle, ohne in der Strategie aufzutauchen.

### K7. Workflow-Engine: fail-fast verliert teure Teilarbeit
Parallel-Group nutzt `Promise.allSettled` mit fail-fast (`AGENTS.md`). Ein Step fällt aus → der Run bricht ab, die anderen Steps wurden bezahlt, das Ergebnis ist weg. Kein "continue-and-collect"-Modus, kein partielles Resume. Bei Workflows mit teuren research-Steps ist das ökonomisch schmerzhaft.

### K8. Pi-SDK-Kopplung ohne Abstraktionsschicht
Die ganze Identität ("Skills are pi-native", `customTools`, `DefaultResourceLoader`, `SessionManager.inMemory()`) hängt an pi v0.73+. `agents/manager.ts` greift sogar auf undokumentierte Internals zu (`(handle.session.agent as any)?.state?.messages`). Wenn pi sein Internal-Layout ändert, brennt der Persistence-Pfad lautlos (Best-Effort-Catch).

Es gibt keinen `AgentRuntime`-Interface-Layer, der pi austauschbar machen würde.

### K9. Intent-Classifier kann silent misroute
`chat/intent-classifier.ts` hat keinen Confidence-Score. Das Modell antwortet mit `{tool, args}` — aber wenn die Klassifikation falsch ist (z.B. `list_agents` statt `query_tasks`), läuft das falsche Tool durch, der User sieht ein scheinbar valides Ergebnis. Kein "bei Unsicherheit → complex/fallback".

### K10. PM-Agent-Eskalation ist fire-and-forget
`goals/scheduler.ts` ruft bei Deadline-Überschreitung `sessionMgr.dispatch(pmAgent, msg).catch(log)`. Es wird:
- nicht getrackt, ob die Eskalation angekommen ist,
- nicht getrackt, ob der PM was getan hat,
- nicht aufeskaliert wenn der PM selbst auch versagt.

Die PM-Logik ist als magisches "do the right thing"-Prompt formuliert. Das ist kein PM-System, das ist eine Hoffnung.

### K11. NL-Decomposer + Chat-Protokoll überlappen sich
- `/api/v1/nl/decompose` + `/api/v1/nl/execute` ist ein Plan-Approval-Flow.
- `/api/v1/chat` hat eine `plan_proposal`-Subtype, die fast dasselbe macht.
- `/api/v1/tasks` POST dispatcht direkt.

Drei Eingangstüren ins selbe System mit unterschiedlicher Semantik. Für einen Solo-User wahrscheinlich verwirrend, für agentische Selbst-Bedienung der Plattform (über die 18 Tools) eine Quelle für Inkonsistenz.

### K12. Auto-Skill-Approval ist Spannungsfeld ohne Auflösung
`autoApproveSkills: false` (default) → Inbox staut. `true` → Skill-Drift ohne Review. Es fehlt der dritte Weg: **gradierte Vertrauensstufen** ("auto-approve nur wenn Confidence > 0.9 und keine destruktiven `allowed-tools`"). Aktuell ist es ein binärer Switch.

---

## 3. Umsetzungs-Schwächen

### U1. `console.*` statt `pino` an mehreren Stellen
Eigene Konvention: "Never `console.log` in server code" (CLAUDE.md/AGENTS.md). Tatsächlich:
- `server/src/api/ws.ts` — `console.log('WebSocket endpoint ready...')`, `console.warn(...)`.
- `server/src/agents/manager.ts` — `console.error('[pragents] Failed to persist...')`.
- `server/src/goals/scheduler.ts` — `console.log('Goal "${goal.id}" scheduled...')`, `console.warn(...)`.

Strukturierte Logs verlieren so Kontext und brechen das Log-File-Parsing.

### U2. Zugriff auf pi-SDK-Internals ist nicht abgesichert
```ts
const messages = (handle.session.agent as any)?.state?.messages;
```
`server/src/agents/manager.ts` — die einzige Stelle, die Session-Verlauf persistiert. Wenn pi den Pfad umbenennt, scheitert die Persistenz **silent** (best-effort catch, nur `console.error`). Kein Test sichert diesen Pfad, kein CI-Check gegen pi-Versionssprung.

### U3. Goal-Cron ohne Overlap-Schutz
`goals/scheduler.ts.trigger()` prüft **nicht**, ob für dieses Goal bereits ein Run aktiv ist, bevor es erneut feuert. `activeGoalRuns` wird zwar gefüllt, aber nicht abgefragt. Ein langlaufender Workflow + häufige Cadence → überlappende Runs für dasselbe Goal → doppelte Eskalationen, doppelte Token-Kosten.

### U4. `approve_gate` Tool-Race
`agents/tool-executor.ts`:
```ts
const gate = db.prepare('SELECT status ...').get(gateId);
if (gate.status !== 'pending') return 'Error...';
db.prepare("UPDATE human_gates SET status = 'approved' WHERE id = ?").run(gateId);
```
Read + check + write ohne Transaction. Zwei parallele Approves (z.B. agent-driven + user-driven gleichzeitig) → beide sehen `pending`, beide schreiben `approved`. Auch wenn das Endergebnis idempotent erscheint, propagieren beide Erfolg-Events durch den EventBuffer.

### U5. Intent-Classifier baut pro Chat-Nachricht eine pi-Session auf
`chat/intent-classifier.ts`:
- `mkdtempSync(...)` für jeden Klassifizierungs-Call.
- `DefaultResourceLoader` mit allem disabled, dann `await loader.reload()`.
- `createAgentSession(...)`.
- nach Antwort: `session.dispose()`, `rmSync(tmpDir)`.

Disk-IO + Session-Setup pro Nachricht. Auf einem typischen Chat-Throughput (>1/Sekunde während interaktiver Nutzung) ist das ineffizient und produziert tmpdir-Müll wenn `rmSync` failed.

**Gleicher Fehler in `nl/decomposer.ts`** — auch dort wird pro `decompose()`-Call eine Session aufgebaut und disposed.

### U6. EventBuffer ist hard-capped bei 1000 Events
`events/buffer.ts` — Ring-Buffer 1000. Bei einem aktiven Workflow mit 10 parallel Steps + 5 Goals + Tool-Calls läuft das in Minuten über. Last-Event-ID-Replay (`SSE`/`WS`) bringt nur Events, die noch im Ring sind. SSE-Clients, die kurz disconnecten, verlieren Events ohne dass es jemand merkt.

### U7. WebSocket-Bridge: keinerlei Schutz
`server/src/api/ws.ts`:
- Kein Origin-Check.
- Kein Auth-Token.
- Kein Rate-Limit.
- `getSince(lastEventId, projectId)` — Client darf beliebige `projectId` anfragen. Keine ACL.

Lokal ok. Sobald der Port forwarded ist (Tailscale, ngrok, Cloudflare-Tunnel), bist du komplett offen.

### U8. WebSocket-State im Modul-Scope
```ts
const wsClients: Set<any> = new Set();
```
Ein Modul-globales Set. Bei Hot-Reload via tsx-watch wird das Modul neu geladen, alte Clients hängen, neue Clients landen im neuen Set. Auch verhindert es Mehrfach-Instanziierung in Tests.

### U9. Tasks-Route: setRunning + dispatch nicht transaktional
`api/routes/tasks.ts`:
```ts
tracker.setRunning(task.id);
eventBuffer.push(..., 'task.running', ...);
sessionMgr.dispatch(agent, description).then(...).catch(...);
```
Drei Operationen, drei Failure-Modi. Wenn `setRunning` failt aber `dispatch` durchgeht, hast du eine arbeitende Session ohne running-Status — der task bleibt auf `pending`, die DB sagt eines, die Session-Realität sagt anderes.

### U10. NL-Decomposer wählt Modell per String-Match
```ts
const fastAgent = agents.find(a =>
  a.model?.includes('haiku') || a.model?.includes('flash'),
);
```
- Was wenn das schnellste Modell `gpt-4o-mini` heißt? Fallback auf `agents[0].model` — was reiner Zufall ist.
- Was wenn `haiku` und `flash` gleichzeitig konfiguriert sind? `Array.find` nimmt das erste — also `pragents.yaml`-Reihenfolge entscheidet.

Modell-Selektion gehört in eine echte Strategy (z.B. `pickFastModel(agents): Model`), nicht in String-Heuristik.

### U11. Hot-Reload-Race: Config vs. laufende Sessions
`config/loader.ts` watcht `pragents.yaml`. Bei Reload werden neue `ResolvedAgent`-Objekte erzeugt. **Aber:** `AgentSessionManager` hält Sessions, die alte `ResolvedAgent`-Referenzen in Closures haben (System-Prompt, Skills). Reload wirkt erst, wenn die Session idled out und neu spawned wird.

Es gibt kein Signal "config changed for agent X → dispose session X". Für den Nutzer wirkt es so, als hätte der Hot-Reload funktioniert (Web zeigt neue Config), aber laufende Agents nutzen alte Werte.

### U12. Migrations sind nicht idempotent garantiert
`db/sqlite.ts.runMigrations()` markiert Files als applied nach `db.exec()`. Wenn `db.exec()` mehrere Statements enthält und mittendrin failt, ist das Schema halb-migriert, aber die Migration ist nicht in `_migrations`. Beim nächsten Start wird sie nochmal versucht → CREATE TABLE fails weil teilweise vorhanden.

Lösung wäre `BEGIN; ...; COMMIT;` per Migration-File oder `db.transaction(() => db.exec(sql))()`.

### U13. DB-Integrity-Check ohne Recovery-Pfad
```ts
console.error('Attempting to restore from backup...');
// Backup restore would go here
```
`db/sqlite.ts` — der Recovery-Pfad ist ein TODO-Kommentar. Wenn `pragma integrity_check` failt, läuft das Programm trotzdem weiter, schreibt in eine kaputte DB. Kein Backup-Tool, kein periodischer Snapshot.

### U14. SimpleVectorStore-Fallback ist still degraded
Wenn LanceDB nicht verfügbar (kein Embedding-API-Key, fehlende native deps), fällt `MemoryEngine` auf `SimpleVectorStore` — die Implementierung ist im Wesentlichen In-Memory ohne echte Embeddings. Memory-Recall-Qualität sinkt massiv, der User sieht nichts. Kein Warn-Log "you're running in degraded vector mode".

### U15. Chat-`ConversationManager` In-Memory bei Server-Neustart
Aus dem Chat-Plan: "ConversationManager hält in-memory state. Bei Server-Neustart gehen nur nicht-persistierte Nachrichten verloren." — Das ist "akzeptiert", aber für ein "single source of truth"-System ist es eine versteckte Inkonsistenz. SQLite-Persistenz schreibt nach `expireStale()`-Cleanup, aber während eines aktiven SSE-Streams können Tool-Results verloren gehen.

### U16. Pi-Chat-Extension teilt globale conversationId
Aus `docs/plans/2026-05-12-001`: "If the user runs multiple pi sessions against different pragents instances, the ID from the last session wins." — als acceptable risk. Aber es ist eine bekannte Datenverlust-Quelle bei Standard-Mehrfenster-Workflow (zwei pi-Terminals).

### U17. Skill-Auto-Extraction = unkontrollierter Prompt-Injection-Vektor
Auto-extrahierte Skills werden als `SKILL.md` geschrieben und beim nächsten Session-Setup in den System-Prompt aufgenommen. Wenn ein Workflow-Output (z.B. von einem Crawl, Mail-Triage etc.) instruktionsähnliche Strings enthält und in einen Skill ge-extracted wird, hast du Prompt-Injection in dein eigenes System eingebaut.

Gegenmaßnahmen: keine erkennbar. Auto-Extraction läuft mit LLM, vertraut der LLM-Klassifikation, und schreibt direkt ins Skills-Dir.

### U18. Tests decken die scharfen Kanten nicht ab
Tests vorhanden für: `tracker`, `engine` (memory + workflows), `schema`, `loader`, `tool-executor`, `manager` (basics), `events`.

Lücken (best-effort-Inferenz aus Tree + Code):
- `agents/manager.persistSessionMessages()` — pi-Internals-Zugriff ungetestet.
- `goals/scheduler.pmCheck()` — Deadline-/Eskalations-Pfad untested.
- `chat/intent-classifier` — LLM-abhängig, vermutlich nur Schema-Tests.
- `api/ws.ts` — Replay-Logik ungetestet.
- `config/loader` Hot-Reload-Race ungetestet.
- Migrations-Failure-Recovery ungetestet.

### U19. `dispatchTask`-Callback im ToolExecutor durchbricht Schichten
`ToolExecutor` hat eine `dispatchTask: (projectId, agentId, description) => Promise<string>`-Dependency. Das ist eine Hintertür um den `AgentSessionManager`, gleichzeitig wird `sessionMgr.dispatch` direkt im `goals/scheduler.ts` aufgerufen. Zwei Pfade zur gleichen Operation → unterschiedliche Event-Emissions, unterschiedliche Tracking-Stati.

### U20. `await loader.reload()` pro Klassifikation
`intent-classifier.ts` und `nl/decomposer.ts` rufen `loader.reload()` für eine leere tmp-dir. Das ist Disk-Scan-Overhead für leere Ordner, pro Request. Symptom: Chat-Latenz steigt mit dem Filesystem-State des Hosts (nicht mit dem Workload).

---

## 4. Priorisierung

| # | Finding | Schwere | Aufwand | Priorität |
|---|---------|---------|---------|-----------|
| K3 | Keine Auth aber "remote-ready"-Claim | Hoch | Hoch | **P0** (Versprechen oder Claim zurücknehmen) |
| K4 | Memory-Scope-Policy nicht enforced | Hoch | Mittel | **P0** |
| K5 | Token-Budget nur retrospektiv | Hoch | Mittel | **P0** |
| U17 | Auto-Skill-Extraction → Prompt-Injection | Hoch | Mittel | **P0** |
| U3 | Goal-Cron Overlap | Mittel | Niedrig | **P1** |
| U4 | `approve_gate` Race | Mittel | Niedrig | **P1** |
| U5/U20 | Klassifikator/Decomposer Session-Setup pro Call | Mittel | Mittel | **P1** |
| K7 | Workflow fail-fast verliert teure Arbeit | Mittel | Mittel | **P1** |
| U13 | DB-Recovery-TODO | Mittel | Mittel | **P1** |
| U6 | EventBuffer hard-cap 1000 | Mittel | Niedrig | **P1** |
| K1 | Erfolgsmetriken nicht objektiv genug | Mittel | Mittel | **P2** |
| K2 | Skills haben keinen Vergessen-Mechanismus | Mittel | Mittel | **P2** |
| K6 | Lazy-Spawn-Latenz | Mittel | Hoch | **P2** |
| K8 | pi-SDK-Kopplung ohne Abstraktion | Hoch (langfristig) | Hoch | **P2** |
| K9 | Intent-Classifier ohne Confidence | Mittel | Niedrig | **P2** |
| K10 | PM-Eskalation fire-and-forget | Mittel | Mittel | **P2** |
| K11 | Drei Eingangstüren (chat / nl / tasks) | Niedrig | Mittel | **P2** |
| K12 | Auto-Approval-Skills binär | Niedrig | Mittel | **P2** |
| U1 | `console.*` Inkonsistenz | Niedrig | Niedrig | **P3** |
| U2 | pi-Internal-Access ungetestet | Mittel | Niedrig | **P3** |
| U8 | WS-State im Modul-Scope | Niedrig | Niedrig | **P3** |
| U9 | Tasks-Route setRunning/dispatch nicht atomar | Niedrig | Niedrig | **P3** |
| U10 | Modell-Auswahl via String-Match | Niedrig | Niedrig | **P3** |
| U11 | Hot-Reload trifft laufende Sessions nicht | Mittel | Mittel | **P3** |
| U12 | Migrations ohne Transaction | Mittel | Niedrig | **P3** |
| U14 | SimpleVectorStore silent degraded | Niedrig | Niedrig | **P3** |
| U15/U16 | Chat-Conversation-State-Lecks | Niedrig | Niedrig | **P3** |
| U18 | Test-Lücken | Mittel | Mittel | **P3** |
| U19 | dispatchTask doppelter Pfad | Niedrig | Niedrig | **P3** |

---

## 5. Empfohlene nächste Schritte (in dieser Reihenfolge)

1. **Claim ehrlich ziehen.** Entweder Auth/Authz einziehen (Bearer-Token reicht für Phase 1) oder "remote-ready" aus README/STRATEGY streichen.
2. **Memory-Scope enforcen.** `memory/engine.remember()` und `recall()` müssen `ResolvedAgent.memory`-Policy gegen den Aufrufer prüfen, nicht nur deklarieren. Test schreiben, der einen Cross-Project-Leak versucht und erwartet, dass er failt.
3. **Token-Budget-Gate in den Dispatch-Pfad.** Vor jedem `session.prompt()` aktuellen Verbrauch gegen `agent.tokenBudget` prüfen; bei Überschreitung → reject + Event.
4. **Skill-Extraction sandboxen.** Auto-extrahierte Skills nie direkt in Skills-Dir schreiben, sondern in `skills/_quarantine/`. Erst nach Review (oder Confidence + tool-allowlist-Check) in den aktiven Ordner verschieben.
5. **Goal-Overlap-Lock.** `trigger()` prüft `activeGoalRuns` für goal.id; wenn aktiv → skip + log + Metric.
6. **Klassifikator/Decomposer-Session poolen.** Eine persistente in-memory pi-Session pro Modell, wiederverwenden statt pro Call neu aufzubauen.
7. **Migrations in Transactions.** `db.transaction(() => db.exec(sql))()` pro File, Insert in `_migrations` im gleichen Block.
8. **Eventbuffer + Persistenz.** EventBuffer bleibt Ring für SSE-Replay, aber jedes Event sollte zusätzlich in `events`-Tabelle landen (existiert bereits, TTL-Cleanup ist da). Replay-API auf DB statt nur Buffer.
9. **AgentRuntime-Interface.** Zwischenschicht zwischen pragents und pi. Auch wenn nur eine Implementation existiert, isoliert es den `(... as any).state.messages`-Schmerz.
10. **Erfolgsmetriken erweitern.** Mindestens: Skill-Approval-Rate, Skill-Reject-Rate, Goal-Eskalations-Rate, Tokens pro completed task. Alles aus DB ableitbar.

---

## 6. Was gut ist (zur Balance)

- Die **Schicht-Trennung in `server/src/`** ist sauber: domains, nicht layers. Macht zukünftige Refactors möglich.
- **Zod-am-Boundary** ist konsequent durchgezogen — Config, Workflows, Goals, Skills, Chat-Schema.
- **Hot-Reload für Workflows/Goals/Skills** ist ein echter UX-Win für einen Solo-User-Workflow.
- **Plan- und Brainstorm-Disziplin** in `docs/plans/` und `docs/brainstorms/` ist ungewöhnlich gut für ein One-Person-Projekt. Die institutionellen Learnings in `docs/solutions/` sind genau das richtige Format.
- **DB als single file mit WAL + foreign_keys ON + integrity_check** zeigt operationale Reife.
- **18-Tool-Bridge (M6)** macht die Plattform tatsächlich agent-native: ein Agent kann das eigene System inspizieren und steuern, nicht nur passiv konsumieren.
- **Test-Pattern (no globals, neben dem Code)** ist konsistent.

Die Schwächen oben sind nicht Architekturfehler — sie sind die typische Reifekurve eines Systems, das gerade von M1–M6 durch in den ersten Real-World-Use geht. Die Konzept-Schwächen (K-Reihe) sind die wichtigeren, weil sie nicht durch lokales Refactoring verschwinden.
