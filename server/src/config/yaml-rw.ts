import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as YAML from 'yaml';
import { suppressWatcherChange } from './loader.js';

/**
 * Round-trip YAML editing helpers used by the config-UI write endpoints.
 *
 * Reads use `YAML.parseDocument` so block comments, key order, anchors, and
 * scalar style are preserved across save. Writes coordinate with the
 * `loader.ts` watcher via `suppressWatcherChange` so a UI-originated save
 * does not get re-interpreted as an external edit (R17 in the config-ui plan).
 *
 * ETags are weak SHA-256 hex over the file contents (full digest, not a
 * truncated prefix — see doc-review SEC-005). The web client treats them as
 * opaque tokens; only the server computes them.
 */

export interface ReadResult {
  /** The parsed `yaml` Document — mutate via `applyMutation` or its own API. */
  doc: YAML.Document.Parsed;
  /** Weak ETag of the on-disk content at the moment of read. */
  etag: string;
  /** Raw file contents at the moment of read (useful for diff-preview). */
  raw: string;
}

export interface WriteOptions {
  /**
   * Pre-write check: if set, must match the file's current ETag or
   * `writeYamlDoc` throws `EtagMismatchError`. Lets callers implement
   * If-Match semantics for conflict detection.
   */
  ifMatch?: string;
  /**
   * Default `true`. When true, the watcher is told to ignore the next change
   * event for this path so the loader does not re-trigger on the UI-originated
   * save.
   */
  suppressWatcher?: boolean;
  /**
   * Suppression window in milliseconds. Default 250ms — long enough to cover
   * fs.watch's delivery, short enough that a real external write moments
   * later still triggers a reload.
   */
  suppressMs?: number;
}

export interface WriteResult {
  etag: string;
}

export class EtagMismatchError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`ETag mismatch for ${path}: expected ${expected}, found ${actual}`);
    this.name = 'EtagMismatchError';
  }
}

function computeEtag(content: string): string {
  const hash = createHash('sha256').update(content, 'utf8').digest('hex');
  return `W/"${hash}"`;
}

export function readYamlDoc(path: string): ReadResult {
  const raw = readFileSync(path, 'utf8');
  const doc = YAML.parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new Error(
      `YAML parse error in ${path}: ${doc.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return { doc, etag: computeEtag(raw), raw };
}

export function writeYamlDoc(
  path: string,
  doc: YAML.Document,
  opts: WriteOptions = {},
): WriteResult {
  if (opts.ifMatch !== undefined) {
    const current = readFileSync(path, 'utf8');
    const currentEtag = computeEtag(current);
    if (currentEtag !== opts.ifMatch) {
      throw new EtagMismatchError(path, opts.ifMatch, currentEtag);
    }
  }
  const serialized = String(doc);
  const shouldSuppress = opts.suppressWatcher !== false;
  if (shouldSuppress) {
    suppressWatcherChange(path, opts.suppressMs ?? 250);
  }
  writeFileSync(path, serialized, 'utf8');
  return { etag: computeEtag(serialized) };
}

export type Mutator = (doc: YAML.Document.Parsed) => void;

/**
 * Apply `mutator` to `doc` in place. Trivial pass-through today; reserved as
 * a seam so we can add validation/normalization hooks later without touching
 * every callsite.
 */
export function applyMutation(doc: YAML.Document.Parsed, mutator: Mutator): YAML.Document.Parsed {
  mutator(doc);
  return doc;
}

/** Re-export so callers can compute ETags from arbitrary content (e.g., raw skill files). */
export { computeEtag };
