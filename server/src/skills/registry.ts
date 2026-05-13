import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import { pino } from 'pino';
import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  readdirSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { PragentsSkillFrontmatter, type PragentsSkillFrontmatter as SkillFM, type PragentsSkillFrontmatterInput } from './schema.js';

const logger = pino({ name: 'skill-registry' });

/** Default number of rejections before a skill is demoted back to `proposed`. */
const DEFAULT_REJECT_THRESHOLD = 3;

export class SkillRegistry {
  private skillsDir: string;
  private skills: Map<string, SkillFM> = new Map();
  private skillBodies: Map<string, string> = new Map();
  /** Tracks cumulative rejection count per skill name (in-memory mirror of DB). */
  private rejectCounts: Map<string, number> = new Map();

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    mkdirSync(skillsDir, { recursive: true });
  }

  /**
   * Load skills from SKILL.md files in subdirectories (agentskills.io format).
   * Recursively scans skillsDir. A subdirectory containing SKILL.md is a skill root.
   */
  load(): { loaded: string[]; warnings: string[] } {
    const loaded: string[] = [];
    const warnings: string[] = [];
    this.skills.clear();
    this.skillBodies.clear();
    this.rejectCounts.clear();

    try {
      const entries = readdirSync(this.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (entry.name === '_quarantine') continue; // never load quarantined skills

        const skillMdPath = join(this.skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;

        try {
          const raw = matter.read(skillMdPath);
          const frontmatter = raw.data;
          const body = raw.content || '';

          // Validate with Zod
          const parsed = PragentsSkillFrontmatter.safeParse(frontmatter);
          if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
            warnings.push(`${entry.name}: ${issues.join('; ')}`);
            continue;
          }

          this.skills.set(parsed.data.name, parsed.data);
          this.skillBodies.set(parsed.data.name, body);
          loaded.push(parsed.data.name);

          // Load reject_count from DB if available
          try {
            const db = getDb();
            const row = db.prepare('SELECT reject_count FROM skills WHERE name = ?').get(parsed.data.name) as { reject_count: number } | undefined;
            if (row) {
              this.rejectCounts.set(parsed.data.name, row.reject_count ?? 0);
            }
          } catch {
            // DB not initialized — ignore
          }
        } catch (err: any) {
          warnings.push(`${entry.name}: ${err.message}`);
        }
      }
    } catch (err: any) {
      warnings.push(`Skills directory "${this.skillsDir}" not accessible: ${err.message}`);
    }

    return { loaded, warnings };
  }

  /**
   * Save a skill as SKILL.md in a subdirectory.
   * @param skill The frontmatter (must include at least name and description).
   * @param body Optional markdown body content.
   */
  save(skill: PragentsSkillFrontmatterInput, body?: string): void {
    // Validate
    const validated = PragentsSkillFrontmatter.parse(skill);

    // Create skill subdirectory
    const dirName = validated.name;
    const skillDir = join(this.skillsDir, dirName);
    mkdirSync(skillDir, { recursive: true });

    // Build frontmatter for gray-matter (exclude undefined values and 'body' key)
    const frontmatterObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated)) {
      if (key === 'body') continue; // body is markdown content, not frontmatter
      if (value !== undefined && value !== null) {
        // Skip empty arrays/objects
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue;
        frontmatterObj[key] = value;
      }
    }

    // Preserve existing body if not provided (partial update like approve/reject)
    const existingBody = this.skillBodies.get(validated.name);
    const mdBody = body !== undefined ? body : (existingBody || '');
    const fileContent = matter.stringify(mdBody, frontmatterObj);
    writeFileSync(join(skillDir, 'SKILL.md'), fileContent, 'utf-8');

    // Update in-memory
    this.skills.set(validated.name, validated);
    this.skillBodies.set(validated.name, mdBody);

    // Persist to SQLite for query support (gracefully skip if DB not initialized)
    try {
      const db = getDb();
      const id = randomUUID();
      const rejectCount = this.rejectCounts.get(validated.name) ?? 0;
      db.prepare(
        `INSERT OR REPLACE INTO skills (id, name, description, source_session, source_agent, tags, steps_yaml,
         parameters_yaml, tools, examples_yaml, scope, status, version, extraction_metadata_yaml, reject_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        validated.name,
        validated.description || null,
        validated['x-pragents-extraction']?.source_session_id || null,
        validated['x-pragents-extraction']?.source_agent_id || null,
        JSON.stringify(validated['x-pragents-tags'] || []),
        '[]', // steps are now in markdown body
        validated['x-pragents-parameters']
          ? stringifyYaml(validated['x-pragents-parameters'])
          : null,
        validated['allowed-tools'] || null,
        validated['x-pragents-examples']
          ? stringifyYaml(validated['x-pragents-examples'])
          : null,
        validated['x-pragents-scope'] || 'project',
        validated['x-pragents-status'] || 'draft',
        validated['x-pragents-version'] || 1,
        validated['x-pragents-extraction']
          ? JSON.stringify(validated['x-pragents-extraction'])
          : null,
        rejectCount,
      );
    } catch {
      // DB not initialized (e.g., tests) — SQLite persistence is optional
    }
  }

  /**
   * Save an auto-extracted skill to the quarantine directory.
   * Skills in quarantine are NOT loaded into system prompts and require
   * manual review before activation. This prevents prompt injection via
   * workflow-generated skill content.
   *
   * @param skill The frontmatter (must include at least name and description).
   * @param body Optional markdown body content.
   * @returns The path to the quarantined skill directory.
   */
  saveToQuarantine(skill: PragentsSkillFrontmatterInput, body?: string): string {
    const validated = PragentsSkillFrontmatter.parse(skill);

    const quarantineDir = join(this.skillsDir, '_quarantine', validated.name);
    mkdirSync(quarantineDir, { recursive: true });

    const frontmatterObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated)) {
      if (key === 'body') continue;
      if (value !== undefined && value !== null) {
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue;
        frontmatterObj[key] = value;
      }
    }

    const mdBody = body ?? '';
    const fileContent = matter.stringify(mdBody, frontmatterObj);
    const skillMdPath = join(quarantineDir, 'SKILL.md');
    writeFileSync(skillMdPath, fileContent, 'utf-8');

    return quarantineDir;
  }

  /**
   * Delete a skill by name.
   */
  delete(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    this.skills.delete(name);
    this.skillBodies.delete(name);
    this.rejectCounts.delete(name);

    // Remove skill subdirectory (with path traversal protection)
    const skillDir = join(this.skillsDir, name);
    const resolvedSkillsDir = resolve(this.skillsDir);
    if (!resolve(skillDir).startsWith(resolvedSkillsDir + '/') && resolve(skillDir) !== resolvedSkillsDir) {
      // Path traversal attempted — skip file deletion but still remove from memory
      return true;
    }
    try {
      rmSync(skillDir, { recursive: true, force: true });
    } catch {}

    // Remove from SQLite (gracefully skip if DB not initialized)
    try {
      const db = getDb();
      db.prepare('DELETE FROM skills WHERE name = ?').run(name);
    } catch {}

    return true;
  }

  /**
   * Increment the rejection counter for a skill.
   * If the count reaches `threshold` (default 3), the skill is demoted back to
   * `proposed` so it can be re-reviewed. Works on any status, including `active`.
   *
   * @param name Skill name.
   * @param threshold Demotion threshold (default 3).
   * @returns The updated reject count and whether demotion occurred.
   */
  rejectSkill(
    name: string,
    threshold: number = DEFAULT_REJECT_THRESHOLD,
  ): { rejectCount: number; demoted: boolean } | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    const prev = this.rejectCounts.get(name) ?? 0;
    const rejectCount = prev + 1;
    this.rejectCounts.set(name, rejectCount);

    const demoted = rejectCount >= threshold;
    const newStatus = demoted ? 'proposed' : skill['x-pragents-status'];

    if (demoted) {
      logger.warn(
        { skillName: name, rejectCount },
        'Skill demoted to proposed after repeated rejections',
      );
    }

    const updated: SkillFM = { ...skill, 'x-pragents-status': newStatus };
    this.skills.set(name, updated);

    // Persist updated status and reject_count to file
    this.save(updated);

    // Update reject_count directly in DB (save() uses current rejectCounts map, already updated)
    try {
      const db = getDb();
      db.prepare(
        `UPDATE skills SET reject_count = ?, last_rejected_at = datetime('now'), status = ? WHERE name = ?`,
      ).run(rejectCount, newStatus ?? 'draft', name);
    } catch {
      // DB not initialized — ignore
    }

    return { rejectCount, demoted };
  }

  /**
   * Return the current rejection count for a skill (0 if unknown).
   */
  getRejectCount(name: string): number {
    return this.rejectCounts.get(name) ?? 0;
  }

  get(name: string): SkillFM | undefined {
    return this.skills.get(name);
  }

  /**
   * Get the markdown body for a skill.
   */
  getBody(name: string): string | undefined {
    return this.skillBodies.get(name);
  }

  /**
   * Get both frontmatter and body for a skill.
   */
  getFullSkill(name: string): { frontmatter: SkillFM; body: string } | undefined {
    const frontmatter = this.skills.get(name);
    if (!frontmatter) return undefined;
    return { frontmatter, body: this.skillBodies.get(name) || '' };
  }

  list(): SkillFM[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find skills matching given tags (searches x-pragents-tags).
   */
  findByTags(tags: string[]): SkillFM[] {
    return this.list().filter((s) =>
      tags.some((t) => s['x-pragents-tags']?.includes(t)),
    );
  }
}
