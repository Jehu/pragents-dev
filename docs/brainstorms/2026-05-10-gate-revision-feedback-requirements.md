---
date: 2026-05-10
topic: gate-revision-feedback
---

# Workflow Gate Revision Feedback

## Summary

Human workflow gates erhalten einen dritten Pfad: „Revision anfordern" mit Freitext-Feedback. Der zuständige Agent wird erneut dispatched — diesmal mit dem Feedback als Prompt-Kontext — und überarbeitet seine Arbeit. Das Gate erscheint danach erneut zur Prüfung (gate_retry). Der Mechanismus ist kanal-agnostisch: Web-UI, Telegram und zukünftige Kanäle senden denselben API-Call.

---

## Problem Frame

Heute kann der Nutzer an einem Human Gate nur „Approve" oder „Reject" drücken. Ein Reject lässt den gesamten Workflow fehlschlagen — der Agent erfährt nicht, *was* falsch war. Das ist wie ein Code-Review ohne Kommentarfunktion. In der Praxis wird der Nutzer fast immer etwas zu beanstanden haben („Ton zu technisch", „Abschnitt 3 fehlt", „SEO-Keywords nicht eingebaut"), aber die einzige Option ist, die gesamte Arbeit zu verwerfen.

Das ursprüngliche Feed-Feature (R4, F2) forderte Workflow-Kontext für die Approve/Reject-Entscheidung. Der UX-Fix (`docs/plans/2026-05-09-010-fix-gate-approval-context-ui-plan.md`) hat den Kontext geliefert — der Nutzer *sieht* jetzt den Draft. Aber das Interaktionsmodell ist immer noch binär. Ein „Reject with feedback" macht aus dem Gate eine echte Kollaborationsschnittstelle statt eines Ja/Nein-Schalters.

---

## Actors

- **A1. Agency Owner (Mensch):** Reviewt Agent-Output am Gate, gibt Feedback, fordert Revision an. Interagiert über Web-UI oder Telegram.
- **A2. Workflow-Agent (Dev, SEO, Content):** Produziert den zu reviewenden Output, empfängt Feedback, überarbeitet.
- **A3. pragents Server:** Persistiert Gate-Status und Feedback, triggert Re-Dispatch, managed den Revision-Zyklus.

---

## Key Flows

- **F1. Revision anfordern (Web-UI)**
  - **Trigger:** Nutzer öffnet ein Gate, liest den Draft, ist nicht zufrieden
  - **Actors:** A1 → A3 → A2
  - **Steps:**
    1. Nutzer expandiert das Gate und sieht den vorherigen Step-Output
    2. Nutzer schreibt Feedback in ein Textfeld (z. B. „Bitte den Abschnitt zu Keywords ausbauen")
    3. Nutzer klickt „Revision anfordern"
    4. pragents setzt Gate-Status auf `revision_requested`, speichert Feedback
    5. Workflow-Engine erkennt den neuen Status, dispatched den vorherigen Agenten erneut — mit Original-Prompt + Feedback als Kontext („Der Mensch sagt: … Bitte überarbeite.")
    6. Agent arbeitet, produziert neuen Output
    7. Workflow-Engine setzt das Gate zurück auf `pending`
    8. Das Gate erscheint erneut im Feed — mit dem neuen Output und dem alten Feedback als sichtbarem Kontext
  - **Outcome:** Agent hat überarbeitet, Gate wartet erneut auf Review
  - **Covered by:** R1, R2, R3, R4, R5

- **F2. Revision anfordern (Telegram)**
  - **Trigger:** Nutzer erhält Telegram-Nachricht „Gate [label] wartet auf dich. [Kontext]"
  - **Actors:** A1 → A3 → A2
  - **Steps:**
    1. Telegram-Bot sendet Gate-Benachrichtigung mit Label, Workflow-Name, Step-Position
    2. Nutzer replyed auf die Nachricht mit Feedback-Text
    3. Telegram-Bot mapped den Reply auf `POST /api/v1/gates/:id/revision` mit dem Reply-Text als Feedback
    4. Gleicher Server-seitiger Ablauf wie F1 ab Step 5
  - **Outcome:** Gleiches Ergebnis wie F1 — kanal-unabhängig
  - **Covered by:** R1, R2, R3, R6

- **F3. Mehrere Revisionen in Folge**
  - **Trigger:** Nutzer ist mit der ersten Überarbeitung immer noch nicht zufrieden
  - **Actors:** A1 → A3 → A2
  - **Steps:**
    1. Gate erscheint nach erster Revision erneut (F1)
    2. Nutzer sieht den überarbeiteten Output UND das vorherige Feedback
    3. Nutzer schreibt neues Feedback (z. B. „Besser, aber jetzt ist es zu lang. Kürze auf 500 Wörter.")
    4. Gleicher Ablauf wie F1 — Agent wird erneut dispatched mit kumulativem Kontext
    5. Zyklus wiederholt sich bis Approve oder Reject
  - **Outcome:** Iterativer Verbesserungsprozess ohne Workflow-Abbruch
  - **Covered by:** R3, R4, R7

---

## Requirements

**Gate-Status und Feedback**
- **R1.** `human_gates.status` wird um `revision_requested` erweitert. Gültige Status: `pending`, `approved`, `rejected`, `timed_out`, `revision_requested`.
- **R2.** `human_gates` erhält ein Feld `feedback TEXT` für den Freitext. Feedback wird beim Status-Wechsel auf `revision_requested` gesetzt und bleibt erhalten, wenn das Gate danach erneut auf `pending` geht. So ist das letzte Feedback auch bei Folge-Revisionen sichtbar.
- **R3.** Ein Gate kann beliebig viele Revision-Zyklen durchlaufen. Jeder Zyklus: `pending` → `revision_requested` → Agent arbeitet → `pending`. Es gibt kein künstliches Limit.

**Agent-Dispatch**
- **R4.** Bei `revision_requested` dispatched die Workflow-Engine den Agenten des **vorherigen Steps** (designated im WorkflowDef) erneut. Der Prompt enthält:
  - Das Original-Prompt des Steps
  - Das Feedback des Nutzers, formatiert als „Feedback from reviewer: [Text]. Please revise your work accordingly."
  - Den vorherigen Output des Steps (optional — damit der Agent seine eigene Arbeit sieht)
- **R5.** Der Agent-Aufruf nutzt denselben `dispatch()`-Mechanismus wie der ursprüngliche Step. Kein Session-Tracking, kein separater Task. Der Workflow-Step bekommt eine neue Zeile in `workflow_steps` (oder ein `revision_count`-Feld) für den überarbeiteten Output.

**Multi-Channel-API**
- **R6.** Es gibt genau einen API-Endpunkt für Revision: `POST /api/v1/gates/:id/revision` mit Body `{ feedback: string }`. Dieser Endpunkt ist kanal-agnostisch — Web-UI, Telegram und alle zukünftigen Kanäle nutzen ihn.
- **R7.** Der Endpunkt validiert: Gate muss im Status `pending` sein, Feedback darf nicht leer sein. Bei ungültigem Status → 400 mit Fehlermeldung.

**UI — Web**
- **R8.** Die GateCard (expandierter Zustand) zeigt bei einem Gate, das bereits Revisionen durchlaufen hat, den Feedback-Verlauf an: „Revision 1: [Feedback-Text]" unterhalb der Previous-Step-Outputs.
- **R9.** Im expandierten Zustand erscheint ein Textarea-Feld („What needs to change?") und ein Button „Request Revision" neben den bestehenden Approve/Reject-Buttons.
- **R10.** Nach Klick auf „Request Revision" zeigt die Card einen Bestätigungszustand („Revision requested — agent is working") und schließt sich nach 1-2 Sekunden. Das Gate verschwindet aus der pending-Liste, bis der Agent fertig ist.

**UI — Telegram (Design-Vorgabe, Implementierung später)**
- **R11.** Der Telegram-Bot sendet bei einem pending Gate eine Nachricht mit: Gate-Label, Workflow-Name, Step-Position, und einer Zusammenfassung des zu reviewenden Outputs (erste ~300 Zeichen).
- **R12.** Der Nutzer kann auf diese Nachricht mit Freitext antworten. Der Bot interpretiert das als Revision-Feedback und ruft `POST /api/v1/gates/:id/revision` auf.
- **R13.** Der Bot bestätigt den Eingang mit einer Reply-Nachricht: „Feedback received. [Agent] is revising [step]. You'll be notified when the new version is ready."

**Feedback-Transparenz**
- **R14.** Wenn ein Gate nach einer Revision erneut im Feed erscheint, ist das letzte Feedback für den Nutzer sichtbar — als Kontext unterhalb des aktuellen Outputs („Your last feedback: [Text]"). Nur das aktuellste Feedback wird angezeigt; frühere Feedbacks werden überschrieben.
- **R15.** Der überarbeitete Output ersetzt den vorherigen Output in der Gate-Darstellung. Der vorherige Output ist nicht mehr sichtbar (kein Diff, kein Version-Vergleich in v1).

---

## Acceptance Examples

- **AE1. Covers R1, R2, R3, R4, R5.** Given ein Workflow content-pipeline mit Gate „review" nach Step „draft". Der dev-Agent hat einen Draft produziert. Der Nutzer schreibt Feedback „Bitte SEO-Keywords in die Überschriften einbauen" und klickt „Request Revision". Das Gate wechselt auf `revision_requested`, der dev-Agent wird erneut dispatched mit dem Feedback im Prompt. Der Agent produziert einen überarbeiteten Draft. Das Gate erscheint erneut im Feed mit Status `pending`, dem neuen Output und dem sichtbaren Feedback „Your last feedback: Bitte SEO-Keywords in die Überschriften einbauen".

- **AE2. Covers R3, R7.** Given ein Gate hat bereits zwei Revisionen durchlaufen. Der Nutzer ist immer noch nicht zufrieden und fordert eine dritte Revision an. Das System akzeptiert die dritte Revision ohne Fehler.

- **AE3. Covers R6, R7.** Given ein Gate ist im Status `pending`. Ein API-Call `POST /gates/:id/revision` mit `{ feedback: "Ton zu technisch" }` setzt den Status auf `revision_requested`. Der gleiche Call auf ein bereits approved Gate returned 400 `{ error: "Gate is not pending" }`.

- **AE4. Covers R8, R9, R10.** Given die GateCard ist expandiert und das Gate hat einen vorherigen Output. Der Nutzer sieht ein Textarea-Feld und einen „Request Revision"-Button. Nach Eingabe von Feedback und Klick zeigt die Card „Revision requested — agent is working" und schließt sich. Das Gate verschwindet aus der Feed-Liste.

- **AE5. Covers R14.** Given ein Gate erscheint nach einer Revision erneut. Der expandierte Zustand zeigt unter dem aktuellen Output: „Your last feedback: Bitte mehr Details zu XYZ" — der Nutzer sieht sofort, was er beim letzten Mal beanstandet hatte.

- **AE6. Covers R11, R12, R13.** Given ein Telegram-Bot ist konfiguriert und ein Gate ist pending. Der Bot sendet: „⏳ content-pipeline: Review the draft (Step 3/5). Draft summary: [erste 300 Zeichen]". Der Nutzer replyed „Bitte kürzer fassen". Der Bot antwortet „Feedback received. dev is revising draft. You'll be notified when ready." Der Server verarbeitet die Revision.

---

## Success Criteria

- **Menschliches Outcome:** Der Nutzer kann einem Agenten konkretes Feedback geben und eine Überarbeitung anfordern, ohne den Workflow zu verwerfen. Der Feedback-Loop fühlt sich an wie ein Code-Review — nicht wie ein binärer Schalter.
- **Kanal-Unabhängigkeit:** Der gleiche `POST /gates/:id/revision`-Endpunkt funktioniert von Web-UI und Telegram (und zukünftigen Kanälen) identisch. Ein Kanal-Wechsel während eines Revision-Zyklus (Feedback via Telegram, Approve via Web) ist möglich.
- **Kein Workflow-Abbruch:** Revision hält den Workflow am Leben. Erst ein explizites „Reject" (wie bisher) lässt ihn fehlschlagen.

---

## Scope Boundaries

- Kein Diff/Version-Vergleich zwischen Revisionen (v1)
- Kein „Approve with comments" (Feedback + Approve in einem Schritt) — Approve und Revision sind getrennte Aktionen
- Kein künstliches Limit für die Anzahl der Revisionen
- Keine Änderung am bestehenden Approve/Reject-Verhalten
- Keine Agent-seitige Garantie, dass das Feedback korrekt umgesetzt wird — der Agent entscheidet autonom
- Telegram-Integration ist in diesem Doc als Design-Vorgabe spezifiziert, die Implementierung erfolgt separat

---

## Key Decisions

- **Re-Dispatch statt Session-Fortführung:** Der Agent wird mit einem neuen Prompt dispatched, der das Feedback enthält. Kein Session-Tracking, kein Idle-Timeout-Risiko. Der Agent arbeitet mit sauberem Kontext — Nachteil: kein direkter Zugriff auf den vorherigen Denkprozess, aber der vorherige Output kann in den Prompt eingebettet werden.
- **Gate-Retry (Gate erscheint erneut):** Nach der Revision erscheint dasselbe Gate wieder. Der Mensch behält die letzte Qualitätskontrolle. Alternative „Auto-Continue" wurde verworfen — der Nutzer will sehen, ob das Feedback umgesetzt wurde.
- **Kanal-agnostische API:** Ein Endpunkt (`POST /gates/:id/revision`) für alle Kanäle. Telegram mapped Reply→API, Web-UI mapped Button+Textarea→API. Keine kanal-spezifische Logik im Server.

---

## Dependencies / Assumptions

- Der `dispatch()`-Mechanismus des AgentSessionManager unterstützt bereits beliebige Prompt-Texte — keine Änderung nötig
- Die Workflow-Definition (YAML) spezifiziert den Agenten pro Step — der vorherige Step-Agent ist aus dem WorkflowDef ableitbar
- Der Telegram-Bot hat Zugriff auf die pragents-API (Netzwerk, Auth) — das ist eine Deployment-Frage, kein Code-Problem
- Ein Gate mit `revision_requested` blockiert den Workflow nicht anders als ein `pending`-Gate — `waitForGate()` pollt weiter

---

## Outstanding Questions

### Resolved During Brainstorm

- **Q1 (Vorheriger Output im Prompt):** Ja, der vorherige Step-Output wird in den Revision-Prompt eingebettet. Der Agent sieht seinen eigenen Output + das Feedback und kann gezielt ändern. Token-Budget wird akzeptiert.
- **Q2 (Feedback-Verlauf):** Nur das letzte Feedback wird angezeigt (nicht kumulativ). Bei einer neuen Revision wird das alte Feedback überschrieben. UI zeigt immer nur das aktuellste Feedback.

### Deferred to Implementation

- Exaktes Prompt-Template für den Re-Dispatch („Feedback from reviewer: … Please revise your work accordingly.")
- Maximale Länge des Feedback-Texts (Datenbank-seitig und UI-seitig)
