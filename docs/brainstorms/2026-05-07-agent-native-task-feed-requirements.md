---
date: 2026-05-07
topic: agent-native-task-feed
---

# Agent-Native Task Feed

## Summary

Pragents erhält eine agent-native „Inbox": eine minimale, im bestehenden Web-UI integrierte Ansicht, die strukturierte Agent-Intents (Review nötig, blockiert, Gate wartet, fertig) als priorisierten Feed darstellt. Kein externer Issue-Tracker. Die Architektur bereitet eine spätere Tracker-Adapter-Schnittstelle vor, implementiert sie aber nicht.

---

## Problem Frame

Pragents-Nutzer (One-Person-Agency) arbeiten mit mehreren spezialisierten Agents (Dev, SEO, Content, PM, Office), die autonom Tasks ausführen. Wenn ein Agent Hilfe braucht — ein Ergebnis zum Review vorlegt, an einem Human Gate stoppt, oder blockiert ist — muss der Mensch das aktiv erkennen. Heute gibt es dafür keinen dedizierten Ort: Tasks und Gates sind getrennt, die Web-UI zeigt eine flache Task-Liste ohne Priorisierung oder Intent-Kontext.

Die Synthese-Dokumente des Nutzers zeigen: Agenten eliminieren den „Übersetzungsschritt" traditioneller Issue-Tracker. Statt menschliche PM-Tools an Agenten anzupassen, sollte die Schnittstelle von dem ausgehen, was Agenten tatsächlich signalisieren: Intents. Ein externer Tracker (Plane, Linear) löst das Problem ebenfalls, bringt aber Betriebsaufwand (Docker, PostgreSQL, API-Sync) und koppelt pragents an ein fremdes Datenmodell.

Ein agent-nativer Feed, der auf dem bestehenden Task-Modell (`needs_review`), den Human Gates und dem Event-System aufbaut, liefert die gleiche Kernfunktion mit minimalem Neuaufwand — und bleibt offen für einen späteren Tracker-Adapter.

---

## Actors

- **A1. Agency Owner (Mensch):** Primärer Nutzer. Reviewt Agent-Ergebnisse, trifft Gate-Entscheidungen, priorisiert Arbeit. Einziger aktiver menschlicher Akteur.
- **A2. Agent (Dev, SEO, Content, PM, Office):** Produziert Arbeit, signalisiert Intents über die Tool Bridge (create_task, setNeedsReview, Gate-Status).
- **A3. pragents Server:** Persistiert Tasks und Gates, routet Intents, broadcasted Events, served Web-UI inklusive Feed.

---

## Key Flows

- **F1. Agent signalisiert „Review nötig"**
  - **Trigger:** Agent schließt einen Task ab, der menschliches Review erfordert
  - **Actors:** A2 → A3 → A1
  - **Steps:**
    1. Agent setzt Task-Status via Tool auf `needs_review` mit Begründung
    2. pragents persistiert den Status-Wechsel und emittet ein Event
    3. Der Feed zeigt den Task prominent mit Intent-Kontext („Review nötig"), Agent, Projekt und Zeitstempel
    4. Human öffnet den Task, prüft das Ergebnis, entscheidet
  - **Outcome:** Task erscheint im Feed unter „Braucht deine Aufmerksamkeit"
  - **Covered by:** R1, R2, R3

- **F2. Agent stößt an Human Gate**
  - **Trigger:** Workflow erreicht einen Schritt mit `human_gate`
  - **Actors:** A2 → A3 → A1
  - **Steps:**
    1. Workflow-Engine setzt Gate auf `pending`
    2. Gate erscheint im Feed (nicht nur in separater Gate-Liste)
    3. Human sieht Gate-Label, Kontext (Workflow, Step, Agent), und kann Approve/Reject direkt aus dem Feed
    4. Nach Entscheidung läuft der Workflow weiter
  - **Outcome:** Gate-Entscheidung getroffen, Workflow fortgesetzt oder abgebrochen
  - **Covered by:** R4, R5

- **F3. Human verschafft sich Überblick**
  - **Trigger:** Human öffnet pragents Web-UI
  - **Actors:** A1 → A3
  - **Steps:**
    1. UI zeigt Feed mit priorisierten Einträgen: zuerst offene Gates, dann Review-Tasks, dann abgeschlossene Arbeit
    2. Jeder Eintrag zeigt: Intent-Typ, Agent, Projekt, Kurzbeschreibung, Alter
    3. Human kann nach Projekt, Agent, Intent-Typ filtern
    4. Human kann einzelne Einträge öffnen für Details und Aktion
  - **Outcome:** Human weiß ohne Suchen, was seine Aufmerksamkeit braucht
  - **Covered by:** R2, R3, R6

- **F4. Agent fragt aktiv nach Input (Chat/Intercom)**
  - **Trigger:** Agent kann nicht autonom entscheiden und braucht menschliche Klärung
  - **Actors:** A2 → A3 → A1
  - **Steps:**
    1. Agent erstellt Task mit Status `needs_review` und formuliert eine konkrete Frage
    2. Feed zeigt den Eintrag als „Frage / Klärung nötig"
    3. Human antwortet (Chat oder Task-Kommentar)
    4. Agent nimmt Arbeit wieder auf
  - **Outcome:** Klärungsbedarf gelöst, Agent fährt fort
  - **Covered by:** R1, R3

---

## Requirements

**Task-Intent-Modell**
- **R1.** Das bestehende `TaskStatus`-Enum wird um `blocked` erweitert. Agenten können Tasks als `blocked` markieren, wenn sie auf eine externe Bedingung oder menschliche Entscheidung warten, die kein Review und kein Gate ist.
- **R2.** Der Feed gruppiert Tasks nach Intent-Priorität. Die Ordnung ist: (1) offene Human Gates, (2) `needs_review`-Tasks, (3) `blocked`-Tasks, (4) kürzlich abgeschlossene (`complete` / `failed`) Tasks. Innerhalb jeder Gruppe: neueste zuerst.

**Feed-Ansicht**
- **R3.** Die Web-UI erhält eine dedizierte Feed-Ansicht (Route `/feed` oder als Startseite). Jeder Eintrag zeigt: Intent-Typ als visuelles Badge, Agent-Name, Projekt, Kurzbeschreibung (erste ~120 Zeichen), Zeitstempel (relativ: „vor 5 min").
- **R4.** Offene Human Gates erscheinen im Feed mit Label, Workflow-Kontext und Approve/Reject-Buttons — nicht nur in einer separaten Gate-Liste.
- **R5.** Die Feed-Ansicht unterstützt Filter: nach Projekt, nach Agent, nach Intent-Typ (Gates / Review / Blockiert / Abgeschlossen).
- **R6.** Abgeschlossene Tasks und abgelehnte/zeitabgelaufene Gates verlassen den Feed nicht, sondern wandern in eine „Kürzlich abgeschlossen"-Sektion unterhalb der aktiven Einträge.

**Agent-Tooling**
- **R7.** Das `query_tasks`-Tool der Agent-Tool-Bridge wird um den Filter `status=needs_review` und `status=blocked` erweitert. Agenten können so den Status anderer Tasks abfragen, bevor sie neuen Input produzieren.
- **R8.** Agenten erhalten ein Tool `list_pending_attention`, das alle offenen Gates und `needs_review`-Tasks zurückgibt — als dedizierte Abfrage für „worauf wartet der Mensch?".
- **R9.** Die `create_task`-Tool-Definition erlaubt es Agenten, beim Erstellen eines Tasks direkt den Status `needs_review` zu setzen (statt nur `pending`).

**Architektur-Offenheit**
- **R10.** Das Task-Modell und die Feed-API werden so strukturiert, dass ein späteres `IssueTracker`-Interface (Adapter-Pattern) die gleichen Daten in einen externen Tracker spiegeln kann. Konkret: Tasks bekommen ein optionales Feld für externe Referenzen, und die Feed-API abstrahiert über die konkrete Datenquelle.
- **R11.** Die `setNeedsReview`-Methode wird so erweitert, dass sie ein strukturiertes `reason`-Feld akzeptiert (z. B. „Bitte PR reviewen", „Design-Entscheidung nötig", „Unbekannter Fehler"), das im Feed als Intent-Kontext angezeigt wird.

---

## Acceptance Examples

- **AE1. Covers R1, R2.** Given ein Agent markiert einen Task als `blocked` mit Grund „Warte auf API-Zugangsdaten vom Kunden", when der Human den Feed öffnet, erscheint der Task in der „Blockiert"-Gruppe mit dem Grundtext, sortiert nach Erstellungszeitpunkt.
- **AE2. Covers R3, R6.** Given drei Tasks: ein Gate pending seit 2h, ein Review-Task seit 30min, ein abgeschlossener Task seit 5min. When Human öffnet Feed, dann ist die Reihenfolge: Gate (2h) → Review (30min) → Trennlinie „Kürzlich abgeschlossen" → Completed (5min).
- **AE3. Covers R4, R5.** Given ein Workflow-Gate „after_draft" ist pending und der Human filtert den Feed auf Projekt „kunde-a", erscheint das Gate mit Label, Workflow-Name und Approve/Reject-Buttons. Ein Gate für Projekt „kunde-b" wird ausgeblendet.
- **AE4. Covers R7, R8.** Given ein Agent ruft `list_pending_attention` auf, erhält er eine Liste aller offenen Gates und `needs_review`-Tasks — aber keine `blocked`-Tasks anderer Agents. Er kann darauf reagieren ohne menschlichen Input zu duplizieren.
- **AE5. Covers R1, R11.** Given ein Agent ruft `setNeedsReview` mit `reason: "Bitte PR reviewen: auth-middleware refactored"`, zeigt der Feed den Eintrag mit Badge „Review" und dem Reason-Text als Kurzbeschreibung.

---

## Success Criteria

- **Menschliches Outcome:** Der Nutzer weiß in unter 5 Sekunden nach Öffnen des Feeds, welche Agenten seine Aufmerksamkeit brauchen — ohne Tasks oder Gates manuell zu durchsuchen.
- **Downstream-Handoff:** Ein Entwickler (oder ce-plan) kann aus diesem Dokument R1–R11 implementieren, ohne Product-Entscheidungen neu treffen zu müssen. Das Datenmodell, die UI-Struktur und das Agent-Tooling sind vollständig beschrieben.
- **Architektur-Test:** Das in R10 geforderte externe Referenz-Feld und die API-Abstraktion lassen sich ohne Refactoring des Task-Modells später um einen Plane-Adapter ergänzen.

---

## Scope Boundaries

- Kein externer Issue-Tracker (Plane, Linear, GitHub Issues) in dieser Version
- Keine Kanban-Boards, Cycles, Sprints, Estimates, Time Tracking
- Kein Kunden-Zugriff auf den Feed (bleibt intern für den Agency Owner)
- Keine Migration bestehender Tasks
- Kein Export/Import von Tasks
- Kein Multi-User-Support (Kommentare, Assignees, Mentions)
- Kein Echtzeit-Push der Feed-Updates (Polling oder SSE-Update über bestehenden Event-Stream ist ausreichend)
- Kein Rich-Text oder Markdown in Task-Beschreibungen über das bestehende Format hinaus

---

## Key Decisions

- **Agent-nativ statt externer Tracker:** Die Synthese-Dokumente des Nutzers zeigen, dass Agenten den „Übersetzungsschritt" traditioneller Tracker eliminieren. Auf dem bestehenden Task-Modell aufzubauen ist architektonisch ehrlicher und vermeidet Sync-Komplexität. Ein externer Tracker bleibt als spätere Erweiterung möglich (R10).
- **Feed als zentrale Ansicht:** Die Web-UI bekommt eine dedizierte Inbox-Route statt die bestehende Task-Liste nur zu erweitern. Das trennt die Perspektiven sauber: „Was braucht mich?" (Feed) vs. „Was läuft alles?" (Task-Liste).
- **`blocked` als neuer Status:** Neben `needs_review` und Gates fehlt ein Status für „Agent kann nicht weitermachen, aber es ist kein Review". Das schließt die Intent-Lücke, ohne das Status-Modell aufzublähen.

---

## Dependencies / Assumptions

- Das bestehende `needs_review`-Status und die `setNeedsReview`-Methode im `TaskTracker` sind bereits implementiert und funktionsfähig (verifiziert in `server/src/tasks/tracker.ts`).
- Das bestehende SSE-Event-Streaming (`/api/v1/events/stream`) kann Feed-Updates transportieren; es ist kein WebSocket-only Feature.
- Die Web-UI (React 19, TanStack Router, TanStack Query) kann eine neue Route `/feed` aufnehmen, ohne Architektur-Änderungen.
- Plane-Integration ist eine mögliche, aber nicht garantierte spätere Erweiterung. R10 bereitet nur vor, implementiert nicht.
