import { getModel } from '@mariozechner/pi-ai';
import type { ModelRegistry } from '@mariozechner/pi-coding-agent';
import { logger } from '../logging/index.js';

/**
 * Resolve a pragents model string (e.g. "anthropic/claude-sonnet-4-5") to a
 * pi-ai Model object that `createAgentSession({ model })` expects.
 *
 * The config uses "<provider>/<modelId>" slash notation; the pi SDK API
 * requires a Model OBJECT (with `.provider` and `.id` properties) — passing
 * a bare string makes the SDK see `model.provider === undefined`, which
 * surfaces as "No API key found for undefined" at session creation time.
 *
 * When a `ModelRegistry` has been installed via `setModelRegistry()`, this
 * function consults it first — so custom models defined in
 * `~/.pi/agent/models.json` resolve. It falls back to pi-ai's built-in
 * `getModel()` for backwards compatibility and for the test path that
 * doesn't boot the registry.
 *
 * @returns The resolved Model object, or `null` if unknown. Callers treat
 *   `null` as "model not available" (emit an error event / fall back).
 */
export function resolveModel(modelString: string | undefined): unknown | null {
  if (!modelString) return null;

  const slashIdx = modelString.indexOf('/');
  if (slashIdx === -1) {
    logger.warn({ model: modelString },
      'resolveModel: model string has no provider prefix (expected "provider/modelId")');
    return null;
  }

  const provider = modelString.substring(0, slashIdx);
  const modelId = modelString.substring(slashIdx + 1);

  // Prefer the shared ModelRegistry so custom (models.json) entries resolve.
  // `find()` returns undefined for unknown combos.
  const registry = sharedRegistry;
  if (registry) {
    const fromRegistry = registry.find(provider, modelId);
    if (fromRegistry) return applyProviderOverrides(provider, fromRegistry);
  }

  // Fallback to pi-ai built-in registry (covers test paths that skip boot
  // wiring, and stays useful if the shared registry was never installed).
  const model = (getModel as (p: string, id: string) => unknown | undefined)(provider, modelId);
  if (!model) {
    logger.warn({ provider, modelId },
      'resolveModel: model not found in pi registry (built-in or custom)');
    return null;
  }
  return applyProviderOverrides(provider, model);
}

/** Per-provider overrides from the `providers:` section of pragents.yaml. */
export interface ProviderOverride {
  baseUrl?: string;
}

let providerOverrides: Record<string, ProviderOverride> = {};

/**
 * Install per-provider overrides (currently `baseUrl`). Called at boot and on
 * every config hot-reload so `pragents.yaml` stays the single source of
 * truth. Example: pointing the "zai" provider at the GLM Coding Plan
 * endpoint, which uses a separate quota from the general API.
 */
export function setProviderOverrides(overrides: Record<string, ProviderOverride>): void {
  providerOverrides = overrides;
}

function applyProviderOverrides(provider: string, model: unknown): unknown {
  const override = providerOverrides[provider];
  if (!override?.baseUrl) return model;
  return { ...(model as Record<string, unknown>), baseUrl: override.baseUrl };
}

let sharedRegistry: ModelRegistry | null = null;

/**
 * Install the shared `ModelRegistry` used by `resolveModel`. Called once at
 * server boot. Stored as a module-level singleton because pragents runs as
 * a single process with one pi config dir — there's never more than one
 * registry to choose from.
 */
export function setModelRegistry(registry: ModelRegistry | null): void {
  sharedRegistry = registry;
}
