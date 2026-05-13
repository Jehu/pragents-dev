import type { Context, MiddlewareHandler } from 'hono';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { logger } from '../../logging/index.js';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Reads PRAGENTS_API_TOKEN from the environment. If missing, generates a new
 * 32-byte hex token, appends it to the env file (creating the line, preserving
 * existing contents), exports it into process.env, and logs it prominently so
 * the operator can copy it into their client config.
 *
 * Always returns the active token.
 */
export function getOrCreateApiToken(envPath: string): string {
  const existing = process.env.PRAGENTS_API_TOKEN?.trim();
  if (existing) return existing;

  const token = randomBytes(32).toString('hex');
  process.env.PRAGENTS_API_TOKEN = token;

  try {
    let prefix = '';
    if (existsSync(envPath)) {
      const current = readFileSync(envPath, 'utf-8');
      // Ensure newline separation
      if (current.length > 0 && !current.endsWith('\n')) prefix = '\n';
    }
    const line = `${prefix}PRAGENTS_API_TOKEN=${token}\n`;
    appendFileSync(envPath, line, { encoding: 'utf-8' });
    logger.warn(
      { token, envPath },
      'Generated new PRAGENTS_API_TOKEN — copy this into your client config',
    );
  } catch (err: any) {
    logger.warn(
      { err: err?.message, envPath },
      'Could not persist PRAGENTS_API_TOKEN to env file; token will not survive restart',
    );
  }

  return token;
}

/**
 * Best-effort detection of a localhost-originated request. We trust either:
 *   - the Node socket remoteAddress (most reliable when available)
 *   - the Host header (used as a fallback for environments that don't expose
 *     the socket, e.g. Hono testing harness)
 */
function isLocalhostRequest(c: Context): boolean {
  // 1) Node socket remoteAddress — most reliable signal
  const remote =
    (c.env as any)?.incoming?.socket?.remoteAddress ??
    (c.env as any)?.incoming?.connection?.remoteAddress ??
    (c.req.raw as any)?.socket?.remoteAddress;

  if (typeof remote === 'string') {
    const normalized = remote.replace(/^::ffff:/, '');
    if (LOCALHOST_HOSTS.has(normalized)) return true;
  }

  // 2) Host header fallback (e.g. "localhost:3737" or "127.0.0.1")
  const host = c.req.header('host');
  if (host) {
    const hostname = host.split(':')[0].toLowerCase();
    if (LOCALHOST_HOSTS.has(hostname)) return true;
  }

  // 3) URL hostname fallback (covers Hono's test harness where the Host
  //    header is not synthesized from the URL)
  try {
    const url = new URL(c.req.url);
    const hostname = url.hostname.toLowerCase();
    if (LOCALHOST_HOSTS.has(hostname)) return true;
  } catch {
    // ignore malformed url
  }

  return false;
}

function unauthorized(c: Context) {
  return c.json(
    {
      error: 'Unauthorized',
      hint: 'set PRAGENTS_API_TOKEN env or use Authorization: Bearer header',
    },
    401,
  );
}

/**
 * Hono middleware enforcing API token auth.
 *
 * Pass-through conditions (any one is sufficient):
 *   - request originates from localhost (127.0.0.1 / ::1 / localhost host)
 *   - `Authorization: Bearer <token>` header matches the active token
 *   - `?token=<token>` query parameter matches the active token
 *
 * If the active token is empty/unset, the middleware degrades to localhost-only
 * access (any non-localhost request is rejected).
 */
export function authMiddleware(getToken: () => string): MiddlewareHandler {
  return async (c, next) => {
    if (isLocalhostRequest(c)) {
      return next();
    }

    const expected = getToken();
    if (!expected) {
      return unauthorized(c);
    }

    const header = c.req.header('authorization') || c.req.header('Authorization');
    if (header) {
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
      if (match && match[1].trim() === expected) {
        return next();
      }
    }

    const queryToken = c.req.query('token');
    if (queryToken && queryToken === expected) {
      return next();
    }

    return unauthorized(c);
  };
}

/**
 * Helper exposed for the WebSocket upgrade path: extract a token from a
 * raw Node IncomingMessage-style request (url + headers + socket).
 *
 * Returns one of:
 *   - { ok: true, reason: 'localhost' | 'header' | 'query' }
 *   - { ok: false }
 */
export function checkWsAuth(
  req: { url?: string; headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
  expected: string,
): { ok: true; reason: 'localhost' | 'header' | 'query' } | { ok: false } {
  // Localhost bypass
  const remote = req.socket?.remoteAddress;
  if (typeof remote === 'string') {
    const normalized = remote.replace(/^::ffff:/, '');
    if (LOCALHOST_HOSTS.has(normalized)) return { ok: true, reason: 'localhost' };
  }
  const host = (req.headers?.host as string | undefined)?.split(':')[0]?.toLowerCase();
  if (host && LOCALHOST_HOSTS.has(host)) return { ok: true, reason: 'localhost' };

  if (!expected) return { ok: false };

  // Authorization header
  const authHeader = req.headers?.authorization ?? req.headers?.Authorization;
  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof authValue === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authValue.trim());
    if (match && match[1].trim() === expected) return { ok: true, reason: 'header' };
  }

  // Query token
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const t = parsed.searchParams.get('token');
      if (t && t === expected) return { ok: true, reason: 'query' };
    } catch {
      // ignore malformed url
    }
  }

  return { ok: false };
}
