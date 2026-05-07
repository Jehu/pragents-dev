import { readFileSync } from 'node:fs';
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
