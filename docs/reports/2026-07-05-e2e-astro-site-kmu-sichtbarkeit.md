# End-to-End-Test: Astro-Website komplett durch pragents bauen lassen

**Datum:** 2026-07-05 · **Rolle:** Website-Betreiber (Operator), ausschließlich über die Web-UI · **Regel:** pragents erledigt alles selbst — der Operator bereitet nichts vor.

## Auftrag und Ergebnis

Auftrag: Eine Astro-Website zum Thema „Sichtbarkeit im Internet für kleine Unternehmen im Zeitalter von KI-Suche" — Startseite + Blog, im Dev-Modus lauffähig, Blog mit 3 fertigen Artikeln, danach 2×/Woche automatisch ein neuer Artikel.

**Ergebnis: vollständig erreicht.**

| Kriterium | Status |
|---|---|
| Astro-Site designt + technisch umgesetzt | ✅ dev-Agent baute autonom das komplette Projekt (package.json, configs, Content-Collection, Layout, 3 Routen, Styling) inkl. `npm install` + `npm run build` + `astro check` (0 Fehler) — in 5,4 Min |
| Dev-Modus lauffähig | ✅ `npm run dev` auf :4321, alle Routen 200 |
| ≥3 Blog-Artikel | ✅ 6 Artikel: 1 Platzhalter (dev-Agent), 3 beauftragt (content-Agent, 87 s), 2 durch die Automatik erzeugt |
| 2×/Woche-Automatik | ✅ Projekt-Workflow `blog-neuer-artikel` + Goal `kmu-blog-2x` (cron `0 9 * * 1,4`); zwei echte Läufe erzeugten je einen neuen, thematisch nicht duplizierten Artikel; Goal-Run erreicht `complete`; nächster Auto-Trigger korrekt geplant (Mo 09:00) |

Setup über die UI: Projekt `kmu-sichtbarkeit` (New-Project-Wizard) mit `dev` (zai/glm-5.1) und `content` (deepseek/deepseek-v4-flash); Tasks über die Command-Palette dispatcht; Workflow im Monaco-Editor geschrieben; Goal im Goal-Formular angelegt.

## Gefundene Bugs (alle in dieser Session behoben)

### B1 — Workflow-Editor rendert nie (Blocker)
Projekt → Workflows → „Create + open editor" legte die Datei an, aber die Editor-URL zeigte weiter die Liste — kein Editor, keine Bearbeitungsmöglichkeit. **Ursache:** `$projectId.workflows.tsx` renderte die Liste ohne `<Outlet/>`, war in TanStack-Flat-Routing aber zugleich Layout-Elternroute der Editor-Kindroute. **Fix (Subagent):** Index-Route-Split (Liste → `…workflows.index.tsx`, Elternroute = reines `<Outlet/>`-Layout).

### B2 — Workflows neu angelegter Projekte unsichtbar bis Server-Neustart (Blocker)
Goal „Run now" tat nichts; `/api/v1/workflows` war `[]`, obwohl die Workflow-Datei existierte. **Ursache:** Der Config-Hot-Reload aktualisierte nur Agents — `config.projects` blieb der Boot-Stand, `loadProjectWorkflows` lief für per UI neu angelegte Projekte nie, fs-Watcher fehlten. **Fix (Subagent):** `syncProjectsFromConfig` in `applyConfigReload` (in-place-Update von `config.projects`, Workflows laden, Watcher deduplicated ergänzen).

### B3 — Goal-Run bleibt ewig „running" + Zeitzonen-Versatz
Workflow-Run `complete`, Goal-Run blieb `running`; frisch ausgelöster Run zeigte „2h ago". **Ursache (3a):** `GoalScheduler.onEvent` war korrekt, wurde aber nie mit Workflow-Events gefüttert — die Engine schreibt Events nur via `eventBuffer.push()`, und `EventBuffer` hat keinen Subscribe-Mechanismus. **(3b):** `triggered_at` als SQLite-`datetime('now')` (naiv, ohne Zone), Client parst lokal. **Fix (Subagent):** `WorkflowEngine.setEventListener` → an broadcast/SSE/`goalScheduler.onEvent` verdrahtet; Timestamps als ISO-UTC. Live verifiziert: Kontroll-Lauf erreichte `complete`.
**Operator-Falle:** Ein VOR dem Fix hängengebliebener Run aktualisiert sich nicht rückwirkend und blockiert „Run now" (Button disabled). Recovery: Goal löschen + mit neuer id anlegen. Verbesserungsidee: hängende Runs nach Timeout auto-failen bzw. „mark as failed"-Aktion.

### B4 — Goal-level „Human gates" waren totes Config (Architektur-Bereinigung)
Das Goal-Formular bot `human_gates` (step/label/timeout) an; Schema + API führten das Feld — aber kein Server-Code injizierte diese Gates je in einen Workflow-Run. Funktionierende Gates gibt es nur als `type: human_gate`-**Workflow-Step** (pausiert den Run, Inbox: Approve/Reject/Revise mit Feedback-Schleife, Timeout). **Entscheidung (Betreiber): Feld entfernt** — Gates leben ausschließlich im Workflow (eine Quelle der Wahrheit, konsistent über alle Trigger-Pfade). Umgesetzt durch Subagent (Schema, API, Formular, Anzeige, Tool-Output, Tests, README, Beispiel-Goal).

### B5 — Workflow-Editor: Snippets doppelt bei Ctrl+Space
Jeder Snippet (step/gate/parallel/…) erschien zweimal. **Ursache:** Completion-Provider global für `yaml` registriert, ohne Guard — React-StrictMode-Doppelmount registriert doppelt (die YAML-Schema-Config daneben hatte den Guard bereits). **Fix (direkt):** Modul-Flag analog `monacoYamlConfigured`. Verifiziert: 6 Einträge, je 1×.

### UX-Korrekturen auf Zuruf des Betreibers
- **Goal-Run-Zeile:** zeigte zwei rohe UUIDs → jetzt Goal-Name + Zeit + `run <hex8>`-Token, volle IDs im Tooltip.
- **„workflow linked":** sah wie ein Link aus, war ein statisches div → jetzt „open workflow →" mit echtem Link auf den Projekt-Workflow-Editor (Name→projectId aus der Registry aufgelöst).

## Offene Befunde (nicht in dieser Session behoben)

1. **FK-Constraint beim Session-Persist:** wiederholt `Failed to persist messages for session … FOREIGN KEY constraint failed` (+ folgender Auto-Extraction-Fehler) für Agents neu angelegter Projekte. Blockiert die Aufgaben nicht, ist aber ein echter DB-Bug (vermutlich fehlt die Session-/Agent-Zeile, auf die `messages` referenziert, wenn das Projekt nach Boot entstand).
2. **Modell-Dropdown ohne Nutzbarkeits-Filter:** Bei der Agent-Anlage listet der Picker ~700 Modelle aller pi-Provider; nutzbar sind nur die mit hinterlegtem Key (hier: deepseek, zai). Modelle ohne Key sollten ausgegraut/gruppiert werden — der Health-Check warnt erst nach der Wahl.
3. **Hängende Alt-Runs** (siehe B3): brauchen einen Auto-Timeout oder eine manuelle Auflösungs-Aktion.
4. **Stille Fehlpfade:** Goal „Run now" gegen einen unbekannten Workflow scheiterte vor B2 ohne jede UI-Rückmeldung. Fehler dieser Klasse sollten als Toast/Inline-Fehler sichtbar werden.

## Was überzeugend funktioniert

- **Agents leisten echte, mehrstufige Arbeit:** komplettes Projekt-Scaffolding inkl. Paketinstallation und Build-Fix-Loop (dev), thematisch koordinierte Artikelserien mit korrektem Frontmatter (content), Themen-Dedup gegen vorhandene Dateien im Automatik-Lauf.
- **Die Orchestrierungs-Kette hält:** UI-Projekt-Wizard → Agents → Task-Dispatch → Workflow-Editor (Monaco mit Schema + Agent-Markern + Snippets) → Goal mit Cron → automatische Artikel. Nach den Fixes end-to-end ohne API-Handgriffe bedienbar.
- **Beobachtbarkeit:** Task-Detail (Timeline, echte Tokens, Trace-Link), Live-Events, Goal-Run-Historie.

## Artefakte

- Website: `~/pragents-sites/kmu-sichtbarkeit` (Dev: `npm run dev` → :4321)
- Workflow: `~/pragents-sites/kmu-sichtbarkeit/workflows/blog-neuer-artikel.yaml`
- Goal: `~/.pragents/goals/kmu-blog-2x.yaml` (cron `0 9 * * 1,4`)
- Build-Task `ecb25854` (dev, 5,4 Min, 14.819/10.443 Tokens) · Content-Task `f091163f` (87 s) · Goal-Runs: 1× hängend (vor Fix), 1× `complete` (75 s, Artikel 6)
