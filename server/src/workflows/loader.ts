import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { WorkflowDef, type WorkflowDef as WorkflowDefType } from './schema.js';

/**
 * Each entry tracks the workflow definition plus the origin (project or
 * repo-global). `projectId` is `null` for files loaded from the repo-level
 * `<repo>/workflows/` directory; otherwise it carries the project's id so
 * the API can link a workflow card to its editor.
 */
export interface WorkflowRegistryEntry {
  def: WorkflowDefType;
  projectId: string | null;
}

export class WorkflowRegistry {
  // Map name → entry. Workflow names are treated as globally unique; a
  // collision logs a warning and the later load wins. The compound API
  // shape (`{ name, projectId }`) keeps the door open for changing this
  // policy later without touching the frontend.
  private workflows: Map<string, WorkflowRegistryEntry> = new Map();

  /**
   * Load a single workflow root. Pass `projectId: null` for the repo-global
   * directory; pass a project id when loading per-project workflow files.
   * Calling `load` multiple times accumulates entries; use
   * `unloadProject(projectId)` to clear a project's entries before reloading.
   */
  load(
    workflowDir: string,
    projectId: string | null = null,
  ): { loaded: string[]; warnings: string[] } {
    const loaded: string[] = [];
    const warnings: string[] = [];

    try {
      const files = readdirSync(workflowDir).filter(
        (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
      );
      for (const file of files) {
        try {
          const raw = readFileSync(join(workflowDir, file), 'utf-8');
          const parsed = parseYaml(raw);
          const def = WorkflowDef.parse(parsed);
          const existing = this.workflows.get(def.name);
          if (existing && existing.projectId !== projectId) {
            warnings.push(
              `Workflow name "${def.name}" already loaded from ${
                existing.projectId === null
                  ? 'repo'
                  : `project "${existing.projectId}"`
              }; overwriting with version from ${
                projectId === null ? 'repo' : `project "${projectId}"`
              }`,
            );
          }
          this.workflows.set(def.name, { def, projectId });
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

  /** Drop every entry owned by the given project. Used before reloads. */
  unloadProject(projectId: string): void {
    for (const [name, entry] of this.workflows.entries()) {
      if (entry.projectId === projectId) {
        this.workflows.delete(name);
      }
    }
  }

  /** Drop every entry owned by the repo (projectId === null). */
  unloadRepo(): void {
    for (const [name, entry] of this.workflows.entries()) {
      if (entry.projectId === null) {
        this.workflows.delete(name);
      }
    }
  }

  get(name: string): WorkflowDefType | undefined {
    return this.workflows.get(name)?.def;
  }

  list(): WorkflowDefType[] {
    return Array.from(this.workflows.values(), (entry) => entry.def);
  }

  /** Like `list` but each item carries its projectId tag. */
  listEntries(): WorkflowRegistryEntry[] {
    return Array.from(this.workflows.values());
  }
}
