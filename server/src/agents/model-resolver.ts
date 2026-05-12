import { getModel } from '@mariozechner/pi-ai';
import { logger } from '../logging/index.js';

/**
 * Resolve a pragents model string (e.g. "deepseek/deepseek-v4-flash") to a
 * pi-ai Model object that `createAgentSession({ model })` expects.
 *
 * The pragents config uses "<provider>/<modelId>" slash notation as a
 * convention, but the pi SDK API requires a Model OBJECT (with `.provider`
 * and `.id` properties) — not a string. Passing a string makes the SDK
 * see `model.provider === undefined`, which surfaces as "No API key found
 * for undefined" at session creation time.
 *
 * @returns The resolved Model object, or `null` if the model is unknown to
 *   the pi-ai registry. Callers should treat `null` as "model not available"
 *   and handle it gracefully (e.g., emit an error event, fall back).
 */
export function resolveModel(modelString: string | undefined): unknown | null {
  if (!modelString) return null;

  // Parse "provider/modelId" — provider has no slash, modelId may have any chars
  const slashIdx = modelString.indexOf('/');
  if (slashIdx === -1) {
    logger.warn({ model: modelString },
      'resolveModel: model string has no provider prefix (expected "provider/modelId")');
    return null;
  }

  const provider = modelString.substring(0, slashIdx);
  const modelId = modelString.substring(slashIdx + 1);

  // getModel is strongly typed against a KnownProvider literal union; for
  // runtime-resolved strings we have to cast. The function returns undefined
  // for unknown providers/models, which we surface as null.
  const model = (getModel as (p: string, id: string) => unknown | undefined)(provider, modelId);
  if (!model) {
    logger.warn({ provider, modelId },
      'resolveModel: model not found in pi-ai registry');
    return null;
  }

  return model;
}
