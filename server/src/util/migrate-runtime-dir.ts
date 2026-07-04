import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One-shot migration of YAML files from a legacy in-repo runtime directory
 * (e.g. `<repo>/goals/`) into its `~/.pragents/<name>/` home.
 *
 * Goals and repo-level workflows used to live INSIDE the source repository,
 * so UI CRUD operations mutated the git working tree (a goal deleted through
 * the web UI showed up as a `git status` deletion). Runtime state belongs
 * under `~/.pragents/` — see the "Runtime layout" section of CLAUDE.md.
 *
 * Semantics:
 *  - Copies only when the target contains no YAML yet — an already-populated
 *    target wins unconditionally (the migration ran before, or the user
 *    started fresh). Files are copied, not moved: the legacy dir stays
 *    untouched so a checkout of an older server version keeps working.
 *  - Only `.yaml` / `.yml` files are considered; anything else is ignored.
 *  - Never throws: filesystem errors skip the affected file. Returns the
 *    migrated filenames so the caller can log them.
 */
export function migrateLegacyRuntimeDir(legacyDir: string, targetDir: string): string[] {
  let legacyFiles: string[];
  try {
    legacyFiles = readdirSync(legacyDir).filter((f) => /\.ya?ml$/i.test(f));
  } catch {
    return []; // legacy dir missing — nothing to migrate
  }
  if (legacyFiles.length === 0) return [];

  try {
    mkdirSync(targetDir, { recursive: true });
    const targetFiles = readdirSync(targetDir).filter((f) => /\.ya?ml$/i.test(f));
    if (targetFiles.length > 0) return []; // target already populated — its state wins
  } catch {
    return [];
  }

  const migrated: string[] = [];
  for (const file of legacyFiles) {
    try {
      if (!existsSync(join(targetDir, file))) {
        copyFileSync(join(legacyDir, file), join(targetDir, file));
        migrated.push(file);
      }
    } catch {
      // Skip unreadable file — best-effort migration
    }
  }
  return migrated;
}
