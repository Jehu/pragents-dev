---
date: 2026-05-15
topic: config-ui
---

# Config UI für PrAgents

## Summary

Das Web-UI bekommt eine Form-basierte Konfigurations­schicht, die die heute manuell editierten Artefakte (`pragents.yaml`, Skill-Quarantine-Verzeichnisse, Workflow-YAMLs) im Browser bearbeitbar macht. `pragents.yaml` bleibt kanonische Source of Truth und git-tauglich; Auslieferung in vier Slices, beginnend bei Skills (höchste Frequenz, größte Read-only-Lücke heute) und endend bei einem schema-aware Workflow-YAML-Editor.

---

## Problem Frame

Der Solo-Operator pflegt heute mehrere Konfigurationsartefakte ausschließlich im Editor: die Hauptdatei `~/.pragents/pragents.yaml` (Company, Projekte, Agenten, Skill-Approval, Costs, Pool, Chat, Interfaces), Skills als Verzeichnisse mit `SKILL.md` unter `~/.pragents/skills/` (auto-extrahierte landen in `~/.pragents/skills/_quarantine/<name>/` und müssen approved werden), und Workflow-YAMLs in den Projekt-Verzeichnissen. Routine-Tätigkeiten — auto-extrahierten Skill prüfen und freigeben, neues Kundenprojekt aufsetzen, Modell oder Personality eines Agenten anpassen, einen neuen Workflow schreiben — bedeuten Datei öffnen, Indentation zählen, Zod-Fehler beim Reload debuggen, neu laden. Skill-Approval ist der einzige systemerzeugte Fluss mit hoher, nicht vom Operator gesteuerter Frequenz; die übrigen Tätigkeiten sind seltener, summieren sich aber linear mit aktiven Projekten und stehen im Widerspruch zur Strategie, dass der Operator weniger Zeit *im* Tool verbringen soll. Das Web-UI ist heute nur Read-/Chat-Oberfläche: die `/skills`-Route zeigt zwar Liste mit Approve/Reject (bereits implementiert), aber Skill-Detail ist nicht editierbar, und es gibt keine Routen für Projekte, Settings oder Workflows.

---

## Actors

- A1. **Operator**: Solo-Agency-Owner, alleiniger Nutzer der UI; pflegt Skills, Projekte, Agenten, Settings und Workflows.
- A2. **Config-Loader**: Server-seitiger Hot-Reload-Mechanismus, der `pragents.yaml` beobachtet und resolved Agents nach jedem Save neu materialisiert.
- A3. **Editor-extern**: Operator kann dieselben Dateien parallel im Code-Editor öffnen (Vim, VS Code) — das UI darf diesen Pfad nicht brechen.
- A4. **Auto-Extraction**: Hintergrund-Pipeline, die proposed Skills nach `_quarantine/` schreibt; erzeugt die Frequenz-Last für Slice 1.

---

## Key Flows

- F1. **Skill prüfen und freigeben**
  - **Trigger:** Auto-Extraction hat einen Skill in `_quarantine/<name>/` abgelegt; Operator öffnet die Skills-Seite (Slice 1).
  - **Actors:** A1, A4
  - **Steps:** Liste der proposed Skills sichten → Detail öffnen, Frontmatter und Body inspizieren → ggf. inline editieren → Approve oder Reject → Approve verschiebt das Skill-Verzeichnis aus `_quarantine/` in den aktiven Skills-Pfad und setzt Frontmatter-Status auf `active`; Reject setzt Status auf `rejected` (Datei bleibt für die bestehende Demotion-Logik erhalten).
  - **Outcome:** Skill ist `active` und für Agent-Discovery sichtbar, oder als `rejected` markiert und zählt für die bestehende reject_count-Logik.
  - **Covered by:** R8, R9, R10

- F2. **Neues Kundenprojekt anlegen**
  - **Trigger:** Operator klickt "Neues Projekt" auf der Projekte-Übersicht (Slice 2, Route `/projects`).
  - **Actors:** A1, A2
  - **Steps:** Projekt-Name und -Verzeichnis wählen → optional initiale Agenten (dev/seo/content) mit Modell und Capabilities hinzufügen → Diff-Preview gegen aktuelle YAML → bestätigen → Server-Write-Endpoint schreibt mit Origin-Tag → Loader greift, neue Agenten erscheinen in der Agents-Liste → UI navigiert zur Projekt-Detail-Route.
  - **Outcome:** Projekt + Agenten sind in `pragents.yaml` persistiert, im laufenden Server registriert, und der Operator landet auf dem neuen Projekt.
  - **Covered by:** R3, R4, R5, R6, R12, R17, R19, R20

- F3. **Workflow editieren**
  - **Trigger:** Operator wählt einen vorhandenen Workflow oder legt einen neuen unter dem konfigurierten Workflow-Verzeichnis eines Projekts an.
  - **Actors:** A1
  - **Steps:** Workflow-Datei im YAML-Editor öffnen → bearbeiten mit Live-Validation und Snippets für Standard-Step-Typen → Diff-Preview → speichern.
  - **Outcome:** Workflow-YAML ist gültig nach Workflow-Schema und für Engine-Aufruf bereit.
  - **Covered by:** R14, R15, R16, R19

- F4. **Projekt löschen**
  - **Trigger:** Operator wählt "Löschen" auf einem Projekt-Eintrag.
  - **Actors:** A1, A2
  - **Steps:** Confirm-Dialog listet alle mit-zu-löschenden Agenten → wenn eine Session aktiv läuft, wird gelöscht-blockiert mit Hinweis → bei Bestätigung Server-Write-Endpoint entfernt Projekt-Block aus YAML → Loader entfernt Agenten.
  - **Outcome:** Projekt-Block ist entfernt, alle Agenten verschwinden, oder die Aktion wurde wegen aktiver Session abgelehnt.
  - **Covered by:** R4, R23

---

## Requirements

**Querschnitt — Edit-Modell und Persistenz**

- R1. Alle Schreibvorgänge zeigen vor dem Save eine Diff-Preview gegen den aktuellen Dateistand und erfordern eine explizite Bestätigung. Stiller Auto-Save ist ausgeschlossen.
- R2. Speichern muss Kommentare, Reihenfolge und vorhandene Anker in YAML-Dateien bestmöglich erhalten. Wenn ein Element der Quelle nicht erhaltbar ist, wird es vor dem Save in der Preview als Preservation-Warning kenntlich gemacht.
- R3. Validierung läuft client-seitig auf Basis derselben Schema-Definitionen, die der Server beim Laden anwendet — Felder werden inline gegen das Schema geprüft, Save-Button ist gesperrt solange ungültige Werte vorliegen.
- R12. Externe Änderungen an einer Datei zwischen Form-Open und Save führen zu einer Konflikt-Anzeige — der Operator kann verwerfen, neu laden oder einen Side-by-Side-Merge sehen. Zusätzlich prüft das UI bei jedem Tab-Refocus die mtime/etag der offenen Datei und zeigt eine Stale-Banner, falls die Werte abweichen, bevor der Operator weiter editiert.
- R13. Nach jedem erfolgreichen Save ist der Effekt im laufenden Server sichtbar, ohne dass der Operator den Server neu starten muss (über bestehenden Hot-Reload-Pfad).
- R17. UI-originierte Saves sind beim Server-Write-Endpoint origin-getaggt (z.B. via Header oder kurze Suppression-Window im Watcher), damit der bestehende `fs.watch`-Loop sie nicht als externe Änderung interpretiert und R12-Konflikt-Detection nur echte Editor-extern-Änderungen anzeigt.
- R18. Server stellt einen minimalen File-Metadata-Read-Endpoint bereit (mtime oder etag pro relevanter Datei: `pragents.yaml`, Skill-Verzeichnisse, Workflow-YAMLs), gegen den die UI R12 implementiert.
- R19. Jeder Slice braucht zugehörige Server-Write-Endpoints, die heute fehlen oder nur read-only sind: Slice 1 — Skill-Frontmatter/Body-Update, Quarantine-Move, Reject-Status-Flip; Slice 2 — Projekt-Create/Update/Delete, Agent-Create/Update/Delete (alle gegen `pragents.yaml`); Slice 3 — Settings-Update (alle Settings-Bereiche); Slice 4 — Workflow-Create/Update/Delete inkl. Schema-Feld `workflowDirectory` in ProjectConfig.
- R20. Diff-Preview hat definierte Interaktions-Zustände: *Loading* (Vergleichs-Read läuft), *Empty* (kein Diff — Save deaktiviert mit Hinweis), *Diff* (Standard-Anzeige), *Konflikt* (externer Write seit Form-Open erkannt — übergibt an R12-Dialog), *Read-Failure* (Vergleich nicht möglich — Save deaktiviert), *Preservation-Warning* (YAML-Element nicht round-trip-fähig — sichtbar markiert, Save weiterhin möglich).
- R21. Information Architecture: zwei neue Top-Level-Routen werden in der Sidebar ergänzt — `/projects` (Liste, Detail mit Sub-Tab für Workflows) und `/settings` (eine Seite mit allen Slice-3-Bereichen). Bestehende Routen Overview, Agents, Skills, Plans bleiben unverändert.
- R22. Neue Modal-Dialoge (Konflikt, Reject-Confirm, Delete-Confirm, Delete-Project-Confirm) trapen Fokus, sind via Esc dismissable, haben sichtbare Form-Labels und korrektes ARIA-Labeling — Mindest-a11y für die neuen Surfaces.

**Slice 1 — Skills**

- R8. Skill-Liste zeigt alle Skills inkl. der in `_quarantine/<name>/` liegenden proposed Skills mit Status (proposed/active/rejected/quarantined), Quelle (auto-extrahiert vs. manuell), Confidence (falls auto) und betroffenen Tools. Die bestehende Skills-Route (`web/src/routes/skills/index.tsx`) ist Basis und liefert Liste + Approve/Reject bereits — Slice-1-Arbeit ergänzt nur Inline-Edit.
- R9. Approve verschiebt das Skill-Verzeichnis aus `_quarantine/<name>/` in den aktiven Skills-Pfad und setzt das Frontmatter `x-pragents-status` auf `active`. Reject setzt das Frontmatter auf `rejected` und behält die Datei (kompatibel mit der bestehenden reject_count-Demotion-Logik). Kein Delete-Pfad in dieser Slice.
- R10. Skill-Detail erlaubt Inline-Edit von Frontmatter (strukturiert) und Body (Markdown-Textarea); auf der Datei landen die `x-pragents-*`-Felder so, dass pi sie weiterhin ignoriert.

**Slice 2 — Projekte und Agenten**

- R4. Projekte-Übersicht (Route `/projects`) listet alle in `pragents.yaml` definierten Projekte; jeder Eintrag erlaubt Detail, Edit, Duplizieren und Löschen.
- R5. Ein Projekt-Form deckt Name, Verzeichnis und die Agent-Liste (dev/seo/content) ab; Verzeichnis-Eingabe akzeptiert `~`-Pfade.
- R6. Ein Agent-Form deckt Typ, Modell, Personality (mehrzeilig), Capabilities (Tags), Memory-Access, Token-Budget und keepWarm ab.
- R23. Delete-Project zeigt einen Confirm-Dialog mit der Liste aller Agenten, die mitgelöscht werden. Wenn mindestens eine Session des Projekts aktiv läuft, ist Delete blockiert mit Hinweis "X Sessions aktiv — bitte zuerst beenden."

**Slice 3 — Settings**

- R11. Eine zusammengefasste Settings-Seite (Route `/settings`) deckt Costs, Pool, Chat (classifierModel/threshold), Interfaces, skillApproval und die Company-Stammdaten (name, autoApproveSkills, similarityThreshold) ab — ein Bereich pro Section, kein eigenes Routing pro Block.
- R7. Company-Agenten (office, pm) werden im Settings-Bereich im selben Agent-Form wie Projekt-Agenten gepflegt; Memory-Access-Optionen unterscheiden sich entsprechend dem Schema (company-Agenten dürfen `projects.all: read`).

**Slice 4 — Workflows**

- R14. Workflow-Liste pro Projekt (Sub-Tab unter `/projects/$id`) zeigt alle YAML-Files im konfigurierten Workflow-Verzeichnis. Voraussetzung: ein Schema-Feld `workflowDirectory` in `ProjectConfig` (heute nicht vorhanden) wird ergänzt.
- R15. Workflow-Edit erfolgt in einem schema-aware Code-Editor mit: Live-Validation gegen das Workflow-Schema, Inline-Errors als Gutter-Markierungen mit Hover-Detail (kein separates Panel), Autocomplete via Trigger-Char (Standard-Code-Editor-Konvention) für Agent-Referenzen (`type@project`), Step-Typen und Template-Variablen, und Save geht durch dieselbe R1-Diff-Preview wie Forms (auch wenn der Editor selbst free-text ist).
- R16. Snippets für die häufigen Step-Formen (sequenzieller Step, parallel-Block, Gate, conditional-Branch) sind im Editor abrufbar.

---

## Acceptance Examples

- AE1. **Covers R1, R12.** Gegeben: Operator hat einen Agent-Form geöffnet. Wenn jemand parallel `pragents.yaml` im Editor speichert, dann zeigt der Save-Versuch im UI einen Konflikt-Dialog mit den Optionen *Verwerfen*, *Neu laden* und *Merge ansehen* — die Datei wird nicht überschrieben.
- AE2. **Covers R2.** Gegeben: `pragents.yaml` enthält den auskommentierten Workflow-Beispielblock und einen Kommentar über `pool.maxWarmSessions`. Wenn der Operator über das UI ein neues Projekt hinzufügt und speichert, dann bleiben beide Kommentare in der Datei erhalten.
- AE3. **Covers R3.** Gegeben: Operator setzt im Cost-Form für ein Modell `out: -1`. Dann markiert das Form das Feld als invalid (Schema verlangt non-negative), der Save-Button ist gesperrt, und kein Schreibvorgang läuft.
- AE4. **Covers R9.** Gegeben: Skill ist im Status `proposed` und liegt in `_quarantine/example-skill/`. Wenn der Operator Reject klickt und im Confirm-Dialog bestätigt, dann bleibt das Verzeichnis erhalten, das Frontmatter `x-pragents-status` ist `rejected`, und der Skill erscheint im "Rejected"-Tab der Liste.
- AE5. **Covers R13.** Gegeben: Operator legt im UI einen neuen dev-Agenten in einem Projekt an und bestätigt den Save. Dann taucht der Agent ohne Server-Neustart in der bestehenden Agents-Liste der UI auf und kann Chat-Messages empfangen.
- AE6. **Covers R15.** Gegeben: Workflow-YAML referenziert `agent: dev@kunde-webshop`, der Agent existiert nicht. Dann markiert der Editor die Zeile als Fehler mit dem Hinweis, dass der Agent nicht in der aktuellen Config existiert.
- AE7. **Covers R12, R17.** Gegeben: Operator klickt im UI Save auf einen Projekt-Form. Wenn der Server-Write-Endpoint die Datei origin-getaggt schreibt, dann zeigt der UI-eigene Watcher-Listener nicht den Konflikt-Dialog, obwohl `fs.watch` ein Change-Event feuert.
- AE8. **Covers R23.** Gegeben: Projekt `kunde-webshop` hat eine aktive dev-Session (Chat läuft). Wenn der Operator Delete klickt, dann zeigt der Confirm-Dialog die Agent-Liste *und* eine Blockmeldung "1 Session aktiv — bitte zuerst beenden", und der Delete-Button ist gesperrt.
- AE9. **Covers R9.** Gegeben: Skill liegt in `_quarantine/example-skill/`. Wenn der Operator Approve bestätigt, dann wandert das Verzeichnis nach `~/.pragents/skills/example-skill/`, das Frontmatter `x-pragents-status` ist `active`, und Agent-Discovery findet den Skill beim nächsten Reload.

---

## Success Criteria

- Skill-Approval-Backlog wird messbar abgebaut: Median-Zeit zwischen Auto-Extraction und Approve/Reject sinkt nach Slice 1 deutlich (Baseline vor Slice 1 messen).
- Ein neues Kundenprojekt mit zwei Agenten ist nach Slice 2 in unter 5 Minuten end-to-end angelegt — keine YAML-Datei wird dafür im Editor geöffnet.
- Selten geänderte Bereiche (Costs, Pool, Chat, Interfaces) sind nach Slice 3 in der UI auffindbar und editierbar, ohne im Code-Repo nach Schema-Feldern suchen zu müssen.
- Ein neuer Workflow ist nach Slice 4 schneller bis zum ersten grünen Run als per Hand-YAML, weil Validation und Autocomplete die Struktur übernehmen.
- Hand-Editing von `pragents.yaml` außerhalb des UIs bleibt jederzeit möglich; UI-vs-extern-Konflikte sind sichtbar und nicht-destruktiv (R17 verhindert false positives, R12 fängt echte Konflikte).
- ce-plan kann auf Basis dieses Docs einen Slice-1-Plan beginnen, sobald die zwei `Resolve Before Planning`-Spikes (YAML-Round-Trip und Schema-Sharing) erledigt sind.

---

## Scope Boundaries

- `.env`/API-Key-Management bleibt dateibasiert; das UI zeigt oder editiert keine Secrets.
- Visueller Workflow-Builder (Drag-and-Drop-Knoten/Verbindungen) ist explizit ausgeschlossen — Workflows werden im YAML-Editor geschrieben.
- Keine Migration der Konfiguration in die SQLite-DB; YAML bleibt kanonisch.
- Keine Multi-User-Mechanik (Locking, Rollen, Audit-Log) — Single-User-Annahme.
- Keine eigene Versionierung/Snapshots der Config; git auf der YAML reicht.
- Konfiguration anderer Interfaces als `web` (Pi-Client, Telegram, Terminal) bleibt außerhalb.
- Kein Format-Wechsel der bestehenden YAML-Struktur.
- Memory-Engine-internes Tuning (Embeddings-Provider, Vektor-Store) wird vom Schema abgedeckt, ist aber kein eigener UI-Schwerpunkt — taucht in der Settings-Seite auf, aber ohne Sondererklärungen.
- Frequenz-Validierung der Premise (wie oft pflegt der Operator wirklich diese Bereiche?) ist in dieser Runde nicht erfolgt — siehe Outstanding Questions.

---

## Key Decisions

- **YAML bleibt Source of Truth**: Hot-Reload und git-Workflow bleiben unverändert; UI ist Editor-Layer, nicht parallele Wahrheit.
- **Ansatz A (Forms + Workflow-YAML-Editor)** statt Editor-first oder Visual-Builder: triff die Hauptreibung mit niedrigem Risiko, halte YAML-Round-Trip beherrschbar, mach Workflows ehrlich. Editor-first (JSON-Schema + IDE-LSP) ist als komplementärer Pfad bewusst nicht ausgeschlossen — siehe Outstanding Questions.
- **Slice-Reihenfolge nach Frequenz × bestehender Lücke**: Skills (1) → Projekte+Agenten (2) → Settings (3) → Workflows (4). Skills zuerst, weil Auto-Extraction die einzige systemerzeugte Frequenz-Quelle ist und die `/skills`-Route heute echtes Inline-Edit-Loch hat. UI-Wert pro Slice ist eigenständig; Querschnitt-Infrastruktur (R1/R2/R3/R12/R17/R18/R19/R20) wird allerdings primär in Slice 1 gebaut und von späteren Slices wiederverwendet.
- **Diff-Preview Pflicht vor jedem Save**: Schützt Hand-Edits, Kommentare und Reihenfolge sichtbar statt implizit; gilt auch für Workflow-Editor (R15) trotz Free-Text-Eingabe.
- **Konflikt-Erkennung statt Locking, mit Origin-Tagging**: Single-User-Tool, externe Edits sind erlaubt — Konflikt wird erkannt und vom Operator entschieden, nicht verhindert. UI-eigene Saves werden origin-getaggt (R17), damit der Watcher sie nicht für externe hält. Stale-Form-Detection bei Tab-Refocus (R12) fängt den häufigeren Fall: Operator vergisst Tab und editiert parallel.
- **Strategie-Spannung explizit**: Diese UI vergrößert die Surface „Zeit im Tool" gegenüber der STRATEGY.md-Richtung „weniger Zeit *im* Tool". Begründung: Skill-Approval ist nicht-vermeidbare Operator-Arbeit (Auto-Extraction-getrieben), ein UI dafür kürzt die Zeit; die übrigen Slices begrenzen sich auf Tätigkeiten, die heute ohnehin Editor-Sessions kosten. Wenn Slice-1-Validierung zeigt, dass Slice 2-4 wenig genutzt werden, sind sie Kandidat für Cut.
- **YAML-Library: `eemeli/yaml` v2 (Document API)**. Spike-validiert (2026-05-15) auf realer `~/.pragents/pragents.yaml`: Block-Kommentare, Schlüssel-Reihenfolge, Block-Scalars (`|`), Flow-Style-Maps (`{ in: 3.0, out: 15.0 }`) und Tilde-Pfade bleiben beim Round-Trip alle erhalten; 0 Parse-Errors. Library liegt bereits als Dep im Server-Workspace. Anchor/Alias-Edge-Cases sind theoretisches Restrisiko, in der aktuellen Datei nicht relevant.
- **Schema-Sharing via neuem Workspace `@pragents/schema`**. Zod-Schemas (config, workflow, skill, chat) wandern aus `server/src/.../schema.ts` in einen dritten Workspace `packages/schema/`. Server und Web importieren beide daraus — R3 „dieselben Schema-Definitionen" bleibt wörtlich erfüllbar; Web bekommt nur `zod` ins Bundle, keine Server-Runtime-Deps. Workspace-Import (Server-Direktimport) wurde verworfen wegen Bundle-Size-Risiko, JSON-Schema-Codegen wegen Refinement-Verlust.

---

## Dependencies / Assumptions

- YAML-Round-Trip-Library, die Kommentare und Reihenfolge erhält, ist im JS/TS-Ökosystem verfügbar. Verifikation als `Resolve Before Planning`-Spike (siehe Outstanding Questions) — Annahme load-bearing für die gesamte Architektur.
- Die bestehenden Schema-Definitionen für Config, Workflow und Skill lassen sich vom Web-Bundle ohne größeren Refactor mitnutzen. Sharing-Mechanismus als `Resolve Before Planning` (siehe Outstanding Questions).
- Hot-Reload via `config/loader.ts` triggert auch dann zuverlässig, wenn das Schreiben aus einem In-Process-Save stammt — der Watcher feuert ein Change-Event auf eigene Saves; Origin-Tagging (R17) entkoppelt das vom R12-Konflikt-Pfad.
- Der bestehende `_quarantine`-Mechanismus in `server/src/skills/registry.ts` (skippt das Verzeichnis beim Load) und `auto-extractor.ts` (schreibt nach `_quarantine`) ist die Grundlage von Slice 1; das UI bedient diese vorhandenen Pfade, baut keine Parallelpfade.
- Die bestehende Skills-Route hat bereits Liste, Approve- und Reject-Mutationen mit Confirm-Modal — Slice 1 erweitert sie, ersetzt sie nicht.
- Frequenz-Annahme (Skill-Approval ist hochfrequent, Slice 2-4 niedriger) ist nicht durch Daten belegt — siehe Outstanding Questions, Frequenz-Premise.

---

## Outstanding Questions

### Resolve Before Planning

- *(keine — beide vormals blockierenden Spikes erledigt am 2026-05-15: YAML-Library entschieden auf eemeli/yaml v2, Schema-Sharing auf neuer Workspace `@pragents/schema`. Siehe Key Decisions.)*

### Deferred to Planning

- [Affects R12, R17, R18][Technical] Welcher Mechanismus erkennt externe Datei-Änderungen verlässlich aus Browser-Sicht — File-Mtime-Polling, ETag-Header auf der Lese-API, oder Push über bestehenden SSE-Bus? Origin-Tagging-Variante (Header vs Suppression-Window im Watcher) ebenfalls in ce-plan.
- [Affects R10][Needs research] Wie lassen sich `x-pragents-*`-Frontmatter-Felder beim Schreiben so platzieren, dass pi-native Skill-Reads weiterhin funktionieren — gibt es eine kanonische Reihenfolge?
- [Affects R15, R16][Needs research] Welche Snippet-/Autocomplete-Quellen sind in einem schema-aware Code-Editor im Browser üblich (Sprach-Server, generierte Vorschläge aus dem Schema, hand-kuratierte Snippets)?
- [Affects R19][Technical] Architektur der Server-Write-Endpoints: Eine generische `PUT /config/:path` mit JSON-Patch-Semantik, oder pro Domain-Entität (`POST /projects`, `PUT /projects/:id` etc.) — Trade-off zwischen Reuse und Type-Safety.

### Acknowledged Assumptions (akzeptiert, nicht in dieser Runde validiert)

- **Frequenz-Premise.** Doc geht davon aus, dass die genannten Routine-Tätigkeiten (insbesondere Skill-Approval, sekundär Projekt-Setup und Agent-Tuning) hochfrequent genug sind, um den UI-Aufwand zu rechtfertigen. Es liegen keine Frequenz-Daten vor; die Annahme wird mit Slice 1 implizit getestet (wenn Skill-Approval-Backlog tatsächlich abnimmt, ist die Premise für Slice 1 belegt; für Slice 2-4 muss separat validiert werden).
- **Editor-first nicht ausgeschlossen.** Die Alternative „JSON-Schema-Export + yaml-language-server" wurde nicht detailliert verworfen; sie wird komplementär gehandhabt — falls Slice 1 zeigt, dass Operator-Editor-Workflows weiterhin für Slice 2-4 ausreichen, wird der UI-Bau für die übrigen Slices neu bewertet, statt als gesetzt zu gelten.
