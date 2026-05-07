import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GoalDef, type GoalDef as GoalDefType } from './schema.js';

export class GoalRegistry {
  private goals: Map<string, GoalDefType> = new Map();

  load(goalsDir: string): { loaded: string[]; warnings: string[] } {
    const loaded: string[] = [];
    const warnings: string[] = [];
    try {
      const files = readdirSync(goalsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(goalsDir, file), 'utf-8');
          const def = GoalDef.parse(parseYaml(raw));
          this.goals.set(def.id, def);
          loaded.push(def.id);
        } catch (err: any) { warnings.push(`${file}: ${err.message}`); }
      }
    } catch { warnings.push(`Goals directory not accessible: ${goalsDir}`); }
    return { loaded, warnings };
  }

  list(): GoalDefType[] { return Array.from(this.goals.values()); }
  get(id: string): GoalDefType | undefined { return this.goals.get(id); }
}
