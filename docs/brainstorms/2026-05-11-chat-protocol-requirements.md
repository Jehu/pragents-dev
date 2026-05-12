---
date: 2026-05-11
topic: chat-protocol
---

# Chat Protocol — Conversational Interface for pragents

## Summary

Ein generisches Chat-Protokoll (HTTP POST + SSE) auf dem pragents-Server, das jeder Client — pi, Claude Code, Hermes, Telegram — mit minimalem Adapter-Aufwand als Konversationsschnittstelle zum Orchestrator nutzen kann. Multi-Turn über conversationId, mit Datei- und Bild-Anhängen.

---

## Problem Frame

Heute hat pragents genau zwei Interfaces: ein Web Dashboard (reine Beobachtung) und eine REST API (formularbasierte Task-Erstellung). Die aktive Interaktion mit dem Orchestrator — „Was macht Agent X gerade?“, „Deploy das auf Staging“, „Bau mir eine Landing Page“ — passiert über ein einzeiliges Textfeld mit Dropdowns. Es gibt keine echte Konversation, kein Multi-Turn, kein Streaming.

Die Design-Spec sah ursprünglich drei Interfaces vor (Web UI, pi Terminal, Telegram), aber der pi Bridge wurde nie gebaut (M1 ersetzte ihn durch direkte SDK-Integration). Der Agency Owner arbeitet täglich in mehreren CLI-Clients (pi, Claude Code, Hermes) und unterwegs per Telegram — kein einziger davon kann heute mit dem Orchestrator sprechen.

---

## Actors

- **A1. Agency Owner (Mensch):** Steuert Agents über Chat-Befehle, Briefings und Nachfragen. Nutzt mehrere Clients je nach Kontext (Terminal, unterwegs).
- **A2. pragents Orchestrator (System):** Empfängt Chat-Nachrichten, delegiert an NL Decomposer oder direct-Tool-Routing, streamt Ergebnisse zurück.
- **A3. Client Adapter (System):** Dünne Übersetzungsschicht in jedem Client (pi-Extension, Claude-Code-Custom-Command, Hermes-Modul, Telegram-Bot), die HTTP+SSE spricht und natives UI-Rendering übernimmt.

---

## Key Flows

**F1. One-shot Command**
- **Trigger:** A1 sendet einen kurzen Befehl ohne conversationId
- **Actors:** A1, A2, A3
- **Steps:**
  1. A1 tippt „Check ob SEO-Agent noch läuft“ in beliebigen Client
  2. A3 sendet `POST /chat` mit message und projectId (falls gesetzt)
  3. A2 routet direkt an `query_tasks`-Tool (kein LLM nötig für einfache Queries) oder nutzt NL Decomposer
  4. A2 streamt Ergebnis per SSE: `message`-Event mit Agent-Status
  5. A3 rendert Antwort, Konversation endet (keine conversationId)
- **Outcome:** A1 sieht Status, kein Conversation-State am Server
- **Covered by:** R1, R2, R9

**F2. Multi-Turn Project Briefing**
- **Trigger:** A1 sendet komplexes Briefing
- **Actors:** A1, A2, A3
- **Steps:**
  1. A1 tippt „Bau eine Landing Page mit Blog und SEO-Optimierung für Projekt B“
  2. A3 sendet `POST /chat` ohne conversationId
  3. A2 delegiert an NL Decomposer, der einen Plan erstellt
  4. A2 streamt `thinking` → Plan-Vorschau, dann `message` — „Soll ich diesen Plan ausführen? (3 Schritte: 1) Dev baut Page, 2) SEO optimiert, 3) Content füllt Blog)“
  5. A2 generiert `conversationId`, gibt sie im SSE-Event mit
  6. A1 antwortet „Ja, aber füg Tests in Schritt 1 hinzu“ → A3 sendet `POST /chat` mit conversationId
  7. A2 modifiziert Plan, streamt aktualisierten Plan, fragt erneut
  8. A1 bestätigt, A2 führt Workflow aus, streamt Fortschritt
- **Outcome:** Plan ausgeführt, Konversation bleibt für Nachfragen bestehen
- **Covered by:** R1, R3, R4, R5

**F3. Verfeinerung eines laufenden Tasks**
- **Trigger:** A1 will in einen laufenden Task eingreifen
- **Actors:** A1, A2, A3
- **Steps:**
  1. Während Task läuft (aus F2 gestartet), tippt A1 „Stopp den Content-Schritt und ändere Zielsprache auf EN“
  2. A3 sendet mit conversationId der laufenden Konversation
  3. A2 erkennt den Kontext (Referenz auf „Content-Schritt“), stoppt laufenden Workflow-Schritt, modifiziert
  4. A2 streamt Bestätigung, setzt Workflow fort
- **Outcome:** Laufender Task modifiziert ohne die Konversation neu zu starten
- **Covered by:** R3, R5, R6

**F4. Telegram Bot**
- **Trigger:** A1 ist unterwegs und schreibt dem pragents-Telegram-Bot
- **Actors:** A1, A3 (Telegram Bot), A2
- **Steps:**
  1. A1 sendet „Was macht das Deployment von heute Morgen?“ an den Bot
  2. Bot übersetzt in `POST /chat`, streamt SSE zurück
  3. Bot rendert Antwort als Telegram-Nachricht(en), inkl. Denk-Indikator via „typing...“-Status
  4. Bei Multi-Turn speichert Bot conversationId pro Telegram-Chat
- **Outcome:** A1 orchestriert Agents mobil, identisches Backend wie CLI-Clients
- **Covered by:** R1, R2, R3, R10

---

## Requirements

### Chat Protocol

- **R1.** pragents exponiert `POST /api/v1/chat` mit JSON-Body: `{ message, conversationId?, projectId?, attachments? }`. Antwort erfolgt als SSE-Stream (`Content-Type: text/event-stream`).

- **R2.** Der SSE-Stream liefert strukturierte Events. Pflichtfelder pro Event: `type`, `data`. Definierte Event-Typen:
  - `thinking` — Orchestrator verarbeitet (z. B. NL Decomposer zerlegt Anfrage)
  - `tool_call` — Orchestrator ruft ein Tool auf, `data` enthält `{ tool, args }`
  - `tool_result` — Ergebnis eines Tool-Aufrufs, `data` enthält `{ tool, result }`
  - `message` — finale oder zwischenzeitliche Text-Antwort an den User
  - `error` — Fehler mit `data: { code, message }`
  - `done` — Stream-Ende, `data` enthält `{ conversationId }` (auch bei one-shot)

- **R3.** `conversationId` ist optional. Wird sie mitgesendet, setzt A2 die Konversation fort und hat Zugriff auf den vorherigen Verlauf. Wird sie weggelassen, startet eine neue Konversation. Der Server gibt im `done`-Event die `conversationId` zurück, damit der Client sie für Folgenachrichten speichern kann.

- **R4.** Konversationen haben ein TTL (Standard: 24h nach letzter Aktivität). Abgelaufene Konversationen werden asynchron gelöscht.

- **R5.** Der Orchestrator unterscheidet zwei Routing-Pfade für eingehende Nachrichten:
  - **Direct Routing:** Einfache, klar formulierte Befehle („Zeig Tasks von Agent X“, „Starte Workflow Y“) werden per Keyword-Matching direkt an das passende M6-Tool geroutet — ohne LLM.
  - **NL Decomposition:** Komplexe, mehrdeutige oder planartige Anfragen („Bau mir X mit Y“) durchlaufen den bestehenden NL Decomposer, der einen Plan erstellt und zur Bestätigung vorlegt.

- **R6.** Im Multi-Turn-Kontext kann A1 laufende Tasks referenzieren („Stopp Schritt 2“, „Ändere Ziel-Branch“). A2 nutzt den conversation-Verlauf, um Referenzen aufzulösen.

- **R7.** Bei NL-Decomposition-Plänen pausiert A2 vor der Ausführung und präsentiert den Plan zur Bestätigung. A1 kann den Plan per Chat-Nachricht modifizieren, bestätigen oder ablehnen. Erst nach Bestätigung wird der Workflow ausgeführt.

### Attachments

- **R8.** `POST /api/v1/chat` akzeptiert optional `attachments`: ein Array von Objekten mit `{ name, mimeType, data }` (base64-kodiert). Unterstützte MIME-Types: `image/png`, `image/jpeg`, `image/webp`, `text/plain`, `application/json`, `text/markdown`. A2 leitet Attachments an den NL Decomposer oder das Ziel-Tool weiter, sodass z. B. ein Screenshot als Kontext für einen Bugfix-Task dient.

### Client Adapter

- **R9.** Client-Adapter sind so dünn wie möglich. Ihre einzige Aufgabe: Chat-Nachricht entgegennehmen → `POST /chat` → SSE parsen → nativ rendern. Sie enthalten keine Orchestrierungslogik.

- **R10.** Der Telegram-Bot wird als erster Client-Adapter gebaut (A1 nutzt ihn bereits aktiv für Hermes Agents). Er mappt Telegram-Chat-IDs auf pragents-conversationIds und nutzt den SSE-Stream für progressive Antworten („typing...“ während `thinking`, formatierte Nachrichten für `message`).

- **R11.** pi-, Claude-Code- und Hermes-Adapter folgen dem gleichen Muster: ein Command (`/pragents <nachricht>`) oder MCP-Tool-Wrapper, der `POST /chat` aufruft und SSE-Streams im jeweiligen Terminal-UI darstellt.

### Persistenz

- **R12.** Jede Chat-Nachricht (User → Server) und jede Server-Antwort wird persistiert (`chat_messages`-Tabelle mit `conversation_id`, `role`, `content`, `type`, `attachments`, `created_at`). Der conversation-Verlauf ist damit auditierbar und überlebt Server-Neustarts.

---

## Acceptance Examples

- **AE1. Covers R1, R2.** Given keine conversationId, when A1 sendet `POST /chat { message: "Welche Tasks sind failed?" }`, dann antwortet der SSE-Stream mit einem `tool_call`-Event (Tool: `query_tasks`), gefolgt von `message` (Liste der failed Tasks) und `done` (mit neuer conversationId).

- **AE2. Covers R3, R4, R5.** Given conversationId `abc123` existiert (Konversation von vor 30 Minuten), when A1 sendet `POST /chat { conversationId: "abc123", message: "Und was ist mit dem SEO-Agent?" }`, dann greift A2 auf den Verlauf zu, erkennt den Kontext, und routet zu `query_tasks` mit Agent-Filter SEO.

- **AE3. Covers R5, R7.** Given A1 sendet „Bau eine Landing Page mit Blog für Projekt B“, when A2 den NL Decomposer aufruft, dann streamt A2 einen `thinking`-Event („Erstelle Plan...“), gefolgt von `message` mit Plan-Vorschau und Bestätigungsfrage. Der Workflow wird erst nach Bestätigung ausgeführt.

- **AE4. Covers R8.** Given A1 sendet `POST /chat` mit `attachments: [{ name: "bug.png", mimeType: "image/png", data: "<base64>" }]` und message „Fix diesen Button“, dann leitet A2 das Bild an den NL Decomposer weiter, der den Screenshot als Kontext für den Bugfix-Plan nutzt.

- **AE5. Covers R10.** Given A1 schreibt dem Telegram-Bot „Deploy staging“, dann sendet der Bot `POST /chat`, zeigt „typing...“ während `thinking`-Events, und rendert `message`-Events als Telegram-Nachrichten. Die Telegram-Chat-ID wird auf die pragents-conversationId gemappt.

---

## Success Criteria

- A1 kann von jedem seiner vier Clients aus mit dem Orchestrator chatten, ohne das Protokoll wechseln zu müssen
- Ein one-shot-Befehl („Check Agent-Status“) liefert in unter 3 Sekunden eine Antwort
- Ein Multi-Turn-Briefing überlebt Context-Switches: A1 startet im Terminal, setzt 2 Stunden später per Telegram fort
- Client-Adapter sind in unter 150 Zeilen pro Client baubar
- Ein `ce-plan`-Skill kann nach diesem Dokument planen, ohne Produktverhalten erfinden zu müssen

---

## Scope Boundaries

- pi-spezifisches Extension-Format — das generische Protokoll ersetzt den Bridge, pi kriegt denselben dünnen Adapter wie alle anderen
- Umbau des Web Dashboards — das Dashboard bleibt Beobachtungs-Tool; Chat-Widget dort ist eine mögliche spätere Ergänzung, aber nicht Teil dieses Scopes
- Agent-zu-Agent-Chat — nur Mensch-zu-Orchestrator; Agents sprechen untereinander über die bestehende Workflow-Engine
- Echtzeit-Push (WebSocket) für Chat — SSE reicht; Clients pollen nicht, sondern halten den Stream offen
- Multi-User oder Auth — local-first, gleiche Annahme wie der Rest von pragents

---

## Key Decisions

- **Minimal-Protokoll statt MCP-only:** Ein Chat-Protokoll auf HTTP+SSE-Basis wurde einem reinen MCP-Ansatz vorgezogen, weil MCP-Clients (Claude Code) zwar profitieren, aber Telegram und einfache CLI-Adapter kein MCP sprechen. MCP kann später als zusätzliche Tool-Schnittstelle ergänzt werden.
- **Server-seitiger Conversation-State:** Der Server hält Konversationen (message history + context). Clients sind stateless. Das vermeidet Inkonsistenzen zwischen Clients und erlaubt Context-Switches (Terminal → Telegram).
- **Direct Routing vor NL Decomposition:** Einfache Befehle werden ohne LLM direkt an Tools geroutet. Spart Latenz und Kosten. Nur komplexe/mehrdeutige Anfragen gehen durch den Decomposer.
- **Plan-Bestätigung vor Ausführung:** NL-Decomposition-Pläne werden nie automatisch ausgeführt. Der User muss bestätigen. Das ist die gleiche Sicherheitsgrenze wie im bestehenden NL-Delegation-Flow.

---

## Dependencies / Assumptions

- Der bestehende NL Decomposer (`server/src/nl/decomposer.ts`) kann ohne strukturelle Änderungen für Chat verwendet werden
- Die 18 M6-Tools (`server/src/agents/tool-definitions.ts`) sind für Direct Routing geeignet und brauchen nur ein Keyword-Mapping
- SSE wird vom pragents-Server bereits unterstützt (vorhandene `broadcastSSE`-Infrastruktur in `server/src/api/routes/events.ts`)
- Telegram-Bot-Infrastruktur ist durch die bestehende Hermes-Integration bekannt und wiederverwendbar
- Datei-Anhänge werden base64-kodiert übertragen; für sehr große Dateien (>10 MB) ist ein separates Upload-Endpoint in einer späteren Iteration sinnvoll

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Direct-Routing-Disambiguierung: Der bestehende SkillRouter (Keyword-Matching) und NL Decomposer (LLM) decken beide Pfade bereits ab. Ob ein zusätzliches, sehr schnelles Modell für die Lücke zwischen „exaktem Keyword“ und „komplexer Dekomposition“ nötig ist, wird in der Planung anhand der Fehlerquote des Keyword-Matchings entschieden.
- [Affects R3][Technical] Wie wird der Conversation-Verlauf im Server gespeichert? In-Memory oder in SQLite? (SQLite ist konsistenter mit der restlichen Architektur und überlebt Neustarts)
- [Affects R8][Technical] Datei-Upload-Limit und -Validierung: Welche Maximalgröße? Welche MIME-Types genau?
- [Affects R10][Technical] Telegram-Bot: Webhook oder Long Polling? Bestehende Hermes-Integration als Referenz nutzen.
- [Affects R2][Technical] SSE-Event-Format im Detail: Sollen Events als JSON-Lines oder als SSE-Standard-Format (`event:`, `data:`) gesendet werden?
