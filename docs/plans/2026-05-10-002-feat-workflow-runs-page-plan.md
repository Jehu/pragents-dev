---
title: "feat: Workflow Runs Dashboard Page"
type: feat
status: completed
date: 2026-05-10
origin: docs/brainstorms/2026-05-10-workflow-page-requirements.md
---

# feat: Workflow Runs Dashboard Page

## Summary

Eine dedizierte "Workflows"-Seite in der Web-UI: Workflows triggern, Runs mit Status und Steps einsehen, Gate-Wartezeiten erkennen. Ersetzt den aktuellen API-only-Zugang. Die API wird minimal erweitert, um Gate-Status im Run-Detail-Kontext zu liefern.

## Requirements

Siehe Origin-Dokument für die vollständigen Requirements. Kurz:

- **R1:** Run-Liste mit Status-Badges und Gate-Markern
- **R2:** Run-Detail mit Steps (Status, Output-Preview, Gate-Info)
- **R3:** Workflow triggern per Button
- **R4:** Auto-Refresh (5s Polling)
- **R5:** Nav-Punkt "Workflows"

**Origin actors:** A1 (Agency Owner)

## Context & Research

### Relevant Code and Patterns

- **Web routing:** TanStack Router file-based routes unter `web/src/routes/`. Neue Route: `web/src/routes/workflows/index.tsx`
- **Navigation:** `web/src/routes/__root.tsx` — `<nav>` mit Link-Komponenten für Dashboard, Feed, Memory, Traces, Tasks
- **Dashboard-Pattern:** `web/src/routes/index.tsx` — `useQuery` mit `refetchInterval: 5000` für Auto-Refresh, Status-Badges mit Tailwind-Farben
- **Task-Detail-Pattern:** `web/src/routes/tasks/index.tsx` — Expand/Collapse für Task-Details
- **Feed-Pattern:** `web/src/components/FeedView.tsx` — `relativeTime()`-Helper, `statusBadge()`-Funktion
- **API-Route-Pattern:** `server/src/api/routes/workflows.ts` — bestehende Workflow-Endpoints, Hono-Router
- **Gate-API:** `server/src/api/routes/gates.ts` — `GET /pending` für Gate-Status
- **Workflow-Tracker:** `server/src/workflows/tracker.ts` — `getSteps()` liefert Steps ohne Gate-Info

### API Analysis

Bestehende Endpoints:
- `GET /api/v1/workflows` → `[{ name, description, steps, trigger }]`
- `POST /api/v1/workflows/:name/run` → `{ runId, status }`
- `GET /api/v1/workflows/runs` → `[{ id, workflowName, status, startedAt, completedAt }]`
- `GET /api/v1/workflows/runs/:id` → `{ ...run, steps: [{ id, stepId, status, output, startedAt, completedAt }] }`

Lücke: Steps haben keinen Gate-Status. Ein `human_gate`-Step zeigt nur `status: 'complete'` oder `status: 'failed'` — nicht ob das Gate `pending`/`approved`/`revision_requested` ist.

## Key Technical Decisions

- **Gate-Info via JOIN im `/runs/:id`-Endpoint:** Statt eines neuen Endpoints wird der bestehende `/runs/:id`-Response um Gate-Daten pro Step angereichert. Für jeden Step wird via `LEFT JOIN human_gates` auf `workflow_run_id + step_id` der Gate-Status und das Feedback geladen. Das ist ein einziger Query und hält die API surface flach.
- **WorkflowPage als eigene Route, nicht Dashboard-Sektion:** Die Requirements verlangen einen eigenen Nav-Punkt. Die Seite bekommt eine eigene Route `/workflows`, analog zu `/tasks` und `/traces`.
- **Trigger-UI als kompakte Card-Liste oben:** Die verfügbaren Workflows werden als kleine Cards mit Name, Description und "Run"-Button dargestellt — nicht als Tabelle. Das skaliert für 1–5 Workflows besser.
- **Step-Output-Trunkierung clientseitig:** Der Output kann sehr lang sein (Agent-Responses). Der Server liefert den vollen Output, das UI kürzt auf ~500 Zeichen mit "Show more"-Toggle. Kein Server-seitiges Trunkieren — breaking change für API-Consumer.
- **Status-Badge-Farben aus FeedView wiederverwenden:** `statusBadge()`-Funktion aus `FeedView.tsx` in ein shared `lib/badges.ts` extrahieren oder duplizieren. Duplizieren ist für 2 Consumers akzeptabel; Extraktion lohnt sich beim dritten.

## Implementation Units

### U1. API: Gate-Info in Run-Detail anreichern

**Goal:** `GET /api/v1/workflows/runs/:id` liefert pro Step auch `gateStatus` und `gateFeedback`, wenn der Step ein human_gate ist.

**Requirements:** R2 (Gate-Status im Detail sichtbar)

**Dependencies:** None

**Files:**
- Modify: `server/src/api/routes/workflows.ts` (Run-Detail-Handler)
- Modify: `server/src/api/routes/__tests__/workflows.test.ts` (falls existent, sonst create)

**Approach:**

Im `r.get('/runs/:id')`-Handler nach dem `tracker.getSteps(run.id)` die Steps mit Gate-Daten anreichern:

```typescript
const stepsWithGates = steps.map((step: any) => {
  const gate = db.prepare(
    'SELECT status as gateStatus, feedback as gateFeedback FROM human_gates WHERE workflow_run_id = ? AND step_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(run.id, step.stepId) as any;
  return { ...step, gateStatus: gate?.gateStatus || null, gateFeedback: gate?.gateFeedback || null };
});
```

- `gateStatus`: `null` für agent-Steps, `'pending' | 'approved' | 'rejected' | 'timed_out' | 'revision_requested'` für gate-Steps
- `gateFeedback`: `null` oder der Feedback-Text
- Response-Struktur bleibt additiv — bestehende Felder unverändert

**Patterns to follow:**
- `server/src/api/routes/workflows.ts` — bestehender Handler als Template
- `server/src/api/routes/feed.ts` — Gate-Enrichment-Pattern (graceful degradation)

**Test scenarios:**
- Happy path: Run mit human_gate-Step → gateStatus und gateFeedback im Response
- Happy path: Run mit nur agent-Steps → gateStatus = null für alle Steps
- Edge case: Run mit mehreren Gates (revision) → nur letztes Gate pro Step (ORDER BY created_at DESC LIMIT 1)
- Edge case: Step ohne Gate in DB → gateStatus = null (kein Fehler)

**Verification:**
- `curl /api/v1/workflows/runs/:id` zeigt `gateStatus` und `gateFeedback` in den Steps

---

### U2. Frontend: WorkflowPage-Komponente

**Goal:** Neue Route `/workflows` mit Trigger-Sektion, Run-Tabelle und expandierbaren Run-Details.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1 (API liefert Gate-Info)

**Files:**
- Create: `web/src/routes/workflows/index.tsx`

**Approach:**

Komponenten-Struktur (alles in einer Datei):

```
WorkflowPage
├── Trigger-Sektion ("Available Workflows")
│   └── WorkflowCard (name, description, steps, "Run"-Button)
├── Run-Tabelle ("Recent Runs")
│   └── RunRow (workflowName, status-Badge, startedAt, ⏳-Marker, aufklappbar)
│       └── RunDetail (expandiert)
│           └── StepTimeline (stepId, status, Output-Preview, Gate-Info)
```

**Trigger-Sektion:**
- `useQuery` auf `GET /api/v1/workflows`
- Pro Workflow eine Card mit Name, Description, "N steps", Run-Button
- Button disabled während `submitting`, danach `queryClient.invalidateQueries(['workflow-runs'])`

**Run-Tabelle:**
- `useQuery` auf `GET /api/v1/workflows/runs` mit `refetchInterval: 5000`
- Sortiert nach `startedAt` DESC
- Status-Badge: `statusBadge()`-Mapping (running=blau, complete=grün, failed=rot, interrupted=grau)
- ⏳-Marker: wenn einer der Steps `gateStatus === 'pending' || gateStatus === 'revision_requested'` → amber left border + ⏳-Icon
- `relativeTime()` für Started-Column
- Dauer: `completedAt - startedAt` als "Xm Ys"

**Run-Detail (expandiert):**
- onClick auf RunRow → `expandedRunId`-State
- Steps als vertikale Timeline: Step-Name, Status-Icon, Startzeit
- Output-Preview: erste 500 Zeichen in `<pre>`, "Show more"-Button für vollen Text
- Gate-Info: wenn `gateStatus === 'pending'` → "⏳ Waiting for approval", wenn `approved` → "✅ Approved", etc.
- Laufende Steps: Spinner/Animation

**Patterns to follow:**
- `web/src/routes/index.tsx` — Dashboard: useQuery, refetchInterval, Status-Badges
- `web/src/routes/tasks/index.tsx` — Task-Liste: Expand/Collapse-Pattern
- `web/src/components/FeedView.tsx` — `relativeTime()`, `statusBadge()`, GateCard-Farben

**Test scenarios (manuell, kein React-Test-Framework):**
- Happy path: Workflows geladen → "Run" klicken → Run erscheint in Tabelle
- Happy path: Run expandieren → Steps sichtbar mit Status und Output
- Happy path: Gate-Step zeigt "Waiting for approval" wenn pending
- Edge case: Keine Runs → "No workflow runs yet"-Message
- Edge case: API-Fehler → Error-State (try/catch im useQuery)
- Auto-Refresh: Laufender Run updated Status ohne manuellen Reload

**Verification:**
- `/workflows` im Browser öffnen
- Workflow triggern → Run erscheint
- Run expandieren → Steps sichtbar
- Gate-Step zeigt korrekten Status

---

### U3. Navigation: "Workflows" in __root.tsx

**Goal:** Nav-Punkt "Workflows" zwischen Feed und Memory in der Navigation.

**Requirements:** R5

**Dependencies:** U2 (Route existiert)

**Files:**
- Modify: `web/src/routes/__root.tsx`

**Approach:**
- `<Link to="/workflows">Workflows</Link>` zwischen Feed und Memory einfügen
- Reihenfolge: Dashboard | Feed | **Workflows** | Memory | Traces | Tasks

**Verification:**
- "Workflows" erscheint in der Nav-Leiste
- Klick navigiert zu `/workflows`

---

## System-Wide Impact

- **API surface:** Additiv — `/runs/:id` bekommt zwei neue Felder pro Step (`gateStatus`, `gateFeedback`). Bestehende Consumer brechen nicht.
- **Frontend:** Neue Route, kein bestehender Code geändert außer `__root.tsx`.
- **Keine DB-Änderungen.**
- **Keine neuen Abhängigkeiten.**

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Step-Output kann sehr groß sein (Agent-Responses mit Markdown-Tables) | Clientseitiges Trunkieren auf 500 Zeichen mit "Show more". API liefert vollen Output — kein Breaking Change. |
| Content-Pipeline ist der einzige Workflow — Page könnte leer wirken | Cards-Layout skaliert visuell für 1–5 Workflows. "No runs yet"-Message wenn keine Runs existieren. |
