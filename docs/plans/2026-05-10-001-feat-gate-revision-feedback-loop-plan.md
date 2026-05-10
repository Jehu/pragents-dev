---
title: "feat: Workflow gate revision feedback loop"
type: feat
status: completed
date: 2026-05-10
origin: docs/brainstorms/2026-05-10-gate-revision-feedback-requirements.md
---

# feat: Workflow gate revision feedback loop

## Summary

Human workflow gates erhalten einen dritten Auflösungspfad: „Revision anfordern" mit Freitext-Feedback. Die Workflow-Engine dispatched den vorherigen Step-Agenten erneut mit dem Feedback im Prompt, der Agent überarbeitet, und das Gate erscheint zur erneuten Prüfung (gate_retry). Ein kanal-agnostischer API-Endpunkt (`POST /gates/:id/revision`) bedient Web-UI und zukünftige Kanäle (Telegram) gleichermaßen.

---

## Problem Frame

Heute sind Human Gates binär: Approve lässt den Workflow weiterlaufen, Reject lässt ihn fehlschlagen. Es gibt keinen Weg, dem Agenten konkretes Feedback zu geben („Ton zu technisch", „Abschnitt 3 fehlt"). Der Nutzer muss entweder schlechte Arbeit akzeptieren oder den gesamten Workflow verwerfen — ein Code-Review ohne Kommentarfunktion. Siehe Origin-Dokument für die vollständige Problemstellung.

---

## Requirements

**Gate-Status und Feedback**
- **R1.** `human_gates.status` um `revision_requested` erweitern
- **R2.** `human_gates.feedback TEXT` für Freitext-Feedback
- **R3.** Beliebig viele Revision-Zyklen pro Gate (kein künstliches Limit)

**Agent-Dispatch**
- **R4.** Bei Revision: Workflow-Engine dispatched den vorherigen Step-Agenten erneut mit Feedback + vorherigem Output im Prompt
- **R5.** Kein Session-Tracking — frischer `dispatch()`-Aufruf wie beim ursprünglichen Step

**Multi-Channel-API**
- **R6.** `POST /api/v1/gates/:id/revision` mit Body `{ feedback: string }` — einziger, kanal-agnostischer Endpunkt
- **R7.** Validierung: Gate muss `pending` sein, Feedback nicht leer

**UI — Web**
- **R8.** GateCard zeigt Textarea + „Request Revision"-Button im expandierten Zustand
- **R9.** Nach Revision: Bestätigungszustand („Revision requested"), Card schließt sich
- **R10.** Gate erscheint nach Überarbeitung erneut mit sichtbarem Feedback-Kontext

**Feedback-Transparenz**
- **R11.** Nur letztes Feedback sichtbar (nicht kumulativ)
- **R12.** Überarbeiteter Output ersetzt vorherigen Output (kein Diff in v1)

**UI — Telegram (Design-Vorgabe)**
- **R13.** Bot mapped Reply→`POST /gates/:id/revision`

**Origin actors:** A1 (Agency Owner), A2 (Workflow-Agent), A3 (pragents Server)
**Origin flows:** F1 (Revision Web-UI), F2 (Revision Telegram), F3 (Mehrere Revisionen)
**Origin acceptance examples:** AE1 (covers R1-R5), AE2 (covers R3/R7), AE3 (covers R6/R7), AE4 (covers R8-R10), AE5 (covers R11), AE6 (covers R13)

---

## Scope Boundaries

- Kein Diff/Version-Vergleich zwischen Revisionen (v1)
- Kein „Approve with comments" — Approve und Revision sind getrennte Aktionen
- Keine Agent-seitige Garantie der Feedback-Umsetzung
- Keine Telegram-Implementierung in diesem Plan — nur API-Design, das Telegram ermöglicht
- Keine Änderung am bestehenden Approve/Reject-Verhalten
- Kein kumulativer Feedback-Verlauf — nur letztes Feedback wird gespeichert und gezeigt

---

## Context & Research

### Relevant Code and Patterns

- **Workflow-Engine:** `server/src/workflows/engine.ts` — `waitForGate()` (Polling-Loop, aktuell void), `executeSteps()` (Gate-Handler ohne Retry), `buildPrompt()` (Prompt-Konstruktion mit Kontext), `dispatch()`-Aufruf
- **WorkflowTracker:** `server/src/workflows/tracker.ts` — `createStep()`, `startStep()`, `completeStep()`, `failStep()`
- **AgentSessionManager:** `server/src/agents/manager.ts` — `dispatch(agent, task)` — wiederverwendbar für Re-Dispatch
- **Gate API:** `server/src/api/routes/gates.ts` — bestehende Approve/Reject-Endpoints als Pattern (Guard: status === 'pending', Event-Emission nach DB-Update)
- **Feed API:** `server/src/api/routes/feed.ts` — Gate-Enrichment mit Workflow-Kontext (seit `fix/gate-approval-context-ui`)
- **Datenbank:** `server/src/db/migrations/006_human_gates.sql` — aktuelles Gate-Schema, `002_workflows.sql` — workflow_runs/steps
- **GateCard:** `web/src/components/FeedView.tsx` — expandable card mit Approve/Reject-Buttons, Confirmation-State, Error-Handling
- **Index wiring:** `server/src/index.ts` — Route-Mounting, Dependency Injection

### Institutional Learnings

- **Gate-Status-Übergänge müssen guarded sein** (`docs/solutions/architecture-patterns/agent-native-task-feed-inbox-2026-05-08.md`): Definiere explizit welche Transitionen erlaubt sind. `pending → revision_requested` und `revision_requested → pending` (nach Agent-Überarbeitung). Verhindere `revision_requested → approved` ohne erneutes Review.
- **Feedback in dedizierter Spalte** (gleiches Learning): Wie das `reason`-Feld bei Tasks gehört Feedback in eine eigene `feedback TEXT`-Spalte, nicht in bestehende Felder.
- **Jeder Status-Wechsel emittiert ein Event**: `gate.revision_requested` muss via EventBuffer emittiert werden, damit SSE→Invalidation→Refetch den UI-Update triggert.
- **API-Änderungen additiv halten** (`docs/solutions/integration-issues/api-response-shape-change-breaks-consumers-2026-05-09.md`): Gate-Response-Felder nur hinzufügen, nicht restrukturieren. Grep alle Consumer vor dem Landing.
- **`list_pending_attention`-Tool updaten**: Agenten brauchen Sichtbarkeit auf revision-requested Gates für Situationsbewusstsein vor Re-Dispatch.

### External References

Keine — starke lokale Patterns für alle betroffenen Bereiche.

---

## Key Technical Decisions

- **waitForGate() wird signal-returning:** Rückgabetyp wechselt von `void` zu `'approved' | 'rejected' | 'timed_out' | 'revision_requested'`. Der Aufrufer in `executeSteps()` verzweigt basierend auf dem Return-Wert. Bei `revision_requested` wird der vorherige Step erneut dispatched statt den Workflow fehlschlagen zu lassen.
- **Revision-Loop in executeSteps() als do...while:** Der Gate-Handler wird von einem einmaligen `await waitForGate()` + if/else zu einer Schleife: `do { resolution = await waitForGate(); if approved → complete + break; if revision → re-dispatch + create new gate + continue; if rejected → fail + throw; } while (true)`. Bei Timeout bricht die Schleife via throw wie bisher.
- **Neues Gate pro Revision, nicht Status-Reset:** Nach einer Revision wird ein neues Gate in `human_gates` angelegt (neue ID, neues `created_at`, neues `timeout_at`). Das alte Gate bleibt mit Status `revision_requested` in der DB. Das neue Gate erscheint im Feed. Vorteil: Audit-Trail, Timeout wird pro Revision zurückgesetzt, keine Status-Hin-und-her-Schreiberei.
- **Revision-Prompt als buildPrompt()-Erweiterung:** Der Prompt für den Re-Dispatch wird nach demselben Muster wie `buildPrompt()` konstruiert: „## Revision Request\n\nYour previous output:\n<output>\n\n### Reviewer Feedback\n<feedback>\n\n---\n\nPlease revise.\nOriginal task:\n<step.prompt>". Der vorherige Output wird eingebettet (siehe Origin Q1).
- **Feedback nur auf dem aktuellsten Gate sichtbar:** Das `feedback`-Feld wird auf dem neuen Gate (nach Revision) als Kontext gespeichert, aber UI zeigt nur das Feedback der aktuellsten Revision (siehe Origin Q2). Kein kumulativer Verlauf.
- **Kein neuer Feed-Bucket für revision_requested:** Gates mit `revision_requested` erscheinen nicht im Feed — sie sind „in Bearbeitung" durch den Agenten. Erst das neue Gate (wieder `pending`) erscheint. Der Feed-Endpoint filtert `WHERE status = 'pending'` — das deckt automatisch nur die aktiven Gates ab.

---

## Open Questions

### Resolved During Planning

- **Q1 (waitForGate-Rückgabe vs Exception):** Signal-returning (`'revision_requested'`), nicht Exception. Siehe Key Technical Decisions.
- **Q2 (Gate-Reset vs neues Gate):** Neues Gate pro Revision. Siehe Key Technical Decisions.
- **Q3 (Feed-Bucket für Revision-Gates):** Kein neuer Bucket — revision_requested-Gates erscheinen nicht im Feed. Siehe Key Technical Decisions.
- **Q4 (Prompt-Template):** buildPrompt()-Erweiterung mit vorherigem Output + Feedback. Siehe Key Technical Decisions.
- **Q5 (Feedback-Verlauf-Speicherung):** Nur letztes Feedback auf dem neuen Gate. Siehe Key Technical Decisions.

### Deferred to Implementation

- Exaktes Prompt-Template-Wording („Revision Request" vs „Feedback from reviewer")
- Maximale Feedback-Textlänge (DB-seitig: TEXT unbegrenzt, UI-seitig: ~2000 Zeichen sinnvoll)
- CSS-Details für Textarea im GateCard (Höhe, Placeholder-Text, Positionierung relativ zu Approve/Reject)
- Feingranulare Prompt-Struktur (z.B. ob der Output zusätzlich als separates dispatch-Argument übergeben wird)

---

## Implementation Units

### U1. Database migration — feedback column and status handling

**Goal:** `human_gates` um `feedback TEXT` erweitern und Status-Logik auf `revision_requested` vorbereiten.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Create: `server/src/db/migrations/012_gate_revision.sql`
- Modify: `server/src/db/sqlite.ts` (Migrations-Registry, falls vorhanden)

**Approach:**
- SQLite `ALTER TABLE human_gates ADD COLUMN feedback TEXT;`
- SQLite erlaubt kein ALTER CHECK constraint — Status-Validierung (`revision_requested`) erfolgt auf Applikationsebene (in der Route und im Engine-Code), nicht via DB-Constraint
- Kein Table-Rebuild nötig — die existierenden CHECK-Constraints bleiben, neue Status-Werte werden im Code validiert

**Patterns to follow:**
- `server/src/db/migrations/006_human_gates.sql` — bestehende Gate-Migration als Template
- `server/src/db/sqlite.ts` — `initDb()` — wie Migrationen eingelesen und ausgeführt werden

**Test scenarios:**
- Happy path: Migration läuft, `feedback`-Spalte existiert, bestehende Gates haben `feedback = NULL`
- Edge case: Migration auf bestehender DB mit Gates — kein Datenverlust, NULL ist valider Default

**Verification:**
- `sqlite3 ~/.pragents/data/pragents.db "PRAGMA table_info(human_gates);"` zeigt `feedback`-Spalte
- Existierende Gates haben `feedback IS NULL`

---

### U2. Workflow engine revision loop

**Goal:** `waitForGate()` erkennt `revision_requested`, `executeSteps()` dispatched den vorherigen Step erneut und erstellt ein neues Gate.

**Requirements:** R3, R4, R5

**Dependencies:** U1 (feedback-Spalte muss existieren)

**Files:**
- Modify: `server/src/workflows/engine.ts` (waitForGate, executeSteps gate handler)
- Modify: `server/src/workflows/__tests__/engine.test.ts` (falls existent, sonst create)

**Approach:**

`waitForGate()` Änderungen:
- Rückgabetyp: `Promise<'approved' | 'rejected' | 'timed_out' | 'revision_requested'>`
- Polling-Loop erkennt `status = 'revision_requested'` zusätzlich zu approved/rejected
- Bei `revision_requested`: returned `'revision_requested'` (kein Timeout-Update)
- Timeout-Logik unverändert

`executeSteps()` Gate-Handler Änderungen:
- Aktueller Code (einmalig):
  ```
  await this.waitForGate(gateId, timeoutMs, ...);
  if (approved) completeStep(); else failStep() + throw;
  ```
- Neuer Code (Revision-Loop):
  ```
  let gateId = currentGateId;
  while (true) {
    const resolution = await this.waitForGate(gateId, timeoutMs, ...);
    if (resolution === 'approved') {
      tracker.completeStep(stepRow.id, 'approved');
      break;
    }
    if (resolution === 'revision_requested') {
      // Get feedback from the gate
      const gate = db.prepare('SELECT feedback FROM human_gates WHERE id = ?').get(gateId);
      // Find previous step in workflow definition
      const prevStep = def.steps[def.steps.findIndex(s => s.id === step.id) - 1];
      // Build revision prompt
      const revisionPrompt = this.buildRevisionPrompt(prevStep, gate.feedback, outputs);
      // Re-dispatch previous step's agent
      const prevAgentId = await this.resolveAgent(prevStep);
      const prevAgent = this.agents.find(a => a.id === prevAgentId);
      const revisedOutput = await this.sessionMgr.dispatch(prevAgent, revisionPrompt);
      // Store revised output
      if (prevStep.output) outputs[prevStep.output] = revisedOutput;
      // Create new gate for re-review
      gateId = randomUUID();
      const newTimeoutAt = new Date(Date.now() + timeoutMs).toISOString();
      db.prepare(
        'INSERT INTO human_gates (id, workflow_run_id, step_id, label, timeout_at, feedback) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(gateId, runId, step.id, step.label, newTimeoutAt, gate.feedback);
      this.emit('workflow.human_gate_pending', { runId, stepId: step.id, gateId, label: step.label, timeoutAt: newTimeoutAt });
      // Loop continues — polls the new gate
      continue;
    }
    // rejected or timed_out
    tracker.failStep(stepRow.id, `gate ${resolution}`);
    throw new Error(`Human gate "${step.label}" was ${resolution}`);
  }
  ```

`buildRevisionPrompt()` (neue private Methode):
- Nimmt den vorherigen Step, das Feedback, und die outputs-Map
- Baut Prompt nach Template: „## Revision Request\n\nYour previous output:\n{output}\n\n### Reviewer Feedback\n{feedback}\n\n---\n\nPlease revise your work based on the feedback above.\n\nOriginal task:\n{step.prompt}"

**Patterns to follow:**
- `buildPrompt()` in `engine.ts` — Prompt-Konstruktion mit Kontext
- `waitForGate()` in `engine.ts` — Polling-Loop mit exponentiellem Backoff
- `dispatch()`-Aufruf in `engine.ts` — Agent-Resolution + Session-Dispatch

**Test scenarios:**
- Happy path: Gate pending → POST revision → waitForGate returns 'revision_requested' → previous step re-dispatched → new gate created → new gate polled → approved → workflow continues
- Happy path: Two revisions in sequence — gate1 → revision → gate2 → revision → gate3 → approved
- Edge case: Revision auf Gate ohne vorherigen Step (erster Step ist Gate). Sollte nicht vorkommen (human_gate kann nicht Step 0 sein), aber defensiv behandeln: Error werfen oder Revision ignorieren
- Edge case: Agent-Dispatch schlägt fehl während Revision. Workflow-Step wird als failed markiert, Workflow fehlschlägt
- Error path: Revision auf bereits approved/rejected Gate → `revision_requested` wird nie erreicht, waitForGate returned sofort
- Covers AE1: content-pipeline mit research→draft→review gate, Revision mit Feedback, Agent überarbeitet, neues Gate erscheint
- Covers AE2: Drei Revisionen in Folge ohne Fehler

**Verification:**
- Workflow mit human_gate-Step starten, Gate per API auf revision_requested setzen, Engine pollt und dispatched Agenten erneut
- Agent-Output wird in `outputs` aktualisiert
- Neues Gate erscheint in `human_gates` mit Status `pending`
- Workflow läuft nach Approve des neuen Gates normal weiter

---

### U3. Revision API endpoint

**Goal:** `POST /api/v1/gates/:id/revision` Endpunkt, der Gate-Status setzt, Feedback speichert und Event emittiert.

**Requirements:** R6, R7

**Dependencies:** U1 (feedback-Spalte), U2 (Engine reagiert auf revision_requested)

**Files:**
- Modify: `server/src/api/routes/gates.ts`
- Modify: `server/src/api/routes/__tests__/gates.test.ts`

**Approach:**
- Neuer Route-Handler: `r.post('/:id/revision', async (c) => { ... })`
- Body parsen: `const { feedback } = await c.req.json();`
- Validierung: Gate existiert, Status ist `pending`, Feedback nicht leer
- DB-Update: `UPDATE human_gates SET status = 'revision_requested', feedback = ?, approved_at = ? WHERE id = ?`
- Event-Emission: `eventBuffer.push('workflow', undefined, 'gate.revision_requested', { gateId, workflowRunId, stepId, label, feedback })`
- Response: `{ status: 'revision_requested' }`

**Patterns to follow:**
- `server/src/api/routes/gates.ts` — bestehende Approve/Reject-Handler (identisches Guard-Muster)
- Zod-Validierung für Request-Body (folgt Codebase-Konvention)

**Test scenarios:**
- Happy path: POST /gates/:id/revision mit validem Feedback → 200, Gate-Status ist `revision_requested`, Feedback gespeichert
- Error path: POST auf nicht-existierendes Gate → 404
- Error path: POST auf bereits approved/rejected Gate → 400 „Gate is not pending"
- Error path: POST mit leerem Feedback → 400 „Feedback is required"
- Error path: POST ohne JSON-Body → 400
- Covers AE3: Revision auf pending Gate funktioniert, auf approved Gate returned 400

**Verification:**
- `curl -X POST /api/v1/gates/:id/revision -d '{"feedback":"test"}'` returned `{ status: 'revision_requested' }`
- Gate in DB hat `status = 'revision_requested'` und `feedback = 'test'`
- Event `gate.revision_requested` wurde emittiert

---

### U4. GateCard revision UI

**Goal:** Textarea + „Request Revision"-Button im expandierten GateCard, mit Bestätigungszustand und Error-Handling.

**Requirements:** R8, R9, R10, R11, R12

**Dependencies:** U3 (API-Endpunkt existiert)

**Files:**
- Modify: `web/src/components/FeedView.tsx` (GateCard-Komponente)

**Approach:**

GateCard-Erweiterungen:
- Neuer State: `revisionFeedback` (string), `showRevisionInput` (boolean)
- Neuer Handler: `handleRevision()` — POST an `/gates/:id/revision` mit `{ feedback }` Body
- „Request Revision"-Button in der expanded section (unterhalb Approve/Reject, eigenes Styling: blau/lila)
- Bei Klick auf „Request Revision": Textarea erscheint (falls nicht schon sichtbar)
- Textarea mit Placeholder „What needs to change?"
- Submit-Button „Send Revision Request" neben Textarea
- Nach Submit: gleicher Confirmation-State wie Approve/Reject („Revision requested"), dann `onAction(gate.id, 'revision')`
- Feedback-Kontext-Anzeige: Wenn `gate.feedback` gesetzt ist, wird es unter dem aktuellen Output angezeigt („Your last feedback: [Text]")
- `onAction`-Callback-Signatur erweitern: `(id: string, action: 'approve' | 'reject' | 'revision') => void`

**Patterns to follow:**
- Bestehende `handle`-Funktion in GateCard — API-Call, `acting`-State, Error-Handling
- Confirmation-State-Pattern („Approved"/„Rejected") — auf „Revision requested" erweitern
- SkillProposalCard `expanded`-Pattern — zusätzliche UI-Elemente im expanded state

**Test scenarios:**
- Happy path: GateCard expandiert → „Request Revision" klicken → Textarea erscheint → Feedback eingeben → „Send" klicken → Confirmation-State → Card schließt sich
- Happy path: Gate erscheint nach Revision erneut → Feedback-Text „Your last feedback: ..." sichtbar
- Edge case: Leeres Feedback abschicken → Validierung verhindert Submit (oder Server returned 400)
- Edge case: API-Fehler beim Revision-Senden → Error-Message erscheint, Buttons re-enabled
- Integration: Nach Revision-Submit → `queryClient.invalidateQueries(['feed'])` → Gate verschwindet aus pending-Liste
- Covers AE4: Textarea + Button sichtbar, Confirmation-State nach Submit
- Covers AE5: Feedback-Kontext nach erneutem Erscheinen des Gates

**Verification:**
- `/feed` öffnen, Gate expandieren → „Request Revision"-Button sichtbar
- Feedback eingeben, senden → Gate verschwindet
- Nach Agent-Überarbeitung: Gate erscheint erneut mit Feedback-Kontext
- Approve/Reject-Buttons funktionieren weiterhin unverändert

---

## System-Wide Impact

- **Interaction graph:** `waitForGate()`-Signatur ändert sich (void → string return). Wird nur von `executeSteps()` aufgerufen — kein externer Caller.
- **Error propagation:** Agent-Dispatch-Fehler während Revision führen zum Workflow-Failure (wie bei initialem Dispatch). Kein neuer Error-Pfad.
- **State lifecycle risks:** Bei Server-Restart während `revision_requested`: `recoverStaleRuns()` markiert laufende Runs als `interrupted`. Das revision-requested Gate bleibt in der DB. Beim nächsten Workflow-Trigger startet ein neuer Run — das alte Gate ist obsolet. Akzeptiertes Risiko (wie bei pending Gates).
- **API surface parity:** Neuer Endpoint `POST /gates/:id/revision`. Bestehende Endpoints unverändert. Feed-Response unverändert (pending-Gates erscheinen wie bisher, revision_requested-Gates erscheinen nicht).
- **Unchanged invariants:** Approve/Reject-Verhalten unverändert. `waitForGate()`-Timeout-Logik unverändert. Workflow-Engine-Execute-Pipeline (createRun → executeSteps → completeRun/failRun) unverändert. EventBuffer-Interface unverändert.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Agent-Dispatch schlägt während Revision fehl → Workflow terminiert ohne Feedback an den Nutzer | Workflow-Failure wird via EventBuffer emittiert, erscheint in Feed/Activity. Nutzer kann Workflow manuell neu starten. |
| Unendliche Revision-Loops (Nutzer fordert immer wieder Revision, Agent wird nie gut genug) | Kein technisches Limit, aber jedes Gate hat timeout_at. Nach Timeout → timed_out → Workflow fehlschlägt. Timeout wird pro Revision zurückgesetzt (neues Gate), aber der Nutzer muss aktiv jede Revision anfordern — kein automatisierter Loop. |
| SQLite CHECK-Constraint kann nicht erweitert werden | Status-Validierung erfolgt auf Applikationsebene (Route-Guard + Engine-Logik). DB-Constraint bleibt auf `pending,approved,rejected,timed_out` — `revision_requested` wird nur via Code durchgesetzt. |
