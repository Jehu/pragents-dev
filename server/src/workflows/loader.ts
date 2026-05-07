import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { WorkflowDef, type WorkflowDef as WorkflowDefType } from './schema.js';

export class WorkflowRegistry {
  private workflows: Map<string, WorkflowDefType> = new Map();

  load(workflowDir: string): { loaded: string[]; warnings: string[] } {
    const loaded: string[] = [];
    const warnings: string[] = [];

    try {
      const files = readdirSync(workflowDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(workflowDir, file), 'utf-8');
          const parsed = parseYaml(raw);
          const def = WorkflowDef.parse(parsed);
          this.workflows.set(def.name, def);
          loaded.push(def.name);
        } catch (err: any) {
          warnings.push(`${file}: ${err.message}`);
        }
      }
    } catch {
      warnings.push(`Workflow directory "${workflowDir}" not accessible`);
    }

    return { loaded, warnings };
  }

  get(name: string): WorkflowDefType | undefined {
    return this.workflows.get(name);
  }

  list(): WorkflowDefType[] {
    return Array.from(this.workflows.values());
  }

  get names(): string[] {
    return Array.from(this.workflows.keys());
  }
}
