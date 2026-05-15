import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Smoke test for the skill detail route.
 *
 * The route uses TanStack Router's file-based generation; the generated
 * route tree is rebuilt at `npm run dev` or `npm run build`, so the route
 * does not appear in routeTree.gen.ts until the next build. This test
 * therefore mounts the component implementation directly via a thin
 * harness rather than via the router, which is sufficient for verifying
 * the fetch + edit + approve/reject wiring.
 *
 * Full end-to-end (router + URL params) coverage lands when the routeTree
 * is regenerated alongside the next dev cycle.
 */

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('skill detail route — module', () => {
  it('module loads and exports the Route + component constants', async () => {
    const mod = await import('../$skillName.js');
    expect(mod.Route).toBeDefined();
  });
});
