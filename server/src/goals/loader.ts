import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GoalDef, type GoalDef as GoalDefType } from './schema.js';

interface GoalEntry {
  def: GoalDefType;
  /** Source filename (basename) inside the goals dir — CRUD writes go here. */
  file: string;
}

export class GoalRegistry {
  private goals: Map<string, GoalEntry> = new Map();

  load(goalsDir: string): { loaded: string[]; warnings: string[] } {
    const loaded: string[] = [];
    const warnings: string[] = [];
    const nextGoals: Map<string, GoalEntry> = new Map();
    try {
      const files = readdirSync(goalsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(goalsDir, file), 'utf-8');
          const def = GoalDef.parse(parseYaml(raw));
          const existing = nextGoals.get(def.id);
          if (existing) {
            warnings.push(`${file}: duplicate goal id "${def.id}" (already defined in ${existing.file}) — keeping the first`);
            continue;
          }
          nextGoals.set(def.id, { def, file });
          loaded.push(def.id);
        } catch (err: any) { warnings.push(`${file}: ${err.message}`); }
      }
    } catch { warnings.push(`Goals directory not accessible: ${goalsDir}`); }
    this.goals = nextGoals;
    return { loaded, warnings };
  }

  list(): GoalDefType[] { return Array.from(this.goals.values(), (e) => e.def); }
  get(id: string): GoalDefType | undefined { return this.goals.get(id)?.def; }
  /** Source filename (basename) for a goal — undefined when the id is unknown. */
  getFile(id: string): string | undefined { return this.goals.get(id)?.file; }
}
