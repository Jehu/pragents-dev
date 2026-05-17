import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchJson, postJson } from '../api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchJson', () => {
  it('returns parsed JSON for successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    await expect(fetchJson('/api/test')).resolves.toEqual({ ok: true });
  });

  it('throws ApiError with status and response message on failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Denied' }), { status: 401 })));

    await expect(fetchJson('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Denied',
    } satisfies Partial<ApiError>);
  });
});

describe('postJson', () => {
  it('defaults to POST', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await postJson('/api/test');

    expect(fetchMock).toHaveBeenCalledWith('/api/test', { method: 'POST' });
  });
});
