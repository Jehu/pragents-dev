import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { PragentsSkillFrontmatter, type PragentsSkillFrontmatterInput } from '@pragents/schema/skill';
import { computeEtag, EtagMismatchError } from '../config/yaml-rw.js';
import { suppressWatcherChange } from '../config/loader.js';
import { assertWithinRoot } from '../security/paths.js';

/**
 * Skill mutation + quarantine read helpers used by Slice 1 of the config-UI
 * (R8/R9/R10/AE4/AE9 in the requirements doc).
 *
 * Why a separate module rather than methods on `SkillRegistry`:
 *  - The existing registry deliberately skips `_quarantine/` so quarantined
 *    skills do not leak into prompt assembly. Adding read+edit hooks for
 *    quarantined entries on the same surface would tempt callers to use
 *    `registry.list()` / `registry.get()` for both populations and silently
 *    re-introduce the leak. Keeping the quarantine surface in this module
 *    makes the boundary explicit.
 *  - The mutation helpers need ETag/If-Match semantics; the registry's
 *    `save()` is fire-and-forget. A separate module avoids retrofitting
 *    HTTP-shaped concerns onto the lower-level store.
 */

export interface SkillOperationsConfig {
  skillsRoot: string;
}

export interface SkillFileResult {
  /** Skill name (== directory name). */
  name: string;
  /** Parsed frontmatter (Zod-validated) */
  frontmatter: ReturnType<typeof PragentsSkillFrontmatter.parse>;
  /** Markdown body (after frontmatter). */
  body: string;
  /** Weak ETag of the on-disk SKILL.md content. */
  etag: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
}

export interface UpdateOptions {
  /** When set, must equal the file's current ETag or `EtagMismatchError` is thrown. */
  ifMatch?: string;
}

export interface UpdateInput {
  frontmatter: PragentsSkillFrontmatterInput;
  body: string;
}

export class SkillNotFoundError extends Error {
  constructor(public readonly name: string, public readonly bucket: 'active' | 'quarantine') {
    super(`Skill "${name}" not found in ${bucket}`);
    this.name = 'SkillNotFoundError';
  }
}

export class SkillOperations {
  constructor(private readonly cfg: SkillOperationsConfig) {}

  // ------- Path resolution -----------------------------------------------

  /** Returns `<skillsRoot>/_quarantine/<name>/SKILL.md` for a quarantined skill. */
  quarantineSkillPath(name: string): string {
    return join(this.cfg.skillsRoot, '_quarantine', this.assertSafeName(name), 'SKILL.md');
  }

  /** Returns `<skillsRoot>/<name>/SKILL.md` for an active skill. */
  activeSkillPath(name: string): string {
    return join(this.cfg.skillsRoot, this.assertSafeName(name), 'SKILL.md');
  }

  /** Reject any name that contains path separators or other unsafe characters. */
  private assertSafeName(name: string): string {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(name)) {
      throw new Error(`Invalid skill name "${name}" — only [a-zA-Z0-9-] is permitted.`);
    }
    return name;
  }

  // ------- Quarantine read API ------------------------------------------

  listQuarantined(): SkillFileResult[] {
    const root = join(this.cfg.skillsRoot, '_quarantine');
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((entry) => {
        try {
          return statSync(join(root, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => this.tryReadQuarantined(name))
      .filter((s): s is SkillFileResult => s !== null);
  }

  private tryReadQuarantined(name: string): SkillFileResult | null {
    try {
      return this.getQuarantined(name);
    } catch {
      return null;
    }
  }

  getQuarantined(name: string): SkillFileResult {
    const path = this.quarantineSkillPath(name);
    if (!existsSync(path)) {
      throw new SkillNotFoundError(name, 'quarantine');
    }
    return this.readSkillFile(name, path);
  }

  // ------- Active read API ----------------------------------------------

  getActive(name: string): SkillFileResult {
    const path = this.activeSkillPath(name);
    if (!existsSync(path)) {
      throw new SkillNotFoundError(name, 'active');
    }
    return this.readSkillFile(name, path);
  }

  // ------- Mutation API -------------------------------------------------

  /** Update an active or quarantined skill's frontmatter+body. Honors If-Match. */
  updateSkill(
    name: string,
    bucket: 'active' | 'quarantine',
    input: UpdateInput,
    opts: UpdateOptions = {},
  ): SkillFileResult {
    const path =
      bucket === 'active' ? this.activeSkillPath(name) : this.quarantineSkillPath(name);
    if (!existsSync(path)) throw new SkillNotFoundError(name, bucket);

    if (opts.ifMatch !== undefined) {
      const currentEtag = computeEtag(readFileSync(path, 'utf8'));
      if (currentEtag !== opts.ifMatch) {
        throw new EtagMismatchError(path, opts.ifMatch, currentEtag);
      }
    }

    const validated = PragentsSkillFrontmatter.parse(input.frontmatter);
    if (validated.name !== name) {
      throw new Error(
        `Refusing to rename skill via update — frontmatter name "${validated.name}" does not match path name "${name}".`,
      );
    }
    const fileContent = matter.stringify(input.body ?? '', stripEmpty(validated));
    suppressWatcherChange(path);
    writeFileSync(path, fileContent, 'utf8');
    return this.readSkillFile(name, path);
  }

  /**
   * Approve a quarantined skill: move directory to active root + flip status.
   * The move uses the existing registry helper for compatibility; this method
   * is the HTTP-shaped wrapper that adds ETag handling.
   */
  approveQuarantined(
    name: string,
    promote: (skillName: string) => string | null,
    opts: UpdateOptions = {},
  ): SkillFileResult {
    const sourcePath = this.quarantineSkillPath(name);
    if (!existsSync(sourcePath)) throw new SkillNotFoundError(name, 'quarantine');

    if (opts.ifMatch !== undefined) {
      const currentEtag = computeEtag(readFileSync(sourcePath, 'utf8'));
      if (currentEtag !== opts.ifMatch) {
        throw new EtagMismatchError(sourcePath, opts.ifMatch, currentEtag);
      }
    }

    const destDir = promote(name);
    if (!destDir) {
      throw new SkillNotFoundError(name, 'quarantine');
    }
    const activePath = this.activeSkillPath(name);
    const result = this.readSkillFile(name, activePath);
    // Flip status to `active` and persist back through the same write path so
    // the change goes through suppressWatcherChange.
    const updated = this.updateSkill(
      name,
      'active',
      {
        frontmatter: { ...result.frontmatter, 'x-pragents-status': 'active' },
        body: result.body,
      },
    );
    return updated;
  }

  /** Set status=rejected on a quarantined skill (file stays for downstream demotion logic). */
  rejectQuarantined(name: string, opts: UpdateOptions = {}): SkillFileResult {
    const result = this.getQuarantined(name);
    return this.updateSkill(
      name,
      'quarantine',
      {
        frontmatter: { ...result.frontmatter, 'x-pragents-status': 'rejected' },
        body: result.body,
      },
      opts,
    );
  }

  // ------- Internals ----------------------------------------------------

  private readSkillFile(name: string, path: string): SkillFileResult {
    // Belt-and-braces: the path was built from the validated `name`, but
    // assert it is still inside the skills root in case the root contains
    // symlinks or the caller passes a precomputed path elsewhere.
    assertWithinRoot(path, this.cfg.skillsRoot, { followSymlinks: true });
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    const frontmatter = PragentsSkillFrontmatter.parse({
      ...(parsed.data as Record<string, unknown>),
      // gray-matter sometimes drops `name` if absent; the directory is the source of truth.
      name: (parsed.data as Record<string, unknown>).name ?? name,
    });
    return {
      name,
      frontmatter,
      body: parsed.content,
      etag: computeEtag(raw),
      path,
    };
  }
}

function stripEmpty(
  frontmatter: ReturnType<typeof PragentsSkillFrontmatter.parse>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
