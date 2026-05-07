---
actors:
  - A1: User (Agentur-Inhaber) — definiert Workflows, startet sie manuell, sieht Ergebnisse
  - A2: Orchestrator (System) — führt Workflows aus, routet Tasks, managed State
  - A3: Agents (Dev, SEO, Content, PM, Office) — führen einzelne Workflow-Steps aus
flows:
  - F1: Workflow manuell starten
  - F2: Workflow Step-Sequenz (sequentiell)
  - F3: Parallele Steps
  - F4: Konditionale Steps
  - F5: Skill-basiertes Routing
  - F6: Event-getriggerte Workflows
acceptance_examples:
  - AE1: Content-Pipeline läuft Research → Draft → SEO → Publish (covers F1, F2)
  - AE2: Parallel: Dev + SEO arbeiten gleichzeitig an verschiedenen Steps (covers F3)
  - AE3: Konditional: Wenn Step fehlschlägt, anderer Pfad (covers F4)
  - AE4: Task "TypeScript Bug fix" wird an Dev@ProjektA geroutet (covers F5)
  - AE5: Workflow startet automatisch wenn task.complete Event eintrifft (covers F6)
status: draft
date: 2026-05-07
---

# pragents M2 — Orchestrate: Requirements

## Summary

M2 erweitert pragents um eine Workflow-Engine für sequentielle, parallele und konditionale Agent-Workflows, Skill-basiertes Routing von Tasks zum richtigen Agenten, und Event-getriggerte Workflow-Starts. Workflows werden als separate YAML-Dateien definiert und bei Bedarf manuell oder durch System-Events gestartet.

**Deferred to M2.5:** NL Delegation (natürlichsprachliche Aufgabenzerlegung durch LLM) und Plan Review UI.

---

## Problem Frame

M1 gab uns: Agent Sessions, Task Tracking, Memory, Web UI Dashboard. Aber Tasks sind isoliert — jeder Task läuft einzeln, manuell dispatched. Es gibt keine Komposition: "Erst Research, dann Draft, dann SEO, dann Publish" erfordert vier manuelle Dispatch-Schritte und der User muss sich merken welcher Task als nächstes kommt.

M2 gibt dem System die Fähigkeit, **mehrstufige Prozesse selbstständig durchzuführen**: ein Workflow definiert die Schrittfolge, der Orchestrator führt sie aus, das Routing findet den richtigen Agenten, und Events triggern automatisch Folge-Workflows.

---

## Requirements

### Workflow Engine

- **R1.** Workflows werden als separate YAML-Dateien unter `workflows/*.yaml` definiert. Jede Datei enthält genau einen Workflow mit `name`, optionaler `description`, und `steps`.
- **R2.** Ein Workflow-Step hat: `id`, `agent` (Agent-ID oder Routing-Regel), `prompt` (Task-Beschreibung), optional `input` (Output eines vorherigen Steps), optional `output` (Name für Output-Weitergabe), optional `timeout`.
- **R3.** Steps können **sequentiell** (Standard), **parallel** (Steps ohne Abhängigkeiten laufen gleichzeitig), und **konditional** (`condition`-Feld, z.B. `"steps.tests.status === 'completed'"`) sein.
- **R4.** Step-Outputs werden als Inputs an nachfolgende Steps weitergereicht. Referenzierung via `input: step_id` oder `input: step_id.output_field`.
- **R5.** Workflow-State (Runs, Steps, Status) wird in SQLite persistiert. Bei Server-Neustart werden unterbrochene Workflows wieder aufgenommen.
- **R6.** Workflow-Timeout: globaler Timeout pro Workflow, Timeout pro Step. Bei Überschreitung → Step/Workflow als `failed` markiert.

### Workflow Trigger

- **R7.** Manueller Start via `POST /api/v1/workflows/:name/run` mit optionalen Parametern.
- **R8.** Event-basierter Start: Workflows können einen `trigger` definieren (z.B. `event: task.complete`, optional gefiltert nach `agentId` oder `projectId`). Der Event-Bus aus M1 (U5 EventBuffer) feuert Matching-Workflows.

### Skill-basiertes Routing

- **R9.** Agent-Skills sind in `pragents.yaml` als String-Array pro Agent definiert (vorhanden aus M1).
- **R10.** Routing-Mechanismus: **Keyword-Matching** (Task-Text wird gegen Agent-Skill-Tags gematched) als primärer Mechanismus. **LLM-Fallback** wenn >1 Match oder 0 Matches — ein einzelner LLM-Call wählt den besten Agenten aus den verfügbaren.
- **R11.** Routing-Ergebnis ist deterministisch reproduzierbar (Keyword-Match) oder nachvollziehbar geloggt (LLM-Fallback).
- **R12.** Workflow-Steps können statt einer festen Agent-ID eine **Routing-Regel** angeben: `agent: { route_by: "skills", prefer: ["typescript", "react"] }`.

### API & Observability

- **R13.** REST-Endpoints: `GET /api/v1/workflows` (Liste), `GET /api/v1/workflows/:name` (Definition), `POST /api/v1/workflows/:name/run` (Start), `GET /api/v1/workflows/runs` (Historie), `GET /api/v1/workflows/runs/:id` (Detail mit Step-Status).
- **R14.** Workflow-Events (step_started, step_completed, step_failed, workflow_completed, workflow_failed) werden in den existierenden Event-Bus (U5) eingespeist und im Web UI Activity-Stream sichtbar.
- **R15.** Web UI erhält einen "Workflows"-Tab mit Workflow-Liste, Run-Historie und Live-Status der aktiven Steps.

---

## Key Decisions

- **Workflow-Format:** Separate `workflows/*.yaml` Dateien (nicht inline in pragents.yaml). *Begründung: Skaliert auf 20+ Workflows, git-trackbar pro Workflow, keine Config-Kontamination. Siehe Team-Debatte (architect/devops/pragmatist).*
- **Skill-Routing:** Keyword-Matching mit LLM-Fallback. *Begründung: Industrie-Standard (Anthropic "start simple", LangGraph conditional edges). Keyword ist deterministisch und kostenlos. LLM nur als Fallback — minimale Token-Kosten.*
- **Event-Trigger:** Nutzt existierenden EventBuffer aus M1. *Begründung: Keine neue Infrastruktur nötig. Events sind bereits da — sie müssen nur Workflow-Starts auslösen.*
- **State in SQLite:** Workflow-Runs und -Steps in neuen Tabellen (`workflow_runs`, `workflow_steps`). *Begründung: Folgt M1-Pattern (Tasks in SQLite). Persistenz über Neustarts. Checkpointing implizit durch Step-Status.*

---

## Scope Boundaries

### In Scope (M2)
- Workflow-Engine: sequentiell, parallel, konditional
- Workflow-Definition: `workflows/*.yaml`
- Skill-basiertes Routing: Keyword + LLM-Fallback
- Workflow-Trigger: manuell (API) + Event-basiert
- Workflow-State in SQLite mit Crash-Recovery
- REST API + WebSocket Events + Web UI Tab
- Agent-Routing-Regeln in Workflow-Steps

### Deferred to M2.5
- NL Delegation (LLM zerlegt natürliche Sprache in Subtasks)
- Plan Review UI (User sieht und editiert den LLM-Plan)

### Deferred for later
- Cron-Scheduler (M2 laut Spec, aber User verschoben)
- Quality Gates (programmatische Checks)
- Human Gates (User-Approval im Workflow)
- Workflow-UI-Editor (visuelle Workflow-Erstellung)
- Escalation (automatische PM-Benachrichtigung bei Failure)

---

## Success Criteria

- Ein 4-Step sequentieller Workflow (Research → Draft → SEO → Publish) läuft vollständig durch ohne manuellen Eingriff
- Parallele Steps starten gleichzeitig und der Workflow wartet auf beide bevor er fortsetzt
- Ein konditionaler Step wählt den korrekten Pfad basierend auf Step-Output
- Task "TypeScript Bug fix" wird korrekt an Dev@ProjektA geroutet (nicht an SEO@ProjektA)
- Ein Event `task.complete` triggert automatisch einen Follow-up-Workflow
- Nach Server-Neustart wird ein unterbrochener Workflow an der letzten erfolgreichen Step-Grenze fortgesetzt

---

## Sources & References

- **Design Spec:** [docs/superpowers/specs/2026-05-06-pragents-design.md](../superpowers/specs/2026-05-06-pragents-design.md) — M2-Scope, Workflow-YAML-Format, Skill-Routing
- **M1 Plan:** [docs/plans/2026-05-07-001-feat-pragents-m1-core-plan.md](../plans/2026-05-07-001-feat-pragents-m1-core-plan.md) — bestehende Architektur, EventBuffer, TaskTracker
- **Industry Research:** Anthropic "Building Effective Agents", LangGraph Supervisor Pattern, AutoGen GroupChat, CrewAI, OpenAI Swarm — Skill-Routing-Patterns
- **Team Decisions:** Workflow-Format-Debatte (architect/devops/pragmatist, 2026-05-07), Skill-Routing-Recherche (ce-web-researcher)
