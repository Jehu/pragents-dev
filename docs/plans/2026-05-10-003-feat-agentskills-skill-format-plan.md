---
title: "feat: Migrate skill format to agentskills.io-compatible SKILL.md"
type: feat
status: active
date: 2026-05-10
---

# feat: Migrate skill format to agentskills.io-compatible SKILL.md

## Summary

Migriert das pragents Skill-System vom aktuellen reinen `.yaml`-Format (Zod `SkillDef`) auf das agentskills.io-kompatible `SKILL.md`-Format mit YAML-Frontmatter. Pragents-eigene Metadaten werden via `x-pragents-*`-Prefix im Frontmatter abgelegt und von pi sowie anderen agentskills.io-Clients stillschweigend ignoriert. Skills erhalten eine Verzeichnisstruktur mit optionalen `scripts/`, `references/` und `assets/` Ordnern. Die Zod-Validierung bleibt erhalten. SQLite dient weiterhin als Index/Cache.

---

## Problem Frame

Aktuell speichert die `SkillRegistry` Skills als reine `.yaml`-Dateien mit einem Zod-Schema (`SkillDef`), das workflow-artige `steps[]` enthält. Das widerspricht:

1. Der **Design-Spec** (Section 11.1), die pi-native `.md`-Dateien mit YAML-Frontmatter und `x-pragents-*`-Prefix vorschreibt
2. Dem **agentskills.io-Standard**, den pi selbst implementiert ("Pi implements the Agent Skills standard")
3. Der **pi-Philosophie** von Progressive Disclosure (nur name+description im System-Prompt, voller Body on-demand)

Außerdem fehlen die agentskills.io-Standard-Features: optionale `scripts/`, `references/`, `assets/` Ordner sowie `license`, `compatibility`, `allowed-tools` Felder.

Pi ignoriert unbekannte Frontmatter-Felder lautlos (`[key: string]: unknown` im `SkillFrontmatter`-Interface). `x-pragents-*`-Felder als top-level YAML-Frontmatter sind daher sicher.

---

## Requirements

- **R1.** Skills werden als `SKILL.md` in benannten Unterverzeichnissen gespeichert (agentskills.io-konform)
- **R2.** YAML-Frontmatter enthält agentskills.io-Standardfelder: `name` (required, max 64c, lowercase+hythens), `description` (required, max 1024c), `license`, `compatibility`, `allowed-tools`
- **R3.** Pi-spezifische Felder werden unterstützt: `argument-hint`, `disable-model-invocation`
- **R4.** Pragents-Metadaten via `x-pragents-*`-Prefix: `x-pragents-scope`, `x-pragents-status`, `x-pragents-version`, `x-pragents-tags`, `x-pragents-agent-types`, `x-pragents-parameters`, `x-pragents-extraction`, `x-pragents-changelog`, `x-pragents-examples`
- **R5.** Zod-Validierung des Frontmatters beim Laden
- **R6.** Optionale `scripts/`, `references/`, `assets/` Ordner pro Skill
- **R7.** Markdown-Body ersetzt das bisherige `steps[]`-Feld (Agent liest das Dokument, statt Workflow-DSL zu parsen)
- **R8.** SQLite `skills`-Tabelle bleibt als Index/Cache, Source of Truth = `SKILL.md`-Dateien
- **R9.** Skills werden aus `~/.pragents/skills/` geladen (konfigurierbar, getrennt von pi's `~/.pi/agent/skills/`)
- **R10.** SkillExtractor generiert `SKILL.md`-Format statt `.yaml`
- **R11.** SkillRouter nutzt `x-pragents-tags` und `x-pragents-agent-types` für Agent-Matching

---

## Scope Boundaries

- Keine `skills-ref validate` CLI-Integration (kann später ergänzt werden)
- Keine pi-Einbindung der pragents-Skills (separater Schritt)
- Keine Migration bestehender Skills (der `skills/` Ordner ist aktuell leer)
- Kein Skill-Marketplace / Sharing

### Deferred to Follow-Up Work

- pi-Integration: pragents-Skills via `settings.json` `skills`-Array in pi einbinden
- `skills-ref validate` als optionaler Validierungsschritt

---

## Context & Research

### Relevant Code and Patterns

- **`server/src/skills/schema.ts`** — Aktuelles Zod `SkillDef` (wird ersetzt)
- **`server/src/skills/registry.ts`** — `SkillRegistry` mit `load()`, `save()`, `delete()` (wird umgeschrieben)
- **`server/src/skills/extractor.ts`** — `SkillExtractor` mit `LLMSkillProposalSchema` (wird angepasst)
- **`server/src/routing/router.ts`** — `SkillRouter.resolveAgent()` nutzt `agent.skills` aus Config (minimale Änderung)
- **`server/src/index.ts`** — `skillsDir` auf `join(__dirname, '..', '..', 'skills')` gesetzt (Pfad ändern)
- **`server/src/api/routes/skills.ts`** — REST API für Skills (bleibt größtenteils unverändert)
- **`server/src/db/migrations/`** — `skills` Tabelle in Migration 007_skills.sql

### Institutional Learnings

- **`docs/superpowers/specs/2026-05-06-pragents-design.md`** Section 11.1: Spezifiziert pi-native `.md` mit `x-pragents-*` Prefix — das ist der Zielzustand
- **`docs/plans/2026-05-09-007-feat-pragents-m5-llm-skill-extraction-plan.md`**: M5 Skill Extraction Plan — der Extractor muss auf SKILL.md-Generierung umgestellt werden

### External References

- **agentskills.io/specification**: Der Standard — `name` (64c, lowercase+hythens), `description` (1024c), `license`, `compatibility`, `metadata`, `allowed-tools`; optional `scripts/`, `references/`, `assets/`
- **pi docs `/skills.md`**: "Pi implements the Agent Skills standard, warning about violations but remaining lenient. Unknown frontmatter fields are ignored."
- **`gray-matter` npm package**: De-facto Standard für YAML-Frontmatter + Markdown-Parsing in Node.js

---

## Key Technical Decisions

- **`x-pragents-*` als top-level YAML-Frontmatter (nicht in `metadata:` block)**: pi ignoriert unbekannte Felder via `[key: string]: unknown`. Top-level ist lesbarer und einfacher zu parsen als verschachteltes `metadata:`. Vendor-Prefix `x-` folgt Best Practice.
- **`gray-matter` statt eigenem Parser**: Bewährt, leichtgewichtig, Frontmatter + Body in einem Call
- **SQLite als Cache, nicht Source of Truth**: SKILL.md-Dateien sind die autoritative Quelle. SQLite dient nur für Query/Index (Tag-Suche, Status-Filter).
- **`~/.pragents/skills/` als Default-Pfad**: Trennung von pi's `~/.pi/agent/skills/`. Über Umgebungsvariable `PRAGENTS_SKILLS_DIR` konfigurierbar.
- **`disable-model-invocation: true` als pragents-Default**: Verhindert, dass pragents-Skills ungewollt in pi's System-Prompt erscheinen, falls jemand den Ordner in pi einbindet.
- **`steps[]` → Markdown-Body**: Der agentskills.io-Standard sieht freies Markdown als Body vor. Der Agent liest die Anweisungen und befolgt sie — das ist das intendierte Pattern. Kein Workflow-DSL nötig.
- **Parameter `type` als String-Literal-Enum**: `'string' | 'number' | 'boolean' | 'string[]'` — deckt die pragents-Use-Cases ab, ist YAML-nativ darstellbar.

---

## Open Questions

### Resolved During Planning

- **x-pragents-* top-level vs. metadata-Block?** → Top-level. pi ignoriert unbekannte Felder, vendor-prefix ist sicher.
- **steps[] → wohin?** → In den Markdown-Body. agentskills.io-Standard-Pattern.
- **Skills-Pfad?** → `~/.pragents/skills/`, konfigurierbar via `PRAGENTS_SKILLS_DIR`.
- **`tools`-Feld?** → Gemappt auf agentskills.io `allowed-tools` (space-separiert im Standard, aber wir speichern als `string[]` und serialisieren bei Bedarf).

### Deferred to Implementation

- Exakte `gray-matter`-API-Nutzung (hängt von der genauen Version ab)
- Frontmatter-Stringify für `save()` — wie YAML-Komplexe Typen (Arrays, Objekte) im Frontmatter geschrieben werden

---

## Implementation Units

### U1. Neues Zod-Schema: `PragentsSkillFrontmatter`

**Goal:** Definiere ein neues Zod-Schema, das alle agentskills.io + pi + x-pragents-* Felder validiert.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- **Modify:** `server/src/skills/schema.ts`

**Approach:**
- Benenne das bestehende `SkillDef` nicht um (bleibt für Abwärtskompatibilität mit SQLite), sondern füge ein neues `PragentsSkillFrontmatter`-Schema hinzu
- Das Schema validiert NUR das YAML-Frontmatter (nicht den Markdown-Body)
- `description` wird **required** (agentskills.io verlangt es, pi lädt Skills ohne description nicht)
- `name` validiert auf max 64 Zeichen und lowercase+hythens-Pattern
- `allowed-tools` wird als `string` (space-separiert) akzeptiert, intern aber als `string[]` gespeichert
- `x-pragents-*` Felder sind alle optional (ein Skill kann manuell ohne sie erstellt werden)

**Patterns to follow:** Bestehende Zod-Schemas in `schema.ts` (SkillStep, SkillParameter, etc.) — konsistente `z.object()` Patterns

**Test scenarios:**
- Minimal gültiges Frontmatter: nur `name` + `description`
- Vollständiges Frontmatter mit allen x-pragents-* Feldern
- `name` mit ungültigen Zeichen (Uppercase, Sonderzeichen) → Validation Error
- `description` fehlt → Validation Error
- `description` > 1024 Zeichen → Validation Error
- `name` > 64 Zeichen → Validation Error
- `x-pragents-parameters` mit verschachtelten Objekten → valid
- `x-pragents-examples` mit input/expected_output → valid
- `x-pragents-changelog` mit version/date/change → valid

**Verification:** `npm test` im server-Verzeichnis, alle Schema-Tests grün

---

### U2. Rewrite SkillRegistry für SKILL.md Discovery

**Goal:** `SkillRegistry` lädt Skills aus `SKILL.md`-Dateien in Unterverzeichnissen statt aus flachen `.yaml`-Dateien.

**Requirements:** R1, R2, R5, R6, R8, R9

**Dependencies:** U1 (Schema)

**Files:**
- **Modify:** `server/src/skills/registry.ts`
- **Add:** `gray-matter` dependency (`npm install gray-matter`)

**Approach:**

**`load()` — von flach zu rekursiv:**
- Statt `readdirSync` nach `*.yaml` → rekursiv nach `SKILL.md` in Unterverzeichnissen suchen
- Pro gefundenem `SKILL.md`: `gray-matter.read(filePath)` → Frontmatter parsen → mit `PragentsSkillFrontmatter` validieren → in Map speichern
- Wenn ein Unterverzeichnis `SKILL.md` enthält, ist es ein Skill-Root (keine tiefere Rekursion — wie pi)
- Warnungen bei Validierungsfehlern loggen, Skill trotzdem laden (lenient wie pi)

**`save(skill)` — SKILL.md in Unterverzeichnis schreiben:**
- `mkdirSync(join(skillsDir, skillName))` falls nicht existent
- `gray-matter.stringify(body, frontmatter)` → `writeFileSync(join(dir, 'SKILL.md'))`
- SQLite INSERT OR REPLACE wie bisher (Index/Cache)
- Zusätzlich: leere `scripts/`, `references/`, `assets/` Ordner anlegen? Nein — nur wenn Skill sie tatsächlich braucht.

**`delete(name)` — Verzeichnis löschen:**
- `rmSync(join(skillsDir, name), { recursive: true })`
- SQLite DELETE wie bisher

**`load()`-Discovery-Algorithmus (Pseudocode):**
```
for each dir in skillsDir:
  if dir/SKILL.md exists:
    skill = parseSkill(dir/SKILL.md)
    skills.set(skill.name, skill)
  // keine tiefere Rekursion — es ist ein Skill-Root
```

**Patterns to follow:** pi's `loadSkillsFromDirInternal` Logik (rekursiv, stoppt bei SKILL.md). Bestehende `SkillRegistry`-Struktur (Map, get/list/findByTags).

**Test scenarios:**
- Leerer Skills-Ordner → `load()` gibt leeres Array zurück
- Ein Skill mit gültigem SKILL.md → wird geladen
- Zwei Skills in separaten Unterverzeichnissen → beide geladen
- Skill mit fehlender description → Warnung, Skill wird nicht geladen (pi-Verhalten)
- Skill mit ungültigem YAML → Warnung, Skill wird nicht geladen
- `save()` erstellt Verzeichnis + SKILL.md + SQLite-Eintrag
- `delete()` entfernt Verzeichnis + SQLite-Eintrag
- Skills-Ordner existiert nicht → wird via `mkdirSync({ recursive: true })` erstellt

**Verification:** `npm test -- --run skills` im server-Verzeichnis

---

### U3. Update Skill-Loading in index.ts (Pfad + Konfiguration)

**Goal:** `skillsDir` zeigt auf `~/.pragents/skills/` statt projekt-lokal `skills/`, konfigurierbar via Umgebungsvariable.

**Requirements:** R9

**Dependencies:** U2 (Registry)

**Files:**
- **Modify:** `server/src/index.ts`

**Approach:**
- `skillsDir` = `process.env.PRAGENTS_SKILLS_DIR || join(homedir(), '.pragents', 'skills')`
- Entferne projekt-lokalen `skills/` Pfad (der war `join(__dirname, '..', '..', 'skills')`)
- Hot-Reload-Watcher auf den neuen Pfad umbiegen

**Test scenarios:**
- `PRAGENTS_SKILLS_DIR` nicht gesetzt → Default `~/.pragents/skills/`
- `PRAGENTS_SKILLS_DIR=/custom/path` → Pfad wird respektiert
- Verzeichnis existiert nicht → `mkdirSync` in Registry erstellt es

**Verification:** Server startet, Log zeigt "Skills loaded: ..."

---

### U4. Update SkillExtractor für SKILL.md-Generierung

**Goal:** `SkillExtractor` generiert `SKILL.md`-Format (Frontmatter + Markdown-Body) statt reines `.yaml`.

**Requirements:** R10

**Dependencies:** U1 (Schema), U2 (Registry)

**Files:**
- **Modify:** `server/src/skills/extractor.ts`

**Approach:**
- Der LLM-Prompt wird angepasst: Statt JSON mit `steps[]` → Markdown-Body mit nummerierten Schritten generieren
- `LLMSkillProposalSchema` wird durch neues Schema ersetzt, das `body` (Markdown-String) statt `steps[]` erwartet
- Ausgabe-Mapping: LLM-Antwort → `PragentsSkillFrontmatter` + body → `SkillRegistry.save()`
- `x-pragents-extraction` wird automatisch gesetzt: `source: 'extracted'`, `source_session_id`, `source_agent_id`, `extracted_at`, `model_used`, `confidence`

**LLM-Prompt-Änderung (Kernidee):**
```
Statt: "Output JSON with steps array"
Neu: "Output YAML frontmatter with x-pragents-* fields, followed by Markdown body with numbered workflow steps"
```

**Patterns to follow:** Bestehender Extractor-Flow (Session → Trace → LLM → Validation → Proposal). Nur das Ausgabeformat ändert sich.

**Test scenarios:**
- Extractor generiert gültiges SKILL.md mit Frontmatter + Body
- `x-pragents-extraction` enthält source_session_id, extracted_at
- Confidence-Wert wird korrekt aus LLM-Antwort übernommen
- Skill mit leeren Tags → wird trotzdem gespeichert
- Skill mit parameters → x-pragents-parameters im Frontmatter

**Verification:** Extraktor-Test mit Mock-LLM-Antwort

---

### U5. Update SkillRouter für x-pragents-* Felder

**Goal:** `SkillRouter` liest Skill-Tags aus `x-pragents-tags` und Agent-Types aus `x-pragents-agent-types` für das Routing.

**Requirements:** R11

**Dependencies:** U2 (Registry)

**Files:**
- **Modify:** `server/src/routing/router.ts`
- **Modify:** `server/src/routing/__tests__/router.test.ts`

**Approach:**
- Aktuell matched `SkillRouter.resolveAgent()` gegen `agent.skills` aus der Config
- Erweitern: Zusätzlich gegen `skill.x-pragents-tags` aus der Registry matchen
- `x-pragents-agent-types` wird genutzt, um den initialen Agent-Pool einzuschränken (nur Agents mit passendem Type)
- Priorität: Config-basierte Skills > x-pragents-tags > Keyword-Matching

**Test scenarios:**
- Task matcht x-pragents-tags eines Skills → Skill wird gefunden
- x-pragents-agent-types schränkt Agent-Auswahl ein
- Config-skills und x-pragents-tags gemeinsam → beide werden gescored
- Kein Skill matcht → Fallback auf erstes Keyword-Match

**Verification:** Router-Tests mit Mock-Skills

---

### U6. Update API Routes (Minimale Änderungen)

**Goal:** API-Routen für Skills bleiben funktional, geben jetzt `PragentsSkillFrontmatter` + Body statt `SkillDef` zurück.

**Requirements:** R1, R7

**Dependencies:** U2 (Registry)

**Files:**
- **Modify:** `server/src/api/routes/skills.ts`

**Approach:**
- `GET /api/v1/skills` — Listet Skills mit name, description, x-pragents-status, x-pragents-tags
- `GET /api/v1/skills/:name` — Gibt volles Frontmatter + Markdown-Body zurück
- `POST /api/v1/skills/extract` — Unverändert (delegiert an Extractor)
- Response-Types anpassen: Statt `SkillDef` → `{ frontmatter: PragentsSkillFrontmatter, body: string }`

**Test scenarios:**
- `GET /skills` gibt Array mit name + description
- `GET /skills/:name` gibt Frontmatter + Body
- Nicht existierender Skill → 404

**Verification:** API-Routen-Tests

---

### U7. Update Tests für alle betroffenen Module

**Goal:** Alle bestehenden Tests auf das neue Format migrieren, neue Tests für SKILL.md-Parsing.

**Requirements:** R5

**Dependencies:** U1–U6

**Files:**
- **Modify:** `server/src/skills/__tests__/registry.test.ts`
- **Modify:** `server/src/skills/__tests__/extractor.test.ts`
- **Modify:** `server/src/routing/__tests__/router.test.ts`
- **Modify:** `server/src/config/__tests__/loader.test.ts` (falls skills-relevant)
- **Add:** `server/src/skills/__tests__/schema.test.ts` (neue Schema-Tests)

**Approach:**
- Registry-Tests: Statt Mock-.yaml-Dateien → Mock-SKILL.md-Verzeichnisse mit `gray-matter`
- Extractor-Tests: Mock-LLM-Antwort produziert jetzt Frontmatter + Body statt JSON
- Schema-Tests: Validierung aller x-pragents-* Felder
- Alle Tests verwenden `mkdtempSync` für isolierte Test-Skills-Ordner

**Test scenarios:**
- Pro Unit siehe jeweilige Test-Szenarien oben

**Verification:** `npm test` im server-Verzeichnis — alle Tests grün

---

## System-Wide Impact

| Komponente | Änderung | Risiko |
|---|---|---|
| `schema.ts` | Neues Schema added, altes bleibt | Niedrig |
| `registry.ts` | Komplett-Rewrite (load/save/delete) | Mittel |
| `index.ts` | Pfad-Änderung | Niedrig |
| `extractor.ts` | LLM-Prompt + Ausgabeformat | Mittel |
| `router.ts` | Zusätzliche Match-Logik | Niedrig |
| `routes/skills.ts` | Response-Types | Niedrig |
| Tests | Neue Tests, bestehende angepasst | Niedrig |

**Betroffene Nutzer:** Keine (Skills-Ordner ist leer, keine aktiven Skills)

---

## Risk Analysis & Mitigation

| Risiko | Eintrittswahr. | Impact | Mitigation |
|---|---|---|---|
| `gray-matter` inkompatibel mit ESM | Niedrig | Mittel | `gray-matter` unterstützt ESM. Fallback: manuelles Regex-Parsing |
| LLM-Prompt-Änderung verschlechtert Extraktionsqualität | Mittel | Mittel | Test-Run mit bekannten Session-Traces vor Merge |
| Pfad-Änderung (`~/.pragents/skills/`) bricht Dev-Experience | Niedrig | Niedrig | Umgebungsvariable erlaubt Override |
