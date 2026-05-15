import { readFileSync, watch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { PragentsConfig, resolveAllAgents, type ResolvedAgent } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveEnv(value: string): string {
  const match = value.match(/^env:(\w+)$/);
  if (!match) return value;
  const varName = match[1];
  const resolved = process.env[varName];
  if (resolved === undefined) {
    throw new Error(
      `Environment variable "${varName}" referenced in config is not set.`,
    );
  }
  return resolved;
}

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') return resolveEnv(obj);
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  return obj;
}

const DEFAULT_CONFIG_PATHS = [
  resolve(process.env.HOME || '~', '.pragents', 'pragents.yaml'),
];

export interface LoadedConfig {
  config: PragentsConfig;
  agents: ResolvedAgent[];
}

export function loadConfig(configPath?: string): LoadedConfig {
  const paths = configPath
    ? [resolve(configPath)]
    : DEFAULT_CONFIG_PATHS;

  let rawYaml: string | null = null;
  let loadedPath: string | null = null;

  for (const p of paths) {
    try {
      rawYaml = readFileSync(p, 'utf-8');
      loadedPath = p;
      break;
    } catch {
      continue;
    }
  }

  if (!rawYaml) {
    throw new Error(
      `No pragents config found. Looked in: ${paths.join(', ')}. ` +
        `Create ~/.pragents/pragents.yaml to get started.`,
    );
  }

  const raw = parseYaml(rawYaml);
  const resolved = resolveEnvVars(raw) as Record<string, unknown>;

  const config = PragentsConfig.parse(resolved);
  const agents = resolveAllAgents(config);

  return { config, agents };
}

export interface WatchHandle {
  stop: () => void;
  /**
   * Tell the watcher to ignore the next change event for `filePath`. The
   * suppression is single-shot AND time-bounded: the first matching change
   * event within `durationMs` (default 250) is dropped, anything after is
   * delivered normally. UI-originated writes call this so `fs.watch` does
   * not fire a duplicate reload after the write.
   */
  suppressNextChange: (filePath: string, durationMs?: number) => void;
}

/**
 * Module-level pointer to the active watcher's suppression API.
 *
 * Route handlers that write to `pragents.yaml` import `suppressWatcherChange`
 * from this module instead of receiving the watcher handle through their
 * factory. This keeps the existing `createXxxRoute(getDb)` factory signatures
 * unchanged while still letting the watcher know about UI-originated writes.
 *
 * When no watcher is active (e.g., in unit tests), the proxy is a no-op.
 */
let activeWatcher: WatchHandle | null = null;

export function suppressWatcherChange(filePath: string, durationMs = 250): void {
  activeWatcher?.suppressNextChange(filePath, durationMs);
}

/**
 * Watch `pragents.yaml` for changes and call `onReload` with the new config
 * whenever the file changes. Returns a {@link WatchHandle} with `stop` to
 * shut the watcher down and `suppressNextChange` so callers (or the
 * module-level `suppressWatcherChange` proxy) can mark UI-originated writes.
 */
export function watchConfig(
  onReload: (agents: ResolvedAgent[], changedAgentIds: Set<string>) => void,
  configPath?: string,
): WatchHandle {
  const paths = configPath
    ? [resolve(configPath)]
    : DEFAULT_CONFIG_PATHS;

  const watchPath = paths[0];

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previousAgentIds: Set<string> = new Set();

  const suppressions = new Map<string, number>();

  const watcher = watch(watchPath, () => {
    const expiresAt = suppressions.get(watchPath);
    if (expiresAt !== undefined && Date.now() < expiresAt) {
      suppressions.delete(watchPath);
      return;
    }
    suppressions.delete(watchPath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const { agents } = loadConfig(configPath);
        const newAgentIds = new Set(agents.map((a) => a.id));
        const changedIds = new Set([...previousAgentIds].filter((id) => newAgentIds.has(id)));
        previousAgentIds = newAgentIds;
        onReload(agents, changedIds);
      } catch {
        // Malformed YAML mid-save — ignore and retry on next change
      }
    }, 500);
  });

  const handle: WatchHandle = {
    stop: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
      if (activeWatcher === handle) {
        activeWatcher = null;
      }
    },
    suppressNextChange: (filePath, durationMs = 250) => {
      const absolute = resolve(filePath);
      if (absolute !== watchPath) return;
      suppressions.set(watchPath, Date.now() + durationMs);
    },
  };

  activeWatcher = handle;
  return handle;
}
