import { getEnvApiKey } from '@mariozechner/pi-ai';
import { resolveModel } from './model-resolver.js';
import type { ResolvedAgent } from '../config/schema.js';

/**
 * Static health check for every model configured on an agent: is the model
 * string resolvable against the pi registry, and is an API key present for
 * its provider? Deliberately NO live provider ping — this runs on every
 * health poll (30s) and must stay free and fast. It catches the two failure
 * modes from the 2026-07-04 usability report (M1/M2): commented-out keys and
 * misspelled/unknown models, both of which previously kept the health badge
 * green while every agent run failed silently.
 */
export interface ModelHealth {
  model: string;
  provider: string;
  /** Agent ids configured with this model. */
  agents: string[];
  /** Model string resolves against the pi registry (built-in or custom). */
  resolvable: boolean;
  /** An API key for the provider is present in the environment. */
  keyPresent: boolean;
  ok: boolean;
}

export function checkModelHealth(agents: ResolvedAgent[]): ModelHealth[] {
  const byModel = new Map<string, string[]>();
  for (const agent of agents) {
    if (!agent.model) continue;
    const ids = byModel.get(agent.model) ?? [];
    ids.push(agent.id);
    byModel.set(agent.model, ids);
  }

  return [...byModel.entries()].map(([model, agentIds]) => {
    const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
    const resolvable = resolveModel(model) !== null;
    const keyPresent = provider ? Boolean(getEnvApiKey(provider)) : false;
    return {
      model,
      provider,
      agents: agentIds,
      resolvable,
      keyPresent,
      ok: resolvable && keyPresent,
    };
  });
}
