---
date: 2026-05-15
type: feat
status: active
origin: docs/brainstorms/2026-05-15-config-ui-requirements.md
---

# feat: Config UI für PrAgents

## Summary

Implementiere eine Form-basierte Konfigurations-UI über vier in fester Reihenfolge ausgelieferte Slices (Skills → Projekte+Agenten → Settings → Workflows). `pragents.yaml` bleibt kanonisch; ein neuer Workspace `packages/schema/` teilt Zod-Quellen zwischen Server und Web; YAML-Round-Trip via `eemeli/yaml` v2 Document API; Konflikt-Erkennung via ETag mit Origin-Tagging im File-Watcher.

---

## Problem Frame

Siehe `docs/brainstorms/2026-05-15-config-ui-requirements.md` (Problem Frame). Kurz: Solo-Operator pflegt heute pragents-Config ausschließlich im Editor (Indentation, Zod-Errors beim Reload, manueller Quarantine-Move für Skills); das Web-UI ist Read-/Chat-only, die `/skills`-Route hat zwar Liste/Approve/Reject, aber keinen Inline-Edit; Routen für Projekte, Settings, Workflows fehlen ganz. Skill-Approval ist die einzige system-getriebene hochfrequente Tätigkeit (Auto-Extraction-Pipeline) und bekommt deshalb Slice 1.

---

## Requirements

Carried verbatim aus origin (R-IDs stabil; siehe origin für Volltext und AE-Coverage):

- **Querschnitt — Edit-Modell und Persistenz:** R1 Diff-Preview vor Save, R2 YAML-Round-Trip mit Kommentar/Order-Erhalt, R3 Client-Validation gegen geteilte Zod-Schemas, R12 Konflikt-Anzeige inkl. Stale-Form-Detection bei Tab-Refocus, R13 Hot-Reload sichtbar ohne Restart, R17 Origin-Tagging UI-Saves, R18 Server File-Metadata-Read-Endpoint, R19 Server-Write-Endpoints pro Slice, R20 Diff-Preview-State-Coverage (Loading/Empty/Konflikt/Read-Failure/Preservation-Warning), R21 IA neue Top-Level-Routen `/projects` und `/settings`, R22 Modal-a11y-Mindest.
- **Slice 1 — Skills:** R8 Liste inkl. `_quarantine/`, R9 Approve = Quarantine-Move + Frontmatter-Flip / Reject = Status `rejected`, R10 Inline-Edit Frontmatter+Body.
- **Slice 2 — Projekte+Agenten:** R4 Projekte-Übersicht mit Detail/Edit/Duplizieren/Löschen, R5 Projekt-Form, R6 Agent-Form, R23 Delete-Project-Confirm mit Agent-Listing + Active-Session-Block.
- **Slice 3 — Settings:** R11 Settings-Seite (Costs/Pool/Chat/Interfaces/skillApproval/Company-Stammdaten), R7 Company-Agenten (office/pm) im Settings-Bereich.
- **Slice 4 — Workflows:** R14 Workflow-Liste pro Projekt (neues `workflowDirectory`-Schema-Feld), R15 schema-aware Code-Editor mit Live-Validation/Inline-Errors/Trigger-Char-Autocomplete/Save-via-R1, R16 Snippets für gängige Step-Formen.

Origin-AEs: AE1-AE9 (siehe origin).
Origin-Flows: F1-F4 (siehe origin).
Origin-Actors: A1 Operator, A2 Config-Loader, A3 Editor-extern, A4 Auto-Extraction.

---

## Key Technical Decisions

- **Shared Schema Workspace `@pragents/schema`** *(see origin: Key Decisions)* — Zod-Schemas wandern aus `server/src/config/schema.ts`, `server/src/workflows/schema.ts`, und (relevante Teile von) `server/src/skills/*` in einen neuen npm-Workspace `packages/schema/`. Beide bestehende Workspaces bekommen `"@pragents/schema": "*"` als Dep. R3 ist damit wörtlich erfüllt: dieselbe Zod-Definition für Server-Validation beim Laden und für Client-Inline-Validation.
- **YAML-Library: `eemeli/yaml` v2 Document API** *(see origin: Key Decisions)* — bereits Server-Dep. Spike-validiert (2026-05-15): Kommentare, Reihenfolge, Block-Scalars, Flow-Style alle preserved.
- **Conflict-Detection via ETag** — Server liefert auf File-Read-Endpoints einen `ETag`-Header (z.B. SHA-256 des Datei-Inhalts). Client merkt sich den ETag bei Form-Open und sendet ihn auf Save als `If-Match`. Server gibt `412 Precondition Failed` zurück, wenn die Datei sich geändert hat. Begründung: HTTP-nativ, klarere Semantik als mtime-Polling, kein zusätzlicher SSE-Channel nötig. Stale-Form-Detection bei Tab-Refocus (R12) macht einen leichtgewichtigen `HEAD`-Request gegen das Read-Endpoint und vergleicht ETag.
- **Origin-Tagging via Watcher-Suppression-Window** — `config/loader.ts`-Watcher bekommt eine `suppressNextChange(filePath, durationMs)`-Methode. Vor jedem UI-getriggerten Write ruft der Write-Endpoint diese Methode mit ~200ms Window auf; der Watcher ignoriert das nächste Change-Event in diesem Fenster, alles andere geht durch (= externe Edits werden weiter erkannt). Begründung: einfacher als HTTP-Header durch fs-Watcher zu fädeln; deterministisch genug, weil UI-Save und fs.watch-Event innerhalb desselben Prozesses ablaufen.
- **Server-Write-Endpoints per Domain (REST), nicht generisch** — `POST /api/v1/projects`, `PUT /api/v1/projects/:id`, `DELETE /api/v1/projects/:id`, analog für Agents/Skills/Workflows/Settings-Sections. Begründung: passt zum bestehenden Hono-Routing-Stil; Type-Safety pro Endpoint via shared schema; ein generisches `PUT /config/:path` mit JSON-Patch wäre mächtiger, aber mit signifikantem Validation-Boilerplate pro Path. Generisch wird zur Option, falls die Endpoint-Zahl explodiert.
- **Workflow-Editor: Monaco mit hand-kuratierten Snippets** *(initial)* — Monaco bringt Code-Folding, Gutter-Markers, Trigger-Char-Autocomplete out of the box. Snippets initial hand-kuratiert (10-15 Stück für die häufigen Step-Formen aus dem Workflow-Schema). YAML-Language-Server (`yaml-language-server` als Web-Worker) ist Option für später, falls Snippet-Pflege zur Last wird; wäre aber Slice-4-Scope-Creep für v1.
- **Watcher self-trigger (R17) wird auch lokal getestet** — Test-Setup hat einen In-Memory-FakeWatcher, der den Suppression-Window-Pfad gegen echte fs.watch-Race-Conditions absichert.
- **Skill `proposed`-Detection via Pfad, nicht Frontmatter** — Bestehende `registry.ts` skippt `_quarantine/` beim Load. Slice-1-Logik hält sich daran: ein Skill ist `proposed`, wenn er in `_quarantine/<name>/` liegt; `active` wenn nicht; `rejected` wenn Frontmatter `x-pragents-status: rejected`. Bei Approve wird das Verzeichnis bewegt UND Frontmatter aktualisiert (atomar genug für Single-User-Tool, kein Lock nötig).

### Execution posture

Alle feature-bearing Units laufen test-coverage-first: Origin-AEs werden vor dem Implementierungs-Code als Vitest-Cases geschrieben. Pure Refactor-Units (U1) ohne Verhaltensänderung brauchen keine neuen Tests, sondern grünen Bestandstest-Lauf.

---

## Output Structure

Neue Verzeichnisse, die der Plan anlegt (im `pragents`-Repo):

```
packages/
└── schema/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts          # Re-exports
        ├── config.ts         # PragentsConfig + co. (umgezogen aus server/src/config/schema.ts)
        ├── workflow.ts       # umgezogen aus server/src/workflows/schema.ts
        └── skill.ts          # Zod-Repräsentation der Skill-Frontmatter

server/src/
├── config/
│   ├── yaml-rw.ts            # neu: Round-Trip Helper (parseDocument/stringify) + suppressNextChange-Hook
│   ├── loader.ts             # Watcher kriegt suppressNextChange()
│   └── schema.ts             # nur noch Re-export aus @pragents/schema (Übergangs-Schritt)
├── api/
│   └── routes/
│       ├── files.ts          # neu: GET/HEAD mit ETag (R18)
│       ├── projects.ts       # erweitert um POST/PUT/DELETE
│       ├── agents.ts         # erweitert um POST/PUT/DELETE
│       ├── skills.ts         # erweitert um PUT (Frontmatter+Body), Approve-Move
│       ├── settings.ts       # neu (R11)
│       └── workflows.ts      # erweitert um POST/PUT/DELETE pro Workflow-File
└── skills/
    └── operations.ts         # neu: approveSkill (Quarantine→Active Move), updateSkill

web/src/
├── routes/
│   ├── projects/
│   │   ├── index.tsx         # neu (R4 Projekte-Übersicht)
│   │   ├── $projectId.tsx    # neu (Detail mit Sub-Tabs Agents | Workflows)
│   │   └── new.tsx           # neu (Projekt-Wizard)
│   ├── settings/
│   │   └── index.tsx         # neu (R11)
│   └── skills/
│       ├── index.tsx         # erweitert: ProposedSkillCard kriegt Edit-Affordance
│       └── $skillName.tsx    # neu (Inline-Edit-Detail)
└── components/
    ├── DiffPreview.tsx       # neu: R20-State-Coverage
    ├── ConflictDialog.tsx    # neu: R12 Verwerfen/Neu-Laden/Side-by-Side
    ├── Modal.tsx             # neu: a11y-Wrapper (focus-trap, esc) für alle neuen Dialoge
    ├── AgentForm.tsx         # neu (R6) — von Slice 1 Skill-Form-Patterns + Slice 2/3 reused
    ├── ProjectForm.tsx       # neu (R5)
    ├── SettingsSection.tsx   # neu (R11)
    └── WorkflowEditor.tsx    # neu (R15/R16) — Monaco-Wrapper mit Snippets
└── hooks/
    ├── useEtagFetch.ts       # neu: GET + ETag-Tracking
    ├── useConflictDetection.ts # neu: HEAD-on-refocus + 412-Handling
    └── useYamlSave.ts        # neu: Diff-Preview-Trigger + If-Match-Save
```

Implementierende dürfen die Struktur lokal anpassen, falls bessere Granularität auffällt; per-Unit `**Files:**` bleibt authoritativ.

---

## Implementation Units

### U1. Shared schema workspace `@pragents/schema`

**Goal:** Zod-Schemas aus dem Server-Workspace in einen neuen `packages/schema/`-Workspace bewegen, beide Workspaces darauf umstellen. Voraussetzung für R3 (gemeinsame Validation) in allen folgenden Slices.

**Requirements:** R3 (cross-cutting)

**Dependencies:** keine

**Files:**
- `package.json` — `workspaces` um `"packages/*"` erweitern
- `packages/schema/package.json` (neu)
- `packages/schema/tsconfig.json` (neu) — extends `tsconfig.base.json`
- `packages/schema/src/index.ts` (neu)
- `packages/schema/src/config.ts` (neu) — Inhalt aus `server/src/config/schema.ts` (PragentsConfig, AgentConfig, etc.)
- `packages/schema/src/workflow.ts` (neu) — Inhalt aus `server/src/workflows/schema.ts`
- `packages/schema/src/skill.ts` (neu) — Zod-Repräsentation der Skill-Frontmatter (heute implizit in `server/src/skills/registry.ts` und Auto-Extractor)
- `server/src/config/schema.ts` — wird zum Re-Export aus `@pragents/schema` (Übergang, damit existierende Imports nicht alle in einem Schritt geändert werden müssen)
- `server/src/workflows/schema.ts` — analog
- `server/package.json` — `"@pragents/schema": "*"` als Dep
- `web/package.json` — `"@pragents/schema": "*"` als Dep
- Alle bestehenden Tests die schemas direkt importieren bleiben grün ohne Änderung dank Re-Export

**Approach:**
- Als Pure-Refactor: keine neuen Felder, keine Verhaltensänderung. Schemas werden 1:1 verschoben, Refinements bleiben wie sie sind.
- `tsconfig`-Composite oder Project-References sind nicht nötig — npm-workspaces + NodeNext-Resolution reichen, weil Vite die Workspace-Sources direkt auflöst.
- Verifikation: `cd server && npm run build && npm test`, `cd web && npm run build && npx vitest run`. Beide grün ohne Source-Änderungen außer den Re-Exports.

**Patterns to follow:**
- Bestehende Workspace-Struktur (`server/`, `web/` als root `workspaces`-Glob-Einträge). Neuer Glob `"packages/*"` ist additiv.
- ESM + NodeNext + `.js`-Extensions in TS-Source bleibt überall durchgehalten.

**Test scenarios:**
- Test expectation: none -- Pure Refactor; verifiziert durch grünen Lauf der bestehenden Server- und Web-Test-Suites.

**Verification:** Beide Workspaces builden grün; alle bestehenden Tests grün; `import { PragentsConfig } from '@pragents/schema'` funktioniert in beiden Workspaces.

---

### U2. YAML round-trip helper + watcher origin-tagging

**Goal:** Zentrale Schreib-Funktion mit eemeli/yaml Document API, die Kommentare/Reihenfolge erhält und sich beim Watcher als Origin-getaggt anmeldet. Voraussetzung für jedes spätere Write-Endpoint.

**Requirements:** R1 (Diff-Preview-Source), R2 (Round-Trip), R13 (Hot-Reload nicht-doppelt), R17 (Origin-Tagging)

**Dependencies:** U1 (für getypte Validation gegen geteiltes Schema vor dem Schreiben)

**Files:**
- `server/src/config/yaml-rw.ts` (neu) — exportiert `readYamlDoc(path)`, `writeYamlDoc(path, doc, { suppressWatcher: true })`, `applyMutation(doc, mutator)` (kapselt Document-API-Calls). Berechnet ETag (SHA-256 über UTF-8-Inhalt).
- `server/src/config/loader.ts` — Watcher kriegt `suppressNextChange(filePath, durationMs = 250)` Methode; in `getDb()`/Start-Up-Singleton verfügbar gemacht
- `server/src/config/__tests__/yaml-rw.test.ts` (neu)
- `server/src/config/__tests__/loader.test.ts` — bestehender Test wird um Suppression-Window-Coverage erweitert

**Approach:**
- `readYamlDoc(path)` returnt `{ doc, etag }` — `doc` ist `YAML.Document`, `etag` ist das gehashte Pre-Read-Snapshot.
- `writeYamlDoc(path, doc, opts)` ruft vor `writeFile` `loader.suppressNextChange(path)` auf, dann schreibt es. Mutiert nicht, ist atomar via `writeFile` (kein temp+rename, weil `fs.watch` auf macOS und Linux sonst sowieso ein anderes Event-Pattern liefert; AE-Test stellt sicher).
- `applyMutation(doc, mutator)` ist syntaktischer Zucker — erlaubt `applyMutation(doc, d => d.setIn(['projects', 'foo'], …))`.
- `suppressNextChange` setzt einen Eintrag in eine Map `<absPath, expiresAt>`; im Watcher-Callback wird der Eintrag geprüft und das Event verworfen, wenn `now < expiresAt`. Nach Verwendung wird der Eintrag gelöscht.

**Patterns to follow:**
- `server/src/config/loader.ts` aktueller Watcher-Style (fs.watch mit Polling-Fallback).
- Pino-Logging für Diagnose des Suppression-Pfads (`logger.debug({ path }, 'watcher suppressed self-write')`).

**Test scenarios:**
- Happy: `readYamlDoc` returnt `doc` und `etag` für reale Beispiel-Config; `writeYamlDoc` ohne Mutation produziert byte-identische Datei (= ETag stabil) — wichtig als Round-Trip-Sanity.
- Happy: Mutation (z.B. `setIn(['pool', 'maxWarmSessions'], 12)`) erhält Kommentare und Reihenfolge — assertion: `doc.commentBefore` und `items[0].key.value` unverändert.
- Edge: `writeYamlDoc` mit `suppressWatcher: true` führt dazu, dass der Watcher kein `change`-Event durchstellt (FakeWatcher-Test).
- Edge: zweiter externer Write innerhalb des Suppression-Windows wird trotzdem erkannt (= Suppression löscht den Eintrag nach dem ersten Hit, nicht nach Zeit-Ablauf alleine).
- Error: `writeYamlDoc` auf nicht-schreibbaren Pfad propagiert IO-Error mit pathContext.
- Error: ETag-Stale beim Re-Read (Datei wurde extern geändert) ist erkennbar — Test stellt das gegen ein Pre-Test-Setup mit zwei Reads sicher.

**Verification:** `npx vitest run yaml-rw` grün; manueller Smoke: `npm run dev` im Server, externe Vim-Edit triggert Hot-Reload, ein synthetischer UI-Save (curl) triggert keinen.

---

### U3. UI primitives — DiffPreview, Modal, ConflictDialog, useEtagFetch, useConflictDetection

**Goal:** Wiederverwendbare React-Bausteine für Diff-Preview-States (R20), modale Dialoge mit a11y (R22) und Konflikt-Erkennung (R12). Werden in U6 (Skills-Inline-Edit) zuerst eingesetzt; alle späteren Web-Units bauen darauf.

**Requirements:** R1, R2, R12, R20, R22

**Dependencies:** U1 (für client-side Schema-Imports), U2 (definiert ETag-Format)

**Files:**
- `web/src/components/Modal.tsx` (neu) — focus-trap, Esc-Dismiss, aria-modal, return-focus-on-close
- `web/src/components/DiffPreview.tsx` (neu) — props: `before: string`, `after: string`, `state: 'loading' | 'empty' | 'diff' | 'conflict' | 'read-failure' | 'preservation-warning'`, `onConfirm`, `onCancel`
- `web/src/components/ConflictDialog.tsx` (neu) — drei Buttons Verwerfen/Neu-Laden/Side-by-Side; Side-by-Side rendert zwei DiffPreview-Instanzen gegeneinander
- `web/src/hooks/useEtagFetch.ts` (neu) — Wrapper um fetch(); merkt ETag pro URL
- `web/src/hooks/useConflictDetection.ts` (neu) — Tab-Refocus-Listener (`document.visibilitychange`), HEAD-Request mit `If-None-Match`, callbackt bei 200 (= Datei geändert)
- `web/src/hooks/useYamlSave.ts` (neu) — orchestriert Diff-Preview-Open → Confirm → POST mit `If-Match`-Header
- `web/src/components/__tests__/DiffPreview.test.tsx` (neu)
- `web/src/components/__tests__/Modal.test.tsx` (neu)
- `web/src/components/__tests__/ConflictDialog.test.tsx` (neu)
- `web/src/hooks/__tests__/useConflictDetection.test.ts` (neu)

**Approach:**
- Modal als `<Portal>` an `document.body` gemounted, focus-trap-Logik in einem Effect mit `tabindex`-Iteration über focusable Elemente. Scrollbarer Backdrop, Esc-Dismiss optional ausschaltbar (für "must-confirm"-Variante des Delete-Modals in U8).
- DiffPreview rendert pro `state` deterministisch: Loading = Spinner, Empty = Hinweis "Keine Änderungen", Conflict = passt an ConflictDialog weiter, Read-Failure = Fehlermeldung mit Retry, Preservation-Warning = roter Banner über dem Diff. Diff-Engine: minimaler line-based Diff (z.B. `diff` package) — kein Word-Level für v1.
- `useEtagFetch` cached per-URL `etag`; auf 412 wird ein Conflict-Callback gefeuert.
- `useConflictDetection` registriert beim Mount einen `visibilitychange`-Listener; bei `visible` macht es HEAD gegen die getrackte URL und vergleicht `ETag` gegen den Cache.
- `useYamlSave` ist die Orchestration die alle Forms benutzen: open Diff-Preview Modal (state = loading) → fetch current → state = diff/conflict → on Confirm → POST with If-Match → on 412 → state = conflict.

**Patterns to follow:**
- TanStack Query als data-Layer ringsum (Mutations kommen als `useMutation`); useYamlSave wrappt den Mutation-Call.
- UnoCSS-Klassen für Styling (siehe bestehende `web/src/routes/skills/index.tsx` für Beispiele).
- a11y-Verifikation per `axe-core` (bereits Dev-Dep) in den Component-Tests.

**Test scenarios:**
- Modal happy: öffnen rendert Backdrop, focus geht auf erstes focusable Element; Esc schließt; close gibt Fokus zurück an Trigger.
- Modal a11y: `axe(container)` returnt 0 violations.
- DiffPreview state=loading: Spinner sichtbar, Confirm-Button disabled.
- DiffPreview state=empty: Hinweis "Keine Änderungen", Confirm disabled, Cancel enabled.
- DiffPreview state=preservation-warning: Banner sichtbar, Confirm bleibt enabled (User entscheidet bewusst).
- DiffPreview state=conflict: rendert ConflictDialog statt Diff.
- ConflictDialog happy: drei Buttons sichtbar; "Verwerfen" callbackt onCancel; "Neu laden" callbackt onReload; "Side-by-Side" rendert zwei DiffPreviews.
- useConflictDetection happy: tab refocus → HEAD called → ETag changed → onStale callback fires.
- useConflictDetection edge: 304 Not Modified → onStale NOT called.
- useYamlSave integration: `Covers AE1.` UI-Form mit useYamlSave → externer Write zwischen Open und Save → 412 vom Endpoint → ConflictDialog erscheint, Datei nicht überschrieben.

**Verification:** `npx vitest run` für alle neuen Tests grün; manueller Browser-Test: ein Form mit DiffPreview öffnen, externe Datei-Mutation, Save versuchen → ConflictDialog erscheint.

---

### U4. Server file-metadata endpoint (R18) + ETag wrapping bestehender Read-Routes

**Goal:** Browser kann `mtime`/`etag` für jede UI-relevante Datei abfragen, ohne Inhalt zu lesen. Bestehende Read-Endpoints liefern ETag-Header zusätzlich zum Body.

**Requirements:** R12, R18

**Dependencies:** U2 (ETag-Berechnung in `yaml-rw.ts` wiederverwenden)

**Files:**
- `server/src/api/routes/files.ts` (neu) — exportiert `createFilesRoute(getDb)`. Endpoints: `GET /api/v1/files/meta?path=<rel>` returnt `{ mtime, etag }`; `HEAD /api/v1/files/meta?path=<rel>` setzt nur Header. `path` gegen Allow-List (`pragents.yaml`, Skills-Subtree, Workflow-Subtree pro Projekt) validiert.
- `server/src/api/routes/projects.ts` — GET-Response um `ETag`-Header erweitert
- `server/src/api/routes/skills.ts` — GET-/Detail-Response um `ETag`-Header erweitert
- `server/src/api/routes/workflows.ts` — analog
- `server/src/index.ts` — neue Route registriert
- `server/src/api/routes/__tests__/files.test.ts` (neu)

**Approach:**
- ETag = SHA-256-Prefix über file content; weak ETags reichen (`W/"<hash>"`).
- Allow-List per Schema-Enum: nur `pragents.yaml` plus alles unter `~/.pragents/skills/` und unter `<project.directory>/<workflowDirectory>/`. Path-Traversal-Test in U-Tests (`../../etc/passwd` → 400).
- HEAD-Methode in Hono explizit für `/files/meta`-Pfad registrieren (Hono routet HEAD nicht automatisch zu GET).

**Patterns to follow:**
- Bestehende Hono-Route-Style aus `server/src/api/routes/projects.ts` (factory-Pattern mit `getDb`).
- Pino-Logging für Path-Validation-Failures.

**Test scenarios:**
- Happy: GET `/files/meta?path=pragents.yaml` returnt `{ mtime, etag }` und ETag-Header.
- Happy: HEAD `/files/meta?path=pragents.yaml` returnt 200 mit ETag-Header, leerer Body.
- Edge: GET ohne `path`-Query → 400.
- Edge: GET mit `path` außerhalb Allow-List → 400 (kein 403, weil 400 keinen Existenz-Hint gibt).
- Error: GET mit `path` zu nicht-existierender Datei → 404.
- Integration: ETag eines Files matcht den von `readYamlDoc(path).etag` aus U2 — Konsistenz-Test.

**Verification:** Manueller curl: `curl -i http://localhost:3000/api/v1/files/meta?path=pragents.yaml` zeigt ETag und mtime; ein Vim-Save dazwischen ändert beides.

---

### U5. Skill mutation API — update, approve (move), reject (status-flip)

**Goal:** Server-Endpoints für Skill-Inline-Edit und korrektes Approve/Reject im Sinn der bestehenden Quarantine-Mechanik. Macht das Slice-1-UI funktionsfähig.

**Requirements:** R8, R9, R10, R17, R19, F1, AE4, AE9

**Dependencies:** U1 (für SkillSchema-Import beim Validate), U2 (für eventuell betroffene `pragents.yaml`-Reload-Suppression — Skills selbst sind .md-Dateien, aber `_quarantine`-Move braucht denselben Suppression-Pfad damit der `_quarantine`-Watcher (falls vorhanden) nicht doppelt triggert)

**Files:**
- `server/src/skills/operations.ts` (neu) — `updateSkill(name, { frontmatter, body })`, `approveSkill(name)` (Verzeichnis-Move + Frontmatter-Flip), `rejectSkill(name)` (nur Status-Flip)
- `server/src/api/routes/skills.ts` — neue Routes: `PUT /api/v1/skills/:name` (Frontmatter+Body update), Approve-Route überarbeitet auf `operations.approveSkill`, Reject-Route bleibt `status='rejected'` (kein Delete)
- `server/src/skills/__tests__/operations.test.ts` (neu)
- `server/src/api/routes/__tests__/skills.test.ts` — bestehender Test um neue Endpoints erweitert
- `packages/schema/src/skill.ts` — Zod-Schema für Skill-Frontmatter (verwendet von operations.updateSkill für Validation)

**Approach:**
- `updateSkill`: liest existierende `SKILL.md` mit `gray-matter`, mergt neue Frontmatter+Body, schreibt zurück, ETag berechnen + im Response zurückgeben. `x-pragents-*`-Felder werden am Ende der Frontmatter platziert (testweise pi-kompatibel).
- `approveSkill`: mit `fs.rename` von `<skillsRoot>/_quarantine/<name>/` nach `<skillsRoot>/<name>/`, dann `updateSkill` mit `x-pragents-status: active`. Atomic: rename ist auf demselben Filesystem atomar.
- `rejectSkill`: setzt nur `x-pragents-status: rejected`, lässt Datei in `_quarantine/`. Bestehender reject_count/Demotion-Pfad bleibt unverändert.
- Origin-Tagging per `loader.suppressNextChange(skillPath)` vor jedem Schreibvorgang.
- Conflict-Detection: PUT akzeptiert `If-Match`-Header; bei Mismatch → 412.

**Patterns to follow:**
- Bestehende `server/src/skills/registry.ts` für Pfad-Normalisierung und `_quarantine`-Detection.
- Bestehende `server/src/api/routes/skills.ts` für Hono-Route-Schreibweise und Response-Schema.

**Test scenarios:**
- Happy: PUT mit Frontmatter+Body update auf existierenden active Skill → 200, ETag im Response, Datei aktualisiert, Frontmatter-Reihenfolge erhalten.
- Happy `Covers AE9.`: Approve auf Skill in `_quarantine/example-skill/` → Verzeichnis nach aktivem Skills-Root verschoben, `x-pragents-status: active`, registry findet Skill beim nächsten Reload.
- Happy `Covers AE4.`: Reject auf Skill in `_quarantine/example-skill/` → Verzeichnis bleibt in `_quarantine/`, `x-pragents-status: rejected`, Skill erscheint im "Rejected"-Tab via bestehende Liste.
- Edge: PUT auf nicht-existierenden Skill → 404.
- Edge: Approve auf bereits-aktiven Skill → 409 Conflict (kein Move nötig, falscher State).
- Edge: PUT mit ungültigem Frontmatter (Zod-Validation fail) → 400 mit Zod-Error-Body.
- Error: PUT mit stale `If-Match` → 412 (Datei wurde extern geändert zwischen Read und Save).
- Integration: PUT triggert via Origin-Tag den Watcher NICHT (FakeWatcher-Assertion).

**Verification:** Vitest grün; manueller curl: PUT auf realen Skill, dann GET → Body reflektiert Änderung; Approve auf einen quarantine Skill → Verzeichnis wandert; Reject → Status-Field gesetzt, Datei bleibt.

---

### U6. Web — Slice 1: Skills-Inline-Edit + Quarantine-Approve-Flow

**Goal:** Bestehende `/skills`-Route um Inline-Edit (R10) und korrekten Approve/Reject (passend zu U5) erweitern. Erstes komplettes Slice durch alle Layer.

**Requirements:** R8, R9, R10, R12, R20, F1, AE4, AE9, AE1, AE3 (Validation-Pfad)

**Dependencies:** U3 (UI-Primitives), U5 (Server-Endpoints), U1 (Schema-Validation client-side)

**Files:**
- `web/src/routes/skills/index.tsx` — `ProposedSkillCard` und `ActiveSkillCard` bekommen "Edit"-Button, der zum Detail-View navigiert
- `web/src/routes/skills/$skillName.tsx` (neu) — Detail-View mit Frontmatter-Form (strukturiert) und Body-Textarea (Markdown), Approve/Reject-Buttons, Save-Button geht durch `useYamlSave`
- `web/src/components/SkillFrontmatterForm.tsx` (neu) — strukturierte Felder für `description`, `allowed-tools`, `x-pragents-*`
- `web/src/routes/skills/__tests__/$skillName.test.tsx` (neu)
- `web/src/routes/skills/__tests__/skills.test.tsx` — bestehender Test um Edit-Affordance erweitert

**Approach:**
- Detail-Route `/skills/$skillName` lädt via `useEtagFetch(\`/api/v1/skills/$skillName\`)`, rendert Frontmatter-Form + Body-Textarea getrennt.
- `useConflictDetection` wird auf der Skill-Datei aktiv: bei Tab-Refocus HEAD, bei ETag-Change Banner "Datei wurde extern geändert — Neu laden / Weiter editieren".
- Save-Button öffnet `useYamlSave`-Diff-Preview (Vergleich Frontmatter+Body strukturiert), Confirm sendet PUT mit `If-Match`.
- Approve/Reject sind separate Buttons im Detail-View und in den Cards der Liste; beide gehen durch eigene Mutations + bei Approve durch ein Confirm-Modal "Skill in aktive Skills verschieben?".
- Reject-Confirm-Modal nutzt `Modal.tsx` mit `mustConfirm: true` (kein Esc-Dismiss).

**Patterns to follow:**
- Bestehende `web/src/routes/skills/index.tsx` für Mutations-Style (`useMutation` mit optimistic update).
- TanStack Router file-based route (`$skillName.tsx`-Naming).

**Test scenarios:**
- Happy: Detail-View rendert Frontmatter-Form gefüllt mit aktuellen Werten + Body-Textarea.
- Happy: Edit eines Felds → Save → Diff-Preview öffnet → Confirm → PUT-Call mit If-Match-Header.
- Happy `Covers AE9.`: Approve im Detail-View → Confirm-Modal → POST → Skill verschwindet aus "Proposed"-Tab und erscheint in "Active".
- Happy `Covers AE4.`: Reject → Confirm → POST → Skill erscheint in "Rejected"-Tab, bleibt in der Datei.
- Edge `Covers AE1.`: Tab-Refocus während Edit → HEAD detect ETag-Change → Banner sichtbar.
- Edge `Covers AE3.`: Frontmatter-Field ungültig (z.B. ungültiger `allowed-tools`-Wert) → Schema-Validation flaggt, Save-Button disabled.
- Edge: Save bei stale ETag → ConflictDialog rendert.
- Error: Approve auf bereits-aktiven Skill → Toast mit Server-Error-Message.
- a11y: `axe` auf Detail-View → 0 violations.

**Verification:** `cd web && npx vitest run` grün; manueller Browser-Test: ein proposed Skill bearbeiten + approven → Verzeichnis-Move sichtbar im Filesystem, Discovery findet Skill nach Hot-Reload.

---

### U7. Server — Slice 2: Project + Agent CRUD endpoints

**Goal:** Write-API für Projekte und Agenten gegen `pragents.yaml` mit Round-Trip-Erhaltung und Active-Session-Check für Delete.

**Requirements:** R4, R5, R6, R19, R23, F2, F4, AE5, AE7, AE8

**Dependencies:** U1 (PragentsConfig-Schema), U2 (yaml-rw, suppressNextChange)

**Files:**
- `server/src/api/routes/projects.ts` — POST, PUT, DELETE
- `server/src/api/routes/agents.ts` (neu, oder erweitert je nach bestehender Struktur) — POST, PUT, DELETE pro Agent (`POST /api/v1/projects/:projectId/agents`, etc.)
- `server/src/api/routes/__tests__/projects.test.ts` — erweitert
- `server/src/api/routes/__tests__/agents.test.ts` — erweitert
- `server/src/agents/manager.ts` — exposes `hasActiveSession(projectId)`-Methode (für Delete-Block)

**Approach:**
- POST/PUT/DELETE gehen alle durch `yaml-rw.applyMutation` gegen `pragents.yaml`. Validation client-side via shared schema, server-side erneut via shared schema (defense in depth).
- DELETE Project: vor dem Schreiben `agentsManager.hasActiveSession(projectId)` prüfen — wenn true → 409 mit `{ activeAgents: [...] }` Body. UI nutzt das für AE8.
- DELETE Agent: kein Session-Check (einzelner Agent löschen ist additiv für die Form-UX, Operator weiß was er tut). Optional in Plan-Review.
- POST/PUT geben `ETag` im Response zurück; PUT akzeptiert `If-Match`.
- `agents`-Route ist ggf. neu — heute ist `/api/v1/agents` GET nur Resolved-Liste; per-Project-Mutations brauchen `/api/v1/projects/:id/agents/:agentType`-Sub-Route.

**Patterns to follow:**
- Bestehende `server/src/api/routes/projects.ts` GET-Style und Hono-Pattern.
- `agentsManager.shutdown(...)`-API für `hasActiveSession`-Erweiterung.

**Test scenarios:**
- Happy: POST `/projects` mit name+directory → 201, ETag-Response, `pragents.yaml` enthält neuen Block.
- Happy: PUT `/projects/:id/agents/dev` ändert Personality → 200, Datei aktualisiert, Kommentare im YAML erhalten.
- Happy `Covers AE5.`: POST eines neuen Agenten → Hot-Reload-Trigger → Agent erscheint in `/api/v1/agents` GET ohne Restart.
- Happy `Covers AE7.`: POST geht nicht durch den Watcher-Konflikt-Pfad (FakeWatcher-Assertion).
- Edge `Covers AE8.`: DELETE Project mit aktiver Session → 409 Body enthält Agent-Liste.
- Edge: DELETE Project ohne aktive Session → 200, Datei aktualisiert.
- Edge: POST mit duplikatem `projectId` → 409.
- Edge: PUT mit ungültigem Schema (z.B. ungültiges `model`) → 400 mit Zod-Error.
- Error: PUT mit stale `If-Match` → 412.
- Integration: PUT triggert kein doppeltes Resolve in `agents/manager.ts` (Watcher-Suppression-Test).

**Verification:** Vitest grün; manueller curl: POST neues Projekt, GET `/api/v1/agents` zeigt Agenten; DELETE blocked wenn Chat-Session offen.

---

### U8. Web — Slice 2: /projects route + forms + delete confirm

**Goal:** Komplette UI für Projekt+Agenten-Verwaltung. Erste Verwendung von Schema-Validation client-side über `@pragents/schema`-Import.

**Requirements:** R4, R5, R6, R12, R20, R21, R22, R23, F2, F4, AE5, AE8

**Dependencies:** U3 (Primitives), U7 (Endpoints)

**Files:**
- `web/src/routes/projects/index.tsx` (neu) — Übersicht mit Cards pro Projekt; Buttons Detail/Edit/Duplizieren/Löschen
- `web/src/routes/projects/$projectId.tsx` (neu) — Detail mit Sub-Tabs Agents | (Workflows später U12) | Settings; List + Edit der Agenten
- `web/src/routes/projects/new.tsx` (neu) — Wizard für neues Projekt
- `web/src/components/ProjectForm.tsx` (neu)
- `web/src/components/AgentForm.tsx` (neu) — wird auch von Slice 3 (Company-Agenten) und U6 (für Skill-Detail nicht relevant; rein für Agenten) wiederverwendet
- `web/src/components/DeleteProjectModal.tsx` (neu) — listet Agenten + zeigt Active-Session-Block-State
- `web/src/components/__tests__/ProjectForm.test.tsx` (neu)
- `web/src/components/__tests__/AgentForm.test.tsx` (neu)
- `web/src/routes/projects/__tests__/projects.test.tsx` (neu)
- `web/src/components/__tests__/DeleteProjectModal.test.tsx` (neu)
- Sidebar-Komponente (vorhanden) — neuer Top-Level-Eintrag `/projects` (R21)

**Approach:**
- File-based TanStack Router routes; `$projectId`-Detail nutzt useEtagFetch+useConflictDetection auf `pragents.yaml`.
- ProjectForm: Felder Name, Directory (mit `~`-Pfad-Akzeptanz), AgentList (Add-Button öffnet AgentForm in Modal).
- AgentForm: Type (Select), Model (Combobox mit den Keys aus `costs:` als Vorschlägen), Personality (Textarea), Capabilities (Tag-Input), Memory-Access (strukturierte Checkbox-Gruppe), Token-Budget (Number), keepWarm (Toggle).
- DeleteProjectModal: lädt initial die Agent-Liste + macht einen Hilfs-Call `/api/v1/agents/sessions/active` (oder bekommt es aus dem 409-Response des DELETE bei Click). Block-State sperrt den Confirm-Button.
- Save geht über `useYamlSave` → `useMutation` → POST/PUT mit If-Match.
- Wizard `new.tsx`: zwei Steps — (1) Projekt-Stammdaten, (2) initiale Agenten optional. Nach Save Navigation auf `/projects/$projectId`.

**Patterns to follow:**
- Bestehende file-based routes (`web/src/routes/agents/$agentId.tsx`) für Sub-Route-Style.
- Zustand-Stores werden NICHT für Form-State benutzt (lokal react-hook-form oder useState reicht; globaler Store wäre Overkill).

**Test scenarios:**
- Happy: ProjectForm submit mit valid data → POST-Call → onSuccess Navigation.
- Happy `Covers F2.`: New-Wizard end-to-end → Projekt + 2 Agenten in einem Save → Detail-View zeigt beide Agenten.
- Happy `Covers AE5.`: nach Save erscheint Agent in `/agents`-Route (cross-route React-Query-Cache-Invalidation).
- Edge: Delete-Modal mit aktiven Sessions zeigt Block-Banner, Confirm disabled `Covers AE8.`.
- Edge: Duplicate-Action erstellt Form vorgefüllt mit `<originalId>-copy`.
- Edge: ProjectForm ungültiges Verzeichnis (leerer String) → Schema-Fehler inline, Save disabled.
- Edge: AgentForm Capabilities-Tags Add/Remove funktioniert.
- Error: Save bei stale ETag → ConflictDialog.
- a11y: `axe` auf alle neuen Modale → 0 violations.

**Verification:** `cd web && npx vitest run` grün; Browser: neues Projekt anlegen end-to-end < 2 Min, dev-Agent erscheint in Sidebar/Agents-Liste.

---

### U9. Server — Slice 3: Settings update endpoints (per domain)

**Goal:** Schreib-API für die Settings-Bereiche (Costs, Pool, Chat, Interfaces, skillApproval, Company-Stammdaten, Company-Agenten).

**Requirements:** R7, R11, R19

**Dependencies:** U2 (yaml-rw)

**Files:**
- `server/src/api/routes/settings.ts` (neu) — Endpoints pro Domain: `PUT /api/v1/settings/costs`, `PUT /api/v1/settings/pool`, `PUT /api/v1/settings/chat`, `PUT /api/v1/settings/interfaces`, `PUT /api/v1/settings/skill-approval`, `PUT /api/v1/settings/company`, `PUT /api/v1/settings/company/agents/:agentType`
- `server/src/index.ts` — neue Route registriert
- `server/src/api/routes/__tests__/settings.test.ts` (neu)

**Approach:**
- Jeder Endpoint validiert sein Sub-Schema (`PoolConfig`, `ChatConfig`, etc. aus `@pragents/schema`).
- Mutiert via `applyMutation(doc, d => d.set('pool', newValue))` — eemeli/yaml ersetzt nur den betroffenen Subtree, alles drumrum bleibt erhalten (Spike-validiert).
- ETag-If-Match-Pattern wie U7.
- Company-Agenten gehen über `PUT /settings/company/agents/:agentType` mit Validation gegen `CompanyAgentConfig`.

**Patterns to follow:**
- U7's per-Domain-Endpoint-Style.

**Test scenarios:**
- Happy: PUT `/settings/pool` mit `{ maxWarmSessions: 12 }` → Datei reflektiert Änderung; alle anderen Top-Level-Sektionen unverändert.
- Happy: PUT `/settings/company/agents/office` mit neuer Personality → Office-Agent-Block in YAML aktualisiert, restliche Company-Konfig + andere Sektionen unverändert.
- Edge: PUT `/settings/costs` mit negativen Werten → 400 (Schema-Refinement greift).
- Edge: PUT `/settings/chat` mit ungültigem `classifierThreshold` (>1) → 400.
- Error: PUT mit stale If-Match → 412.
- Integration: nach PUT `/settings/skill-approval` greift die neue `confidenceThreshold` beim nächsten Auto-Extraction-Run (Hot-Reload sichtbar).

**Verification:** Vitest grün; manueller curl + Inspektion der `pragents.yaml`.

---

### U10. Web — Slice 3: /settings route

**Goal:** Eine Settings-Seite mit allen Bereichen aus R11 + R7 als Sections.

**Requirements:** R7, R11, R12, R20, R21, R22

**Dependencies:** U3, U8 (AgentForm wiederverwendbar), U9

**Files:**
- `web/src/routes/settings/index.tsx` (neu) — vertikal gestapelte Sections, eine pro Domain. Jede Section hat eigenen Save-Button (kein globaler "Save All"); Diff-Preview pro Section.
- `web/src/components/SettingsSection.tsx` (neu) — generischer Container mit Title/Form/SaveButton-Layout
- `web/src/components/CostsForm.tsx` (neu) — Tabelle Modell ↔ in/out
- `web/src/components/PoolForm.tsx` (neu)
- `web/src/components/ChatForm.tsx` (neu)
- `web/src/components/InterfacesForm.tsx` (neu)
- `web/src/components/SkillApprovalForm.tsx` (neu)
- `web/src/components/CompanyForm.tsx` (neu) — name, autoApproveSkills, similarityThreshold + 2x AgentForm (office, pm)
- `web/src/routes/settings/__tests__/settings.test.tsx` (neu)
- Sidebar — neuer Top-Level-Eintrag `/settings` (R21)

**Approach:**
- Jede Form ist self-contained: lädt ihren Sub-Bereich aus `/api/v1/config` (oder einer `/settings/...`-GET-Route — vermutlich aus `pragents.yaml`-GET, Sub-Selection client-seitig), saved per `useYamlSave` an ihren Domain-Endpoint.
- CostsForm rendert die `Record<string, { in, out }>`-Map als editierbare Tabelle mit Add-Modell-Row.
- CompanyForm bündelt Stammdaten + zwei AgentForm-Instanzen (office, pm); Memory-Access-Optionen sind die Company-Variante.

**Patterns to follow:**
- AgentForm aus U8 wiederverwenden (gleiches Component, andere Memory-Access-Permission-Map).

**Test scenarios:**
- Happy: PoolForm Save → PUT-Call → Section refresht.
- Happy: CompanyForm Save inkl. office-Agent-Update → ein PUT pro betroffener Section.
- Happy: CostsForm mit neuem Modell → POST-equivalent (PUT auf gesamtes costs-Map).
- Edge: Form-Validation für SkillApproval `confidenceThreshold` außerhalb [0,1] → inline Error.
- Edge: Stale-Detection greift auch hier bei Tab-Refocus.
- Error: 412 → ConflictDialog.

**Verification:** Browser: `/settings` zeigt alle Sections, Pool-Wert ändern + speichern → `pragents.yaml` reflektiert; `cd web && npx vitest run` grün.

---

### U11. Server — Slice 4: Workflow CRUD + workflowDirectory schema

**Goal:** Workflow-Files pro Projekt verwalten (List/Create/Update/Delete) und das Schema um `workflowDirectory`-Feld pro Projekt erweitern.

**Requirements:** R14, R15, R19

**Dependencies:** U1 (Schema-Erweiterung), U2 (yaml-rw — auch für Workflow-YAML-Round-Trip)

**Files:**
- `packages/schema/src/config.ts` — `ProjectConfig` um `workflowDirectory: z.string().default('workflows')` erweitern
- `server/src/workflows/loader.ts` — liest `workflowDirectory` pro Projekt aus dem neuen Feld (Default `workflows/` relativ zum Projekt-Directory)
- `server/src/api/routes/workflows.ts` — neue Endpoints: `GET /api/v1/projects/:projectId/workflows` (Liste), `GET /api/v1/projects/:projectId/workflows/:name` (Inhalt + ETag), `POST /api/v1/projects/:projectId/workflows` (create), `PUT /api/v1/projects/:projectId/workflows/:name` (update), `DELETE /api/v1/projects/:projectId/workflows/:name`
- `server/src/api/routes/__tests__/workflows.test.ts` — erweitert
- `packages/schema/src/__tests__/config.test.ts` (neu) — verifiziert workflowDirectory-Default

**Approach:**
- Workflow-File-Pfad: `<projectDir>/<workflowDirectory>/<name>.yaml` mit Sanitization.
- Validation gegen `WorkflowSchema` aus `@pragents/schema/workflow` server-seitig vor dem Schreiben.
- Origin-Tagging via U2's `suppressNextChange`.

**Patterns to follow:**
- Bestehende `server/src/workflows/loader.ts` Loading-Logik.

**Test scenarios:**
- Happy: GET Liste mit existierenden YAMLs.
- Happy: POST neuer Workflow mit valid Body → 201, File angelegt, Registry sieht ihn beim nächsten Reload.
- Happy: PUT Update bestehender Workflow → File aktualisiert, Kommentare erhalten (eemeli/yaml).
- Edge: POST mit Workflow-Name der existiert → 409.
- Edge: GET/PUT/DELETE auf nicht-existierenden Workflow → 404.
- Edge: PUT mit YAML der nicht WorkflowSchema entspricht → 400 mit Zod-Error.
- Error: PUT mit stale If-Match → 412.
- Integration: existierende Projekte ohne `workflowDirectory`-Feld kriegen Default `workflows` und brechen kein bestehendes Verhalten.

**Verification:** Vitest grün; manueller curl: POST + GET + PUT roundtrip.

---

### U12. Web — Slice 4: Workflow editor (Monaco + snippets) + project-detail sub-route

**Goal:** Schema-aware Code-Editor für Workflow-YAMLs, eingebettet in `/projects/$projectId/workflows`.

**Requirements:** R14, R15, R16, R12, R20, F3, AE6

**Dependencies:** U3, U8 (Sub-Tab-Routing), U11 (Endpoints)

**Files:**
- `web/src/routes/projects/$projectId/workflows/index.tsx` (neu) — Liste der Workflows
- `web/src/routes/projects/$projectId/workflows/$workflowName.tsx` (neu) — Editor-View
- `web/src/components/WorkflowEditor.tsx` (neu) — Monaco-Wrapper mit Schema-aware Validation
- `web/src/components/workflow-snippets.ts` (neu) — Snippet-Definitionen für sequentiellen Step, parallel-Block, Gate, conditional-Branch
- `web/package.json` — `monaco-editor` als Dep + `@monaco-editor/react` als React-Wrapper, `monaco-yaml` für YAML-Sprache
- `web/src/components/__tests__/WorkflowEditor.test.tsx` (neu)

**Approach:**
- Monaco mit `monaco-yaml` initialisiert; das Workflow-JSON-Schema wird zur Laufzeit via `zod-to-json-schema` aus `@pragents/schema/workflow` generiert (einmaliger Build-Step, gecached) und in `monaco-yaml` als Validation-Source registriert.
- Inline-Errors als Gutter-Markers (Monaco's native `markers` API).
- Autocomplete via `monaco.languages.registerCompletionItemProvider` mit Trigger-Char `' '` (Space) und manuellem Ctrl-Space — Vorschläge kommen aus dem Schema (Step-Typen, Agent-Refs aus dem `/api/v1/agents`-Endpoint via React-Query).
- Snippets aus `workflow-snippets.ts` als CompletionItems mit `kind: Snippet` und `insertText` mit Tabstops.
- Save geht durch `useYamlSave` (Free-Text-Save: `before`=Server-State, `after`=Editor-Content), R1-Diff-Preview greift trotz Editor.
- Sub-Route via TanStack Router file-based routes unter `/projects/$projectId/workflows/`.

**Patterns to follow:**
- Existing Monaco usage falls vorhanden — sonst Monaco-Standard-Pattern aus `@monaco-editor/react`-Docs.

**Test scenarios:**
- Happy: Editor lädt Workflow-Inhalt; Schema wird angewendet.
- Happy: Edit + Save geht durch Diff-Preview → PUT.
- Happy `Covers F3.`: Snippets-Menü zeigt 4 Vorschläge an.
- Edge `Covers AE6.`: YAML mit `agent: dev@nonexistent` → Marker auf der Zeile, Hover zeigt "Agent existiert nicht in Config".
- Edge: leeres YAML → keine Marker außer Schema-Required-Felder fehlen.
- Edge: Save bei stale ETag → ConflictDialog.
- Error: Save mit syntaktisch ungültigem YAML → 400 vom Server, Toast.
- a11y: Editor hat `aria-label`, Keyboard-Nav funktioniert (Monaco's Default-a11y).

**Verification:** Browser: Workflow editieren, ungültige Agent-Ref erzeugt rote Squiggle; Snippets-Insert funktioniert; Save schreibt YAML mit erhaltenen Kommentaren; `cd web && npx vitest run` grün.

---

## Acceptance Examples → Test Scenario Map

Aus dem Origin-Doc carried; jeder AE wird durch mindestens ein Test-Szenario in der zuständigen Unit abgedeckt:

- AE1 (Konflikt-Dialog bei externem Save) → U3 useYamlSave-Integration + U6 Tab-Refocus-Edge.
- AE2 (Kommentare bleiben erhalten beim Projekt-Hinzufügen) → U2 yaml-rw Round-Trip-Tests + U7 PUT-Roundtrip.
- AE3 (invalid Cost-Form → Save blocked) → U6 Edge-Case + U10 SkillApprovalForm-Variante.
- AE4 (Reject behält Datei + setzt Status) → U5 happy + U6 happy.
- AE5 (neuer Agent ohne Restart sichtbar) → U7 happy + U8 happy.
- AE6 (Workflow-Editor markiert nicht-existenten Agent) → U12 edge.
- AE7 (Origin-tagging unterdrückt Self-Konflikt) → U2 edge + U7 integration.
- AE8 (Delete blocked bei aktiver Session) → U7 edge + U8 edge.
- AE9 (Approve verschiebt Verzeichnis und setzt Status) → U5 happy + U6 happy.

---

## System-Wide Impact

- **Bestehende Hot-Reload-Pipeline** wird mit `suppressNextChange` ergänzt; das Verhalten für externe Edits bleibt 1:1, nur UI-eigene Saves werden gefiltert.
- **Bestehende Skills-Route** (`web/src/routes/skills/index.tsx`) wird erweitert — Approve/Reject behält die optimistische UI; Mutations gehen jetzt durch das neue Operations-Modul (U5).
- **`pragents.yaml`-Format** ändert sich nicht; einziges neues Schema-Feld ist `ProjectConfig.workflowDirectory` mit Default — bestehende Configs bleiben gültig.
- **Web-Bundle** bekommt `monaco-editor` (~2-3 MB roh, lazy-loadable über Code-Split) — relevant nur für Slice 4. Monaco ist mit dynamischem Import in der Workflow-Route gemountet, andere Routen pullen es nicht rein.
- **API-Surface** wächst signifikant: neue REST-Routes für jede Slice. Bestehende Read-Routes bekommen ETag-Header (additiv, bricht keinen Client).
- **Operator-Workflow im Editor** ist weiterhin gleichberechtigt: jeder UI-Save kann von einer Vim-Edit überschrieben werden (Konflikt-Dialog beim nächsten UI-Save) und umgekehrt.

---

## Risks & Mitigation

- **Monaco-Bundle-Größe** (Slice 4) — Mitigation: dynamischer Import, Route-Level-Code-Split, `monaco-editor/esm/vs/editor/editor.api`-Subset statt Full-Build.
- **Watcher-Race auf macOS** — fs.watch auf macOS hat manchmal duplicate-events. Suppression-Window mit 250ms Default reicht typischerweise; konfigurierbar falls nötig.
- **Schema-Refactor (U1) bricht versehentlich einen Server-Test** — Mitigation: Re-Export-Bridge in `server/src/config/schema.ts` bleibt zunächst, alle Imports laufen weiter; Migration der direkten Imports kann später als Cleanup folgen.
- **Skill-Approve-Move kollidiert mit gleichzeitiger Auto-Extraction** — Single-User-Tool, in der Praxis kaum gleichzeitig; falls doch, FS-Layer-Errors fangen es. Kein Lock nötig.
- **Modal-a11y-Drift** — `axe-core`-Tests in CI fangen Regressions; jede neue Modal-Variante muss `Modal.tsx`-Wrapper benutzen.
- **Workflow-Editor-Schema-Generation aus Zod** — `zod-to-json-schema` deckt Refinements nur teilweise ab; Verifikation auf reale Workflows in U11/U12 nötig (Test-Szenario darin).

---

## Scope Boundaries

Carried verbatim aus origin (Scope Boundaries):

- `.env`/API-Key-Management bleibt dateibasiert
- Visueller Workflow-Builder ausgeschlossen
- Keine DB-Migration der Konfiguration
- Keine Multi-User-Mechanik
- Keine eigene Snapshot-Versionierung
- Keine Konfiguration anderer Interfaces als `web`
- Kein YAML-Format-Wechsel
- Memory-Engine-Tuning kein eigener UI-Schwerpunkt
- Frequenz-Validierung der Premise nicht in dieser Runde

### Deferred to Follow-Up Work

- **YAML-Language-Server statt hand-kuratierter Snippets** für den Workflow-Editor — relevant erst, wenn Snippet-Wartung Last wird oder Operator komplexere Vervollständigung verlangt.
- **Generisches `PUT /api/v1/config/:path`-Endpoint** — Konsolidierung der per-Domain-Endpoints, falls die Route-Zahl explodiert (heute nicht der Fall).
- **Editor-First (JSON-Schema-Export für IDE-LSP)** — laut Origin Acknowledged Assumption komplementär; falls Slice 1 zeigt, dass Operator nicht zu Slice 2-4 wechselt, ist LSP-Export plus Snippet-Doku der Cut-Fallback.
- **Inline-AgentForm-Reuse für Skill-Frontmatter** — Slice 1's `SkillFrontmatterForm` dupliziert minimal Pattern aus AgentForm; falls beide divergieren wird Konsolidierung schwer, deshalb separat gehalten.

---

## Dependencies / Prerequisites

- `eemeli/yaml` v2 ist bereits Server-Dep (`server/package.json`).
- `monaco-editor` + `@monaco-editor/react` + `monaco-yaml` müssen in U12 zu `web/package.json` hinzugefügt werden.
- `axe-core` ist bereits Web-Dev-Dep (`web/package.json`) — wird in U3 für a11y-Tests verwendet.
- `diff` (oder eine vergleichbare line-based-Diff-Library) muss in U3 als Web-Dep ergänzt werden — von `DiffPreview.tsx` benötigt.
- `zod-to-json-schema` muss in U12 als Web-Dep ergänzt werden (siehe SG-005-Finding zur Bewertung dieser Wahl).
- Neuer Workspace `packages/schema/` braucht Wurzel-`package.json`-Update auf `workspaces: ["server", "web", "packages/*"]`.

---

## Outstanding Questions

### Resolve Before Implementation

*(keine — die zwei vormaligen Blocker sind in den Key Technical Decisions resolved)*

### Deferred to Implementation

- [Affects U5][Needs verification] `x-pragents-*`-Frontmatter-Feld-Reihenfolge — wird in U5-Implementierung gegen pi-coding-agent's tatsächlichen SKILL.md-Parser verifiziert (vermutlich keine Reihenfolge-Annahme, aber konkret prüfen).
- [Affects U7][Technical] Genaues Sub-Routing für Agent-Endpoints — `POST /api/v1/projects/:id/agents` (mit body.type) vs. `POST /api/v1/projects/:id/agents/:type` — wird in U7-Implementierung an Hono-Router-Konvention im Repo orientiert.
- [Affects U10][UX] Settings-Section-Save: pro Section ein Button (entschieden) — falls UX-Test zeigt, dass Operator stattdessen "Save All" erwartet, kann ein zusätzlicher globaler Save oben ergänzt werden (additiv).
- [Affects U12][Technical] Welche Monaco-yaml-Version mit aktuellem `monaco-editor` kompatibel — wird in U12-Setup geprüft.
