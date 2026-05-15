import { Hono } from 'hono';
import { statSync, readFileSync } from 'node:fs';
import { computeEtag } from '../../config/yaml-rw.js';
import { assertWithinAnyRoot, PathOutOfBoundsError } from '../../security/paths.js';

/**
 * GET/HEAD /api/v1/files/meta?path=<relative-or-absolute>
 *
 * Returns mtime + ETag for files inside the configured allow-list (pragents
 * config path, skills root, and project workflow roots). Used by the
 * config-ui web client to drive conflict detection (R12 / R18) without
 * pulling the file content.
 *
 * `path` is resolved via `assertWithinAnyRoot` with `followSymlinks: true`,
 * so URL-encoded traversal, double-encoded traversal, and symlink escapes
 * are rejected with 400 (we deliberately avoid 403 because the response
 * code would leak existence/permission info to the client).
 */
export interface FilesRouteOptions {
  /** Absolute allow-list roots; any file under one of these is readable. */
  allowedRoots: readonly string[];
}

export function createFilesRoute(opts: FilesRouteOptions) {
  const router = new Hono();

  function resolveOr400(rawPath: string | null) {
    if (!rawPath) {
      return { status: 400 as const, error: '`path` query parameter is required' };
    }
    try {
      const resolved = assertWithinAnyRoot(rawPath, opts.allowedRoots, {
        followSymlinks: true,
      });
      return { status: 200 as const, resolved };
    } catch (err) {
      if (err instanceof PathOutOfBoundsError) {
        return { status: 400 as const, error: 'Path is not within any allowed root' };
      }
      throw err;
    }
  }

  router.get('/meta', (c) => {
    const result = resolveOr400(c.req.query('path'));
    if (result.status === 400) return c.json({ error: result.error }, 400);
    try {
      const stat = statSync(result.resolved);
      const content = readFileSync(result.resolved, 'utf8');
      const etag = computeEtag(content);
      c.header('ETag', etag);
      return c.json({ mtime: stat.mtimeMs, etag });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT')) return c.json({ error: 'File not found' }, 404);
      return c.json({ error: message }, 500);
    }
  });

  router.on(['HEAD'], '/meta', (c) => {
    const result = resolveOr400(c.req.query('path'));
    if (result.status === 400) return c.body(null, 400);
    try {
      const content = readFileSync(result.resolved, 'utf8');
      const etag = computeEtag(content);
      c.header('ETag', etag);
      return c.body(null, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT')) return c.body(null, 404);
      return c.body(null, 500);
    }
  });

  return router;
}
