/**
 * Models API — surfaces pi's ModelRegistry so the Web UI can render a
 * proper dropdown instead of a free-text input.
 *
 * "Available" = an API key/OAuth credential is configured for the provider
 * (pi's `registry.getAvailable()`). "All" = built-in + any custom models
 * from `~/.pi/agent/models.json`. The frontend renders these as two
 * `<optgroup>`s so users can see which models they could enable.
 *
 * The registry is injected (rather than instantiated here) so the same
 * instance can back the agent session creation path — keeping the "what
 * the UI sees" and "what the engine resolves" in lock-step.
 */
import { Hono } from 'hono';
import type { ModelRegistry } from '@mariozechner/pi-coding-agent';
import { logger } from '../../logging/index.js';

interface ModelSummary {
  /** `<provider>/<id>` — the canonical reference stored in pragents.yaml. */
  reference: string;
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  hasAuth: boolean;
}

function toSummary(m: any, hasAuth: boolean): ModelSummary {
  return {
    reference: `${m.provider}/${m.id}`,
    provider: m.provider,
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindow ?? 0,
    maxTokens: m.maxTokens ?? 0,
    reasoning: !!m.reasoning,
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    hasAuth,
  };
}

export function createModelsRoute(registry: ModelRegistry) {
  const r = new Hono();

  r.get('/', (c) => {
    try {
      const available = registry.getAvailable();
      const availableKeys = new Set(available.map((m) => `${m.provider}/${m.id}`));
      const all = registry.getAll().map((m) =>
        toSummary(m, availableKeys.has(`${m.provider}/${m.id}`)),
      );
      const error = registry.getError();
      return c.json({
        available: all.filter((m) => m.hasAuth),
        all,
        error: error ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, 'Failed to enumerate models');
      return c.json({ available: [], all: [], error: msg }, 500);
    }
  });

  return r;
}
