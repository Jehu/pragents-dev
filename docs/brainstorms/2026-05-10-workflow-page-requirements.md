# Workflow Runs Page — Requirements

**Date:** 2026-05-10
**Type:** feature
**Scope:** Standard

## Summary

Eine dedizierte Workflow-Runs-Seite in der Web-UI, die den aktuellen API-only-Zugang ersetzt. Nutzer sollen Workflows triggern, Runs mit Status und Steps einsehen und Gate-Wartezeiten erkennen können — ohne curl oder die API direkt aufzurufen.

## Problem

Heute gibt es keine UI für Workflow-Runs. Nach einem `POST /api/v1/workflows/:name/run` ist der Run unsichtbar. Der Nutzer muss:
- `/api/v1/workflows/runs` per curl aufrufen um zu sehen, ob ein Run läuft
- `/api/v1/workflows/runs/:id` aufrufen um Steps zu sehen
- Im Feed nach Gates suchen um zu wissen, ob ein Run auf Input wartet

Das ist besonders schmerzhaft nach einem Gate-Approval: der nächste Step startet, aber der Nutzer sieht nirgends, dass der Workflow weiterläuft oder wo er gerade steht.

## Actors

- **A1 (Agency Owner):** Möchte Workflow-Status sehen, Runs triggern, Gates im Kontext des Workflows sehen

## Requirements

### R1 — Run-Liste
- Tabelle aller Workflow-Runs, neueste zuerst
- Spalten: Workflow-Name, Status (Badge: running/complete/failed/interrupted), Gestartet (relative time), Dauer (falls completed)
- Runs mit pending/revision_requested Gates visuell hervorheben (z.B. ⏳-Icon oder amber Border)

### R2 — Run-Detail (expandable)
- Run-Zeile aufklappbar → zeigt alle Steps als Timeline/Liste
- Jeder Step: Name (stepId), Status (complete/running/pending/failed/skipped), Startzeit, Dauer
- Complete Steps: Output-Preview (erste ~500 Zeichen, aufklappbar)
- Running Steps: Spinner/Animations-Indikator
- Bei human_gate-Steps: Gate-Status anzeigen (pending → "Waiting for approval", approved → "Approved", etc.)

### R3 — Workflow triggern
- Oben auf der Seite: Liste der verfügbaren Workflows (Name, Description, Steps-Anzahl)
- Pro Workflow ein "Run"-Button
- Nach Klick: Button disabled + "Running..."-State, dann Run erscheint in der Liste
- Optional: Parameter-Eingabe (falls Workflow params unterstützt — aktuell nicht nötig, da content-pipeline keine params hat)

### R4 — Auto-Refresh
- Run-Liste refreshed automatisch (polling, 5s Intervall wie Feed)
- Laufende Runs zeigen Live-Status ohne manuellen Reload

### R5 — Navigation
- Neuer Nav-Punkt "Workflows" zwischen Feed und Memory in `__root.tsx`

## Scope Boundaries

- Kein Abbrechen/Pausieren von Runs (v1)
- Kein Retry fehlgeschlagener Runs (v1)
- Keine Workflow-Definition-Editor (nur Anzeige und Trigger)
- Keine Parameter-Eingabe beim Triggern (content-pipeline hat keine)
- Keine Änderung an der bestehenden API

## Success Criteria

- Nutzer kann Workflow triggern und den Run sofort in der Liste sehen
- Expandieren eines Runs zeigt alle Steps mit Status und Output
- Gates sind im Run-Kontext sichtbar (nicht nur im Feed)
- Seite refreshed automatisch, kein manueller Reload nötig

## API Dependencies

Bereits vorhanden:
- `GET /api/v1/workflows` — Liste der Workflow-Definitionen
- `POST /api/v1/workflows/:name/run` — Workflow starten
- `GET /api/v1/workflows/runs` — Run-Liste
- `GET /api/v1/workflows/runs/:id` — Run-Detail mit Steps

Zusätzlich benötigt für Gate-Status im Run-Kontext:
- Gate-Daten sind bereits über `human_gates`-Tabelle verfügbar. Der `/runs/:id`-Endpoint müsste um Gate-Informationen angereichert werden, oder ein separater `GET /api/v1/gates?workflowRunId=...` Endpunkt.
