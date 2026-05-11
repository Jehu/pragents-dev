---
title: "feat: Auto-skill extraction with PM monitoring and deduplication"
type: feat
status: active
date: 2026-05-11
---

# feat: Auto-skill extraction with PM monitoring and deduplication

## Summary

Erweitert das Skill-System um automatische Extraktion: Nach Session-Ende prüft eine Heuristik, ob die Session ein wiederholbares Muster enthält, und triggert die LLM-basierte Extraktion. Der PM-Agent (via GoalScheduler) überwacht periodisch kürzlich beendete Sessions. Eine Name-basierte und semantische Deduplikation verhindert Duplikate. Ein Config-Flag `autoApproveSkills` steuert, ob extrahierte Skills sofort aktiv werden oder manuelles Approve erfordern.

---

## Problem Frame

Aktuell ist Skill-Extraktion rein manuell: Ein Benutzer muss `POST /api/v1/skills/extract` mit einer Session-ID aufrufen. Das System erkennt nicht selbstständig, wann eine Session ein generalisierbares Muster enthält. In einer Ein-Personen-Agentur mit mehreren Projekten und Agenten entstehen täglich Dutzende Sessions — der Betreiber kann nicht jede manuell auf Extraktionspotenzial prüfen. Ohne Automatisierung bleiben die meisten wiederholbaren Muster unentdeckt, und das Skill-System wächst nicht organisch.

Zusätzlich: Wenn automatisierte Extraktion läuft, entstehen bei wiederholten Mustern Duplikate (z.B. drei SEO-Sessions produzieren leicht unterschiedlich benannte, aber inhaltlich gleiche Skills). Ohne Deduplikation wird der Skill-Katalog unübersichtlich.

---

## Requirements

- **R1.** Nach Session-Ende (disposeIdle/disposeAll) wird automatisch geprüft, ob die Session für Extraktion geeignet ist
- **R2.** Heuristik filtert ungeeignete Sessions: < 10 Messages, Fehlerstatus, bereits extrahiert
- **R3.** GoalScheduler erhält einen periodischen PM-Check, der kürzlich beendete Sessions auf Muster scannt
- **R4.** `autoApproveSkills` Config-Flag steuert, ob extrahierte Skills sofort `active` werden (default: `false` → `proposed`)
- **R5.** Name-basierte Deduplikation: Existiert bereits ein Skill mit gleichem Namen → Extraktion überspringen
- **R6.** Semantische Deduplikation: LLM-basierter Ähnlichkeitsvergleich zwischen extrahiertem Body und existierenden aktiven Skills
- **R7.** Bei semantischem Match (>80%): Kein Duplikat erstellen, existierenden Skill als "bestätigt" markieren (Confidence erhöhen)
- **R8.** Neue Events: `skill.auto_proposed`, `skill.auto_approved`, `skill.deduplicated`
- **R9.** Extraktion ist asynchron — blockiert nicht den Session-Dispose-Prozess
- **R10.** Pro Session wird maximal einmal extrahiert (409-Schutz via `x-pragents-extraction.source_session_id`)

---

## Scope Boundaries

- Keine ML-basierte Mustererkennung (bleibt LLM-basiert)
- Kein automatisches Approven ohne Config-Flag (Human-in-the-Loop by default)
- Keine Batch-Extraktion über historische Sessions (nur neue Sessions)

### Deferred to Follow-Up Work

- Semantisches Clustering über den gesamten Skill-Katalog zur Konsolidierung
- Confidence-basierte Skill-Verbesserung (mehrere ähnliche Sessions → besseres Skill-Template)
- UI für Auto-Extraction-Historie im Dashboard

---

## Context & Research

### Relevant Code and Patterns

- **`server/src/agents/manager.ts`** — `AgentSessionManager.disposeIdle()` (line 310-320): Hier wird nach Message-Persistenz der Session-Handle disposed. Idealer Hook-Punkt.
- **`server/src/agents/manager.ts`** — `persistSessionMessages()` (line 272): Speichert Messages in SQLite. Wird VOR dispose aufgerufen.
- **`server/src/goals/scheduler.ts`** — `GoalScheduler`: Hat bereits `pmCheck()` (alle 5 Min). Kann um Session-Analyse erweitert werden.
- **`server/src/goals/schema.ts`** — `GoalDef`: Kann `autoExtract` Flag erhalten.
- **`server/src/skills/extractor.ts`** — `SkillExtractor.extract()`: Bestehende LLM-Pipeline, bereits funktional.
- **`server/src/skills/registry.ts`** — `SkillRegistry`: `list()`, `get()`, `save()`, `findByTags()` bereits vorhanden.
- **`server/src/config/schema.ts`** — `PragentsConfig`: Hier `autoApproveSkills` Flag hinzufügen.
- **`server/src/config/loader.ts`** — Config-Loader: Liest `pragents.yaml`, muss neues Feld parsen.

### External References

- **agentskills.io/specification**: Skill-Format-Standard
- **pi SDK**: `agent_end` Event-Typ, Session-Lebenszyklus

---

## Key Technical Decisions

- **Hook in `disposeIdle()` und `disposeAll()`**: Message-Persistenz erfolgt bereits dort. Extraktion wird NACH Persistenz angestoßen, läuft aber asynchron (fire-and-forget), um Dispose nicht zu blockieren.
- **Heuristik vor LLM**: Günstiger Filter ($0) vor teurer LLM-Extraktion (~500 Tokens). Spart Kosten bei trivialen Sessions.
- **PM-Monitor als Backup**: Falls der Session-End-Hook fehlschlägt (Crash, Timeout), scannt der periodische PM-Check die letzten 10 beendeten Sessions nach.
- **Semantische Deduplikation per LLM**: Einfacher Prompt "Sind diese beiden Skills dasselbe Pattern?" mit JSON-Antwort `{match: true/false, confidence: 0-1}`.
- **`autoApproveSkills` in Company-Config**: Gehört zur Company-Ebene (unternehmensweite Policy), nicht pro Projekt.
- **Async Extraction Queue**: Extraktionen laufen in einer internen Queue (max 1 concurrent), um LLM-Kosten zu kontrollieren und Rate-Limits einzuhalten.

---

## Open Questions

### Resolved During Planning

- **Wo genau hooken?** → `disposeIdle()` und `disposeAll()`, nach `persistSessionMessages()`
- **Deduplikation ein- oder zweistufig?** → Zweistufig: Name-basiert (gratis) dann semantisch (LLM)
- **autoApproveSkills Default?** → `false` (Human-in-the-Loop by default)

### Deferred to Implementation

- Exakte Ähnlichkeitsschwelle für semantische Deduplikation (80% initial, per Config anpassbar?)
- Wie granular die PM-Check-Session-Auswahl (letzte 10? Letzte Stunde? Per Projekt?)

---

## Implementation Units

### U1. Add `autoApproveSkills` to Config Schema

**Goal:** Config-Schema und Loader unterstützen `autoApproveSkills: boolean` auf Company-Ebene.

**Requirements:** R4

**Dependencies:** None

**Files:**
- **Modify:** `server/src/config/schema.ts` — `CompanyConfig` um `autoApproveSkills` erweitern
- **Modify:** `server/src/config/loader.ts` — Laden und Default setzen
- **Modify:** `server/src/config/__tests__/loader.test.ts` — Test für neues Feld

**Approach:**
```typescript
// In CompanyConfig Zod schema:
autoApproveSkills: z.boolean().optional().default(false)
```
Default `false` = Human-in-the-Loop. Der Wert wird via Dependency Injection an die Extraktionslogik weitergereicht.

**Test scenarios:**
- Config ohne `autoApproveSkills` → Default `false`
- Config mit `autoApproveSkills: true` → Wert wird übernommen
- Config mit `autoApproveSkills: false` → explizit `false`

**Verification:** Config-Tests grün, `npm test`

---

### U2. Session-End Hook: Heuristic + Trigger

**Goal:** Nach Session-Dispose automatisch prüfen, ob Extraktion sinnvoll ist, und asynchron anstoßen.

**Requirements:** R1, R2, R9, R10

**Dependencies:** U1 (Config)

**Files:**
- **Modify:** `server/src/agents/manager.ts` — Hook in `disposeIdle()` und `disposeAll()`
- **Add:** `server/src/skills/auto-extractor.ts` — Neue Klasse `SkillAutoExtractor`

**Approach:**

**`SkillAutoExtractor` Klasse:**
```typescript
class SkillAutoExtractor {
  constructor(
    private extractor: SkillExtractor,
    private registry: SkillRegistry,
    private eventBuffer: EventBuffer,
    private autoApprove: boolean,
  ) {}

  // Prüft ob Session für Extraktion geeignet ist
  private isEligible(sessionId: string, messages: any[]): boolean {
    if (messages.length < 10) return false;            // R2: zu kurz
    if (this.registry.list().some(s =>                 // R10: bereits extrahiert
      s['x-pragents-extraction']?.source_session_id === sessionId
    )) return false;
    return true;
  }

  // Fire-and-forget: Extraktion asynchron starten
  async tryExtract(sessionId: string): Promise<void> { ... }
}
```

**Hook in `disposeIdle()`:**
```typescript
// Nach persistSessionMessages(), vor session.dispose():
if (this.autoExtractor) {
  this.autoExtractor.tryExtract(id).catch(err =>
    logger.warn({ sessionId: id, err }, 'Auto-extraction failed')
  );
}
```

**Async-Queue:** Maximal 1 concurrent Extraction. Neue Requests werden gequeued. Verhindert LLM-Kosten-Explosion bei vielen gleichzeitigen Session-Endes.

**Test scenarios:**
- Session mit < 10 Messages → nicht eligible
- Session bereits extrahiert → nicht eligible  
- Session eligible → `tryExtract()` wird aufgerufen
- `tryExtract()` läuft asynchron, `disposeIdle()` kehrt sofort zurück
- Fehler in `tryExtract()` → wird geloggt, stürzt Server nicht ab

**Verification:** Unit-Tests für `isEligible()`, Mock für Extraktor

---

### U3. PM Monitor: Periodic Session Scan

**Goal:** GoalScheduler's `pmCheck()` scannt periodisch kürzlich beendete Sessions auf Extraktionspotenzial.

**Requirements:** R3

**Dependencies:** U2 (AutoExtractor)

**Files:**
- **Modify:** `server/src/goals/scheduler.ts` — `pmCheck()` erweitern
- **Modify:** `server/src/goals/__tests__/scheduler.test.ts` — Tests

**Approach:**
- `pmCheck()` läuft bereits alle 5 Minuten
- Neue Query: `SELECT id FROM sessions WHERE agent_end IS NOT NULL AND auto_extract_checked = 0 ORDER BY agent_end DESC LIMIT 10`
- Für jede ungeprüfte Session: `autoExtractor.tryExtract(sessionId)`
- Nach Check: `UPDATE sessions SET auto_extract_checked = 1 WHERE id = ?`

**PM-Monitor als Backup-Mechanismus:** Falls der Session-End-Hook (U2) fehlschlägt (z.B. Server-Restart während Dispose), holt der PM-Monitor die Session nach.

**Neues Sessions-Tabellenfeld:** `auto_extract_checked INTEGER DEFAULT 0` (Migration)

**Test scenarios:**
- PM-Monitor findet 3 ungeprüfte Sessions → triggert Extraktion für alle
- Session bereits per Hook extrahiert → PM-Monitor überspringt sie (409-Schutz in tryExtract)
- Keine ungeprüften Sessions → kein Trigger

**Verification:** Unit-Tests mit Mock-DB

---

### U4. Deduplication: Name-Based + Semantic

**Goal:** Verhindert Duplikate bei automatischer Extraktion — erst Name-Check (gratis), dann semantischer LLM-Vergleich.

**Requirements:** R5, R6, R7, R8

**Dependencies:** U2 (AutoExtractor)

**Files:**
- **Modify:** `server/src/skills/auto-extractor.ts` — Deduplizierungslogik

**Approach:**

**Stufe 1 — Name-basiert (gratis):**
```typescript
const existingByName = this.registry.get(extractedSkill.frontmatter.name);
if (existingByName) {
  // Skill existiert bereits → überspringen, Event: skill.deduplicated
  return;
}
```

**Stufe 2 — Semantisch (LLM):**
```typescript
const activeSkills = this.registry.list().filter(s => s['x-pragents-status'] === 'active');
if (activeSkills.length === 0) return; // nichts zu vergleichen

const similar = await this.findSimilarSkill(extractedSkill.body, activeSkills);
if (similar && similar.confidence > 0.8) {
  // Existierenden Skill "bestätigen": Confidence erhöhen
  const updated = { ...similar.skill, 'x-pragents-extraction': { 
    ...similar.skill['x-pragents-extraction'],
    confidence: Math.min(1, (similar.skill['x-pragents-extraction']?.confidence || 0.7) + 0.1)
  }};
  this.registry.save(updated);
  this.eventBuffer.push(..., 'skill.deduplicated', { ... });
  return;
}
```

**LLM-Prompt für semantischen Vergleich:**
```
Compare these two skill descriptions. Do they describe the same repeatable pattern?
Skill A: {bodyA}
Skill B: {bodyB}
Return JSON: {"match": true/false, "confidence": 0.0-1.0}
```

**Optimierung:** Nur gegen aktive Skills vergleichen (nicht proposed/rejected). Bei >20 aktiven Skills: Stichprobe (5 zufällige) oder Embedding-Vorfilter (später).

**Test scenarios:**
- Extraktion produziert Duplikat (gleicher Name) → übersprungen
- Extraktion produziert semantisches Duplikat (anderer Name, gleicher Body) → Confidence erhöht
- Extraktion ist neu → normal gespeichert
- Semantischer Vergleich bei 0 aktiven Skills → übersprungen

**Verification:** Unit-Tests mit Mock-LLM

---

### U5. Event System: New Skill Events

**Goal:** Neue Event-Typen für Auto-Extraction Lifecycle: `skill.auto_proposed`, `skill.auto_approved`, `skill.deduplicated`

**Requirements:** R8

**Dependencies:** U2, U4

**Files:**
- **Modify:** `server/src/skills/auto-extractor.ts` — Events emittieren
- **Modify:** `server/src/api/routes/feed.ts` — Neue Events im Feed anzeigen (optional, kann später)

**Approach:**
- `skill.auto_proposed` — wenn Auto-Extraktion erfolgreich, Skill mit Status `proposed`
- `skill.auto_approved` — wenn `autoApproveSkills: true`, Skill direkt `active`
- `skill.deduplicated` — wenn Duplikat erkannt, existierender Skill bestätigt

**Event-Payload:**
```typescript
{
  name: string,
  sessionId: string,
  confidence: number,
  status: 'proposed' | 'active',
  deduplicatedTo?: string  // nur bei skill.deduplicated
}
```

**Test scenarios:**
- Auto-Extraktion mit `autoApproveSkills: false` → `skill.auto_proposed` Event
- Auto-Extraktion mit `autoApproveSkills: true` → `skill.auto_approved` Event
- Deduplikation → `skill.deduplicated` Event

**Verification:** Unit-Tests prüfen EventBuffer-Aufrufe

---

### U6. SQLite Migration: `auto_extract_checked` Column

**Goal:** Sessions-Tabelle um `auto_extract_checked` Spalte erweitern für PM-Monitor-Tracking.

**Requirements:** R3

**Dependencies:** U3

**Files:**
- **Add:** `server/src/db/migrations/008_auto_extract.sql`
- **Modify:** `server/src/db/sqlite.ts` — `initDb()` um Migration erweitern (wenn nötig)

**Approach:**
```sql
ALTER TABLE sessions ADD COLUMN auto_extract_checked INTEGER NOT NULL DEFAULT 0;
```

**Test scenarios:**
- Neue Spalte existiert nach Migration
- Bestehende Sessions haben Default-Wert 0
- PM-Monitor updated auf 1 nach Check

**Verification:** Migrations-Test

---

### U7. Integration & System Tests

**Goal:** End-to-End-Test des Auto-Extraction-Flows.

**Requirements:** R1-R10

**Dependencies:** U1-U6

**Files:**
- **Add:** `server/src/skills/__tests__/auto-extractor.test.ts`
- **Modify:** `server/src/agents/__tests__/manager.test.ts` — Hook-Tests
- **Modify:** `server/src/goals/__tests__/scheduler.test.ts` — PM-Check-Tests

**Approach:**
- Mock-Session mit 15 Messages → `tryExtract()` wird aufgerufen
- Mock-LLM produziert gültigen Extraktions-JSON
- Skill erscheint in Registry mit Status `proposed` (autoApproveSkills: false)
- Skill erscheint in Registry mit Status `active` (autoApproveSkills: true)
- Zweite Extraktion derselben Session → 409-übersprungen
- Name-Duplikat → übersprungen

**Verification:** `npm test` — alle Tests grün

---

## System-Wide Impact

| Komponente | Änderung | Risiko |
|---|---|---|
| `manager.ts` | Hook in `disposeIdle()`/`disposeAll()` | Niedrig — fire-and-forget |
| `scheduler.ts` | `pmCheck()` erweitert | Niedrig |
| `config/schema.ts` | Neues Feld | Niedrig |
| `skills/auto-extractor.ts` | Neue Klasse | Mittel — Kernlogik |
| `db/migrations/` | Neue Migration | Niedrig |
| `api/routes/feed.ts` | Optionale Event-Anzeige | Niedrig |

---

## Risk Analysis & Mitigation

| Risiko | Impact | Mitigation |
|---|---|---|
| LLM-Kosten durch Auto-Extraktion zu hoch | Mittel | Heuristik filtert >80% Sessions; Async-Queue max 1 concurrent; PM-Monitor als Backup nicht als Primary |
| Falsche Positive (schlechte Skills auto-extracted) | Niedrig | `autoApproveSkills: false` by default → manuelles Approve |
| Dispose-Verzögerung durch synchrone Extraktion | Mittel | Async fire-and-forget — `tryExtract()` blockiert nicht |
| Semantische Dedup zu teuer (LLM-Call pro aktiven Skill) | Mittel | Nur bei >0 aktiven Skills; Stichprobe bei >20 |
