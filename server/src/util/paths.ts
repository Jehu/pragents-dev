import { homedir } from 'node:os';

/**
 * Expand a leading `~` in operator-supplied paths to the current user's
 * home directory. Mirrors the in-place expansion that
 * `config/schema.ts:resolveAgent` does for project directories — kept
 * centralized so route handlers and boot-time validation share one
 * implementation.
 *
 * Pure: returns the path unchanged when it does not start with `~`.
 */
export function expandHome(p: string): string {
  if (p === '~') return process.env.HOME || homedir();
  if (p.startsWith('~/')) return (process.env.HOME || homedir()) + p.slice(1);
  return p;
}
