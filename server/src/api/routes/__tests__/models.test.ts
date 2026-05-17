import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createModelsRoute } from '../models.js';

/**
 * Minimal ModelRegistry stub that satisfies the surface
 * `createModelsRoute` relies on. We avoid booting the real pi registry to
 * keep the test hermetic.
 */
function stubRegistry(models: Array<{ provider: string; id: string; name: string; hasAuth: boolean }>) {
  const all = models.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
    contextWindow: 200_000,
    maxTokens: 8192,
    reasoning: m.id.includes('reasoning'),
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  }));
  return {
    getAvailable: () => all.filter((_, i) => models[i].hasAuth),
    getAll: () => all,
    getError: () => undefined,
  } as any;
}

async function jsonGet(app: Hono) {
  const res = await app.request('/');
  return { status: res.status, body: await res.json() };
}

describe('GET /api/v1/models', () => {
  it('returns an empty available set when no models are configured', async () => {
    const app = createModelsRoute(stubRegistry([]));
    const { status, body } = await jsonGet(app);
    expect(status).toBe(200);
    expect(body.available).toEqual([]);
    expect(body.all).toEqual([]);
    expect(body.error).toBeNull();
  });

  it('flags hasAuth on each model and splits available from the full list', async () => {
    const app = createModelsRoute(
      stubRegistry([
        { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude', hasAuth: true },
        { provider: 'openai', id: 'gpt-5', name: 'GPT-5', hasAuth: false },
      ]),
    );
    const { body } = await jsonGet(app);
    expect(body.all).toHaveLength(2);
    expect(body.available).toHaveLength(1);
    expect(body.available[0].reference).toBe('anthropic/claude-sonnet-4-5');
    expect(body.available[0].hasAuth).toBe(true);
    const gpt = body.all.find((m: any) => m.reference === 'openai/gpt-5');
    expect(gpt.hasAuth).toBe(false);
  });

  it('returns 500 with error message when the registry throws', async () => {
    const broken = {
      getAvailable: () => {
        throw new Error('disk full');
      },
      getAll: () => [],
      getError: () => undefined,
    } as any;
    const app = createModelsRoute(broken);
    const { status, body } = await jsonGet(app);
    expect(status).toBe(500);
    expect(body.error).toMatch(/disk full/);
  });

  it('forwards a non-fatal registry error in the response body', async () => {
    const noisy = {
      getAvailable: () => [],
      getAll: () => [],
      getError: () => 'models.json could not be parsed',
    } as any;
    const app = createModelsRoute(noisy);
    const { body } = await jsonGet(app);
    expect(body.error).toMatch(/models\.json/);
  });
});
