import { realpathSync } from 'node:fs';
import { dirname, resolve, sep, basename } from 'node:path';

/**
 * Path canonicalization + allow-list helper used by every config-ui
 * endpoint that accepts a caller-supplied path or :name route parameter
 * (R18-implied + doc-review SEC-001/002/003).
 *
 * The helper:
 *  1. URL-decodes the input once (twice if double-encoding is detected)
 *  2. Resolves the result against `rootDir` to an absolute path
 *  3. Optionally follows symlinks (`followSymlinks: true`) so escapes via
 *     symlink chains are caught
 *  4. Asserts the canonical path starts with `rootDir + sep`
 *
 * Any failure throws `PathOutOfBoundsError`, which the route handler turns
 * into a 400 (we deliberately avoid 403 because that leaks existence info).
 */
export class PathOutOfBoundsError extends Error {
  constructor(
    public readonly input: string,
    public readonly resolvedPath: string,
    public readonly rootDir: string,
  ) {
    super(
      `Path "${input}" resolves to "${resolvedPath}", which is outside of "${rootDir}".`,
    );
    this.name = 'PathOutOfBoundsError';
  }
}

export interface AssertWithinRootOptions {
  /** When true (default false), `realpathSync` is used so symlinks are also bounded. */
  followSymlinks?: boolean;
  /** When true (default true), the input is URL-decoded — at most twice — before resolution. */
  decodeUrl?: boolean;
}

function maybeDecode(input: string, decodeUrl: boolean): string {
  if (!decodeUrl) return input;
  let value = input;
  for (let i = 0; i < 2; i++) {
    let next: string;
    try {
      next = decodeURIComponent(value);
    } catch {
      // Stop at the first decode failure — input was not valid percent-encoding.
      return value;
    }
    if (next === value) return value;
    value = next;
  }
  return value;
}

/**
 * Assert that `input` resolves to a path inside `rootDir`.
 *
 * Returns the canonical absolute path on success; throws
 * `PathOutOfBoundsError` otherwise.
 */
export function assertWithinRoot(
  input: string,
  rootDir: string,
  opts: AssertWithinRootOptions = {},
): string {
  const { followSymlinks = false, decodeUrl = true } = opts;
  const decoded = maybeDecode(input, decodeUrl);
  let root = resolve(rootDir);
  // On macOS the temp dir is reachable via both /var/... and /private/var/...
  // Canonicalize the root the same way we canonicalize the candidate so a
  // legitimately-inside path is not rejected because of the symlink prefix.
  if (followSymlinks) {
    try {
      root = realpathSync(root);
    } catch {
      // Root does not exist yet — leave it as the lexical resolution.
    }
  }
  const candidate = resolve(root, decoded);

  let canonical = candidate;
  if (followSymlinks) {
    try {
      canonical = realpathSync(candidate);
    } catch {
      // realpath fails on non-existent paths. Walk up the candidate's parent
      // chain until we find an existing directory we can canonicalize, then
      // re-attach the missing leaf segments. This keeps the prefix-check
      // sound even when the target file does not exist yet.
      const segments: string[] = [];
      let probe = candidate;
      let parentReal: string | null = null;
      while (probe !== dirname(probe)) {
        try {
          parentReal = realpathSync(probe);
          break;
        } catch {
          segments.unshift(basename(probe));
          probe = dirname(probe);
        }
      }
      canonical = parentReal ? resolve(parentReal, ...segments) : candidate;
    }
  }

  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  const canonicalWithSep = canonical + sep;
  if (canonical !== root && !canonicalWithSep.startsWith(rootWithSep)) {
    throw new PathOutOfBoundsError(input, canonical, root);
  }

  return canonical;
}

/**
 * Convenience helper for endpoints that maintain an ordered list of acceptable
 * roots (e.g., `pragents.yaml` is allowed alone, plus everything under the
 * skills root or a project's workflow root). Returns the canonical path on
 * the first matching root, throws otherwise.
 */
export function assertWithinAnyRoot(
  input: string,
  roots: readonly string[],
  opts?: AssertWithinRootOptions,
): string {
  let lastError: PathOutOfBoundsError | null = null;
  for (const root of roots) {
    try {
      return assertWithinRoot(input, root, opts);
    } catch (err) {
      if (err instanceof PathOutOfBoundsError) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  // All roots rejected — re-throw the last error for diagnostic value.
  throw (
    lastError ??
    new PathOutOfBoundsError(input, resolve(input), roots[0] ?? '/')
  );
}
