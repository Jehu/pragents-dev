# Usability-Test: Kompletter Agent-Workflow im Testprojekt

**Datum:** 2026-07-04 · **Rolle:** Endnutzer (Operator) über die Web-UI · **Projekt:** `testprojekt` (`~/demo-projects/test`)

## Testaufbau und Szenario

Getestet wurde der komplette Lebenszyklus über die Web-UI, wie ihn ein Operator erleben würde:

1. Projekt-Scope auf Testprojekt setzen
2. Task an `dev@testprojekt` dispatchen („Create a file index.html …")
3. Task-Ergebnis auf der Detailseite und im Dateisystem prüfen
4. Agent-Modell über die Projekt-Settings ändern (zai → deepseek)
5. Chat mit einem Agenten beginnen
6. Entstandenen Plan-Draft in der Inbox approven und die Ausführung verfolgen
7. Observability (Traces, Logs, Costs, Health) gegenprüfen

Umgebung: Deepseek-Key funktioniert (verifiziert per Direkt-Call), Z.ai-Key gültig aber **Konto ohne Guthaben** (Error 1113 „Insufficient balance"), Anthropic-Key auskommentiert.

## Gesamtergebnis

**Kein einziger Agent-Lauf hat reale Arbeit verrichtet — aber jeder wurde als Erfolg gemeldet.** Die UI ist in Struktur und Detailtiefe stark (Traces, Timeline, Inbox-Shortcuts, Konflikt-Dialoge), steht aber auf einer Ausführungsschicht, die Fehler systematisch als Erfolg maskiert. Für einen Operator ist der Systemzustand dadurch nicht nur intransparent, sondern aktiv irreführend: „healthy", grüne Timelines, Kostenzahlen — während faktisch nichts passiert.

## Kritische Befunde

### K1 — Agent-Tasks tun nichts, melden aber „complete"

Der Task „Create index.html" endete in **59 ms** mit Status `complete`, Result „Task completed (no text response)", 46/9 Tokens — ohne dass eine Datei entstand. Reproduziert mit zwei Providern (zai ohne Guthaben **und** funktionierendem deepseek): identisches Ergebnis, identische Metriken.

Ursachenkette:

1. `server/src/agents/runtime/pi-runtime.ts` übergibt das in `pragents.yaml` konfigurierte Modell **nicht** an `createAgentSession` — Kommentar: „model auto-discovered by pi SDK from configured API keys". Das pi SDK findet aus `DEEPSEEK_API_KEY`/`ZAI_API_KEY` offenbar kein Modell → die Session beendet den Prompt sofort und leer (`agent_start` → `message_end` im selben Millisekunden-Fenster, sichtbar in Trace 53–57).
2. `server/src/agents/manager.ts:336` behandelt eine leere Antwort als Erfolg: `resolve(responseText.trim() || 'Task completed (no text response)')`. Im `subscribe`-Handler gibt es **keine Behandlung von Error-Events** — nur `agent_end` und `custom_tool_call`.
3. Der Task wird `complete`, die Timeline ist grün, die Task-Detailseite gibt keinerlei Hinweis auf ein Problem.

Derselbe Mechanismus erklärt den historischen Wiki-Plan-Run (`361cd257`): 5 Steps, alle Artifacts „Task completed (no text response)".

**Empfehlung (höchste Priorität):**
- Modell + Provider-Key explizit an die pi-Session übergeben (Mapping `zai/glm-5.1` → Provider-Config), statt auf Auto-Discovery zu vertrauen.
- Error-Events der pi-Session abfangen und als Task-`failed` mit Fehlertext durchreichen.
- Eine leere Antwort niemals als `complete` werten — mindestens `needs_review` mit Warnhinweis, besser `failed`.

> **Update (gleicher Tag):** Teilweise behoben. `pi-runtime.ts` resolved das konfigurierte Modell jetzt explizit über `resolveModel` und wirft bei nicht auflösbarem Modell (→ Task wird `failed` mit Fehlertext statt fake-`complete`). Zusätzlich neue `providers:`-Sektion in `pragents.yaml` für Provider-Overrides (`baseUrl`), z. B. Z.ai-Coding-Endpoint für GLM-Coding-Plan-Abos. Verifiziert: Task `38723fc4` lief 26,7 s über `zai/glm-5.1` (Coding-Endpoint) und erstellte real `~/demo-projects/test/index.html`. Offen bleiben: Error-Event-Handling im laufenden Stream und die Leere-Antwort-Heuristik.

### K2 — Config-Änderungen über die UI sind bis zum Server-Neustart wirkungslos

Modellwechsel des dev-Agents über die Projekt-Settings: Dialog bestätigt, `pragents.yaml` korrekt geschrieben, Server loggt „Project agent updated via API" — aber `/api/v1/agents` liefert weiter das alte Modell. Ein um 17:08 via API angelegter `content`-Agent fehlte noch 20 Minuten später in Agents-Liste, Chat und Dispatch; erst der Neustart brachte ihn (Agents loaded: 4 → 5).

Der AgentManager cached die beim Boot aufgelösten Agents — exakt das Anti-Pattern, vor dem die eigene CLAUDE.md warnt („code that depends on config should re-resolve through the loader rather than caching"). Die UI meldet Erfolg, der Nutzer arbeitet danach mit einem Phantom-Zustand.

**Empfehlung:** AgentManager an den Config-Loader/Hot-Reload anbinden (re-resolve bei Änderung, laufende Sessions markieren als „config veraltet — Neustart der Session nötig"). Übergangsweise: UI-Hinweis „Änderung wird nach Server-Neustart wirksam".

### K3 — Chat: Fehlklassifikation, verlorene Konversation, kein Feedback

Die Nachricht „Hallo! Was kannst du für mich tun?" an `office@company` führte zu:

- **Fehlklassifikation:** Der IntentClassifier machte aus der Begrüßung eine Plan-Anfrage; der NLDecomposer erzeugte einen Plan-Draft mit dem Step *„Greet the user and ask how you can help them today"* — der Nutzer soll den Gruß seines Agenten per Approval genehmigen.
- **Verlorene Konversation:** `/api/v1/chat/conversations` blieb leer, die UI zeigte „Failed to load conversation history." Die Nutzernachricht ist weg.
- **Kein Feedback:** Dass ein Plan-Draft in der Inbox entstand, war im Chat nicht erkennbar. Der Nutzer wartet auf eine Antwort, die nie kommt.
- Nebenbefund: NLDecomposer-Fallback „no agent with role fast → first agent" wählte willkürlich `office@company`; `projectId` des Plans ist `null`, obwohl der Scope Testprojekt war.

**Empfehlung:** Konversation vor der Intent-Klassifikation persistieren; `plan_proposal` als Chat-Nachricht in den Stream einspeisen (das SSE-Schema hat den Subtype bereits); Smalltalk/Grußformeln unterhalb der Confidence-Schwelle direkt beantworten statt dekomponieren; Plan-Erstellung an den aktiven Projekt-Scope binden.

### K4 — Metriken sind Schätzwerte, werden aber als Fakten präsentiert

Jeder Lauf zeigt exakt 59 ms / 46 in / 9 out — auch ohne jeden LLM-Kontakt. Die Token-Zahlen entstehen per Zeichen÷4-Schätzung (`manager.ts`, „character-based token estimate"), die Kosten (`€0.000009`) werden daraus errechnet. Ein Operator, der Kosten und Auslastung überwachen soll, schaut auf Zahlen ohne Realitätsbezug.

**Empfehlung:** Echte Usage aus den pi-Events beziehen; solange das nicht geht, Schätzwerte in der UI als „~ geschätzt" kennzeichnen.

## Mittlere Befunde

- **M1 — „healthy" trotz totalem Provider-Ausfall.** Kein einziges konfiguriertes Agent-Modell war zu Testbeginn funktionsfähig (zai ohne Guthaben ×3 Agents, deepseek nur für Company-Agents, Anthropic auskommentiert) — Health-Badge und Health-Seite blieben grün. Empfehlung: Provider-Reachability-Check (Boot + periodisch) mit Status pro Modell in der Health-Seite und Warn-Badge am Agenten.
- **M2 — Modellfeld ohne Validierung.** Das Agent-Formular akzeptiert freien Text; es gibt keine Warnung, wenn für den Provider kein Key hinterlegt oder das Konto leer ist. `/api/v1/models` existiert bereits — Abgleich plus Key-Check wären der natürliche nächste Schritt.
- **M3 — Dispatch-Modal ohne Rückmeldung und ohne Scope.** Nach „Dispatch" schließt das Modal kommentarlos: kein Toast, kein Link zum Task. Die Agentenauswahl ignoriert den Projekt-Scope (alle Agents aller Projekte wählbar). Zudem ging der erste Dispatch-Klick nach dem Server-Neustart kommentarlos verloren (kein POST, Modal blieb offen; zweiter Klick funktionierte) — vermutlich ein Race mit dem SSE/Query-Reconnect, sollte reproduziert werden.
- **M4 — Projektverzeichnisse werden nicht validiert.** `~/demo-projects/wiki` existiert nicht, obwohl das Wiki-Projekt (inkl. gelaufenem Plan!) darauf zeigt. Nur das fehlende `workflows/`-Unterverzeichnis erzeugt eine Log-Warnung; die UI zeigt nichts. Empfehlung: Verzeichnis-Check beim Anlegen/Boot, Warnung auf der Projektseite.
- **M5 — Irreführende Fehlermeldung im Chat.** „Failed to load conversation history" suggeriert ein Ladeproblem; tatsächlich wurde nie etwas gespeichert.

## Kleinere UX-Befunde

- Chat-Agentenliste respektiert den Projekt-Scope nicht (gleiches Muster wie Dispatch).
- Agentenliste zeigt keinen Hinweis auf den Modell-/Provider-Status (ein rotes Pünktchen am Modellnamen würde K1 sofort sichtbar machen).
- Workflow-Verzeichnis-Warnungen existieren nur im Log, nicht in UI oder Health.
- Der Live-Event-Ticker (ev/s, Sparkline) zeigt Aktivität auch für Leerläufe — „Aktivität" ist nicht „Arbeit".
- Plan-Detail zeigt „This run completed, but no step produced a text artifact" — ehrlich, aber ohne Ursachen-Hinweis oder Link zur Diagnose.

## Was gut funktioniert

- **Informationsarchitektur:** Die Domänen-Navigation (Run/Knowledge/Observe/Talk), Task-Timeline mit Trace-Link, Inbox mit Tastaturkürzeln und die Plan↔Run-Verknüpfung sind durchdacht und konsistent.
- **NL→Plan→Approve→Run-Pipeline** funktioniert mechanisch einwandfrei: Draft-Erzeugung, Inbox-Approval, Workflow-Run-Erzeugung, Status-Verkettung, Persistenz.
- **IntentClassifier/NLDecomposer** führen echte LLM-Calls über Deepseek aus — die pi-Integration funktioniert dort, wo das Modell explizit gesetzt wird (`modelString: deepseek/deepseek-v4-flash` im Log). Das bestätigt indirekt K1: Managed-Sessions scheitern, weil ihnen genau diese explizite Modellangabe fehlt.
- **Robustheits-Details:** ETag/Konflikt-Dialoge bei Config-Saves, DB-Backup bei jedem Boot, SSE-Reconnect-Anzeige.

## Priorisierte Empfehlungen

| # | Maßnahme | Befund | Status |
|---|---|---|---|
| 1 | Modell + Key explizit an pi-Session übergeben; Error-Events → Task `failed` | K1 | ✅ umgesetzt |
| 2 | Leere Agent-Antwort nie als `complete` werten | K1 | ✅ umgesetzt |
| 3 | AgentManager an Config-Hot-Reload anbinden (oder „Neustart nötig"-Hinweis) | K2 | ✅ umgesetzt |
| 4 | Chat: Konversation persistieren, `plan_proposal` im Chat anzeigen, Smalltalk-Schwelle | K3 | ✅ umgesetzt |
| 5 | Provider-Health-Check mit UI-Status pro Modell | M1/M2 | ✅ umgesetzt |
| 6 | Dispatch: Navigation zum Task, Scope-Filter für Agentenauswahl | M3 | ✅ umgesetzt |
| 7 | Token/Kosten als Schätzung kennzeichnen bzw. echte Usage übernehmen | K4 | ✅ umgesetzt |
| 8 | Verzeichnis-Validierung für Projekte mit UI-Warnung | M4 | ✅ umgesetzt |

## Umsetzungs-Nachtrag (2026-07-04, gleiche Session)

Alle acht Empfehlungen wurden umgesetzt und end-to-end verifiziert:

- **K1-Rest:** `manager.ts` wertet jetzt `stopReason: error/aborted` der finalen Assistant-Message als Task-Fehler (inkl. `errorMessage`) und behandelt leere Antworten als `failed` mit handlungsfähiger Meldung — nie mehr fake-`complete`.
- **K2:** Zentrale Reload-Routine (`applyConfigReload` in `index.ts`): fs-Watcher UND UI-Writes (via `notifyConfigChanged` in `yaml-rw.ts`, das die Watcher-Suppression kompensiert) ersetzen das geteilte `agents`-Array in-place und markieren Sessions stale. Verifiziert: Modelländerung per API ist ohne Neustart sofort in `/api/v1/agents` sichtbar.
- **K3:** Neuer `chat`-Intent im Classifier + direkte Antwort über eine zweite gecachte Reply-Session (statischer Capability-Fallback). „Hallo! Was kannst du für mich tun?" liefert jetzt eine deutsche Direktantwort statt eines genehmigungspflichtigen Plans. `scope=all` listet nun auch NULL-project-Konversationen (die „verlorene" Konversation war nie weg, nur ungelistet). Die Web-UI sendet `projectId` beim Chat-POST (Projekt-Agent → dessen Projekt, Company-Agent → aktiver Scope); Chat-Plan-Drafts erben das Projekt der Konversation.
- **K4:** Echte Provider-Usage aus den `message_end`-Events des Laufs speist den CostTracker (Fallback: Schätzung mit Log-Warnung). Verifiziert: echter Lauf zeigt 2249/35 Tokens statt der alten 46/9-Konstanten.
- **M1/M2:** Neues `agents/model-health.ts` (Modell auflösbar + Provider-Key vorhanden, pro konfiguriertem Modell); `/api/v1/health` degradiert bei unbrauchbaren Modellen (Header-Badge wird rot), Health-Seite zeigt „Model providers"-Sektion, Agents-Liste zeigt ⚠ am betroffenen Agent.
- **M3:** Dispatch navigiert nach Erfolg zum erstellten Task; Agentenauswahl in Dispatch UND Chat respektiert den Projekt-Scope.
- **M4:** `/api/v1/projects` liefert `directoryExists`; die Projektliste warnt bei fehlendem Verzeichnis (Wiki-Projekt wird korrekt markiert).

Tests: Server 729 + Web 448 grün, Typecheck beidseitig sauber. Offen aus den kleineren UX-Befunden: Ticker zeigt weiterhin „Aktivität ≠ Arbeit"; Plan-Detail ohne Ursachen-Link bei leeren Artifacts.

## Testartefakte

- Task 1 (zai, vor Modellwechsel): `c4acdf76` — complete, 59 ms, keine Datei
- Task 2 (deepseek, nach Neustart): `101c6972` — complete, 59 ms, keine Datei
- Fehlklassifizierter Plan: `901a199e` („Hallo! …" → Greet-Step), Run `cd674562` — complete in 8 ms
- Traces 53–57: agent_start → message_end im Millisekundenfenster
- Z.ai-Fehler: Code 1113 „Insufficient balance or no resource package"
