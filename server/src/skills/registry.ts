import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SkillDef, type SkillDef as SkillDefType } from './schema.js';

export class SkillRegistry {
  private skillsDir: string;
  private skills: Map<string, SkillDefType> = new Map();

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    mkdirSync(skillsDir, { recursive: true });
  }

  /**
   * Load skill YAML files from the skills directory.
   */
  load(): { loaded: string[]; warnings: string[] } {
    const loaded: string[] = [];
    const warnings: string[] = [];

    try {
      const files = readdirSync(this.skillsDir).filter(
        (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
      );
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.skillsDir, file), 'utf-8');
          const parsed = parseYaml(raw);
          const def = SkillDef.parse(parsed);
          this.skills.set(def.name, def);
          loaded.push(def.name);
        } catch (err: any) {
          warnings.push(`${file}: ${err.message}`);
        }
      }
    } catch {
      warnings.push(`Skills directory "${this.skillsDir}" not accessible`);
    }

    return { loaded, warnings };
  }

  /**
   * Save a skill to both the in-memory map and as a YAML file.
   */
  save(skill: SkillDefType): void {
    // Validate
    const validated = SkillDef.parse(skill);
    this.skills.set(validated.name, validated);

    // Persist as YAML
    const filename = validated.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '.yaml';
    const filePath = join(this.skillsDir, filename);
    writeFileSync(filePath, stringifyYaml(validated), 'utf-8');

    // Also persist to DB for query support
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      `INSERT OR REPLACE INTO skills (id, name, description, source_session, source_agent, tags, steps_yaml,
       parameters_yaml, tools, examples_yaml, scope, status, version, extraction_metadata_yaml)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      validated.name,
      validated.description || null,
      validated.source_session || null,
      validated.source_agent || null,
      JSON.stringify(validated.tags || []),
      stringifyYaml(validated.steps),
      validated.parameters ? stringifyYaml(validated.parameters) : null,
      validated.tools ? JSON.stringify(validated.tools) : null,
      validated.examples ? stringifyYaml(validated.examples) : null,
      validated.scope || 'project',
      validated.status || 'draft',
      validated.version || 1,
      validated.extraction_metadata ? JSON.stringify(validated.extraction_metadata) : null,
    );
  }

  /**
   * Delete a skill by name.
   */
  delete(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    this.skills.delete(name);

    // Remove YAML file
    const filename = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '.yaml';
    try {
      unlinkSync(join(this.skillsDir, filename));
    } catch {}

    // Remove from DB
    const db = getDb();
    db.prepare('DELETE FROM skills WHERE name = ?').run(name);

    return true;
  }

  get(name: string): SkillDefType | undefined {
    return this.skills.get(name);
  }

  list(): SkillDefType[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find skills matching given tags.
   */
  findByTags(tags: string[]): SkillDefType[] {
    return this.list().filter((s) =>
      tags.some((t) => s.tags?.includes(t)),
    );
  }
}
