import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authMiddleware, checkWsAuth, getOrCreateApiToken } from '../auth.js';

const TOKEN = 'a'.repeat(64);

function buildApp(getToken: () => string) {
  const app = new Hono();
  app.use('/api/*', authMiddleware(getToken));
  app.get('/api/v1/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('authMiddleware', () => {
  it('rejects non-localhost request without token', async () => {
    const app = buildApp(() => TOKEN);
    // Use a non-localhost Host header to bypass the localhost fallback.
    const res = await app.request('http://example.com/api/v1/ping');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Unauthorized',
      hint: 'set PRAGENTS_API_TOKEN env or use Authorization: Bearer header',
    });
  });

  it('accepts request with valid Authorization: Bearer header', async () => {
    const app = buildApp(() => TOKEN);
    const res = await app.request('http://example.com/api/v1/ping', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects request with wrong token in header', async () => {
    const app = buildApp(() => TOKEN);
    const res = await app.request('http://example.com/api/v1/ping', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts request with valid ?token= query param', async () => {
    const app = buildApp(() => TOKEN);
    const res = await app.request(`http://example.com/api/v1/ping?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('rejects request with wrong ?token= query param', async () => {
    const app = buildApp(() => TOKEN);
    const res = await app.request('http://example.com/api/v1/ping?token=nope');
    expect(res.status).toBe(401);
  });

  it('bypasses auth for localhost Host header', async () => {
    const app = buildApp(() => TOKEN);
    const res = await app.request('http://localhost/api/v1/ping');
    expect(res.status).toBe(200);
  });

  it('bypasses auth for 127.0.0.1 Host header', async () => {
    const app = buildApp(() => TOKEN);
    const res = await app.request('http://127.0.0.1:3737/api/v1/ping');
    expect(res.status).toBe(200);
  });

  it('rejects non-localhost when token is empty', async () => {
    const app = buildApp(() => '');
    const res = await app.request('http://example.com/api/v1/ping', {
      headers: { authorization: 'Bearer anything' },
    });
    expect(res.status).toBe(401);
  });
});

describe('checkWsAuth', () => {
  it('passes on localhost remoteAddress', () => {
    const result = checkWsAuth(
      { url: '/ws', headers: { host: 'example.com' }, socket: { remoteAddress: '127.0.0.1' } },
      TOKEN,
    );
    expect(result.ok).toBe(true);
  });

  it('passes on ::1 remoteAddress', () => {
    const result = checkWsAuth(
      { url: '/ws', headers: { host: 'example.com' }, socket: { remoteAddress: '::1' } },
      TOKEN,
    );
    expect(result.ok).toBe(true);
  });

  it('passes on localhost Host header', () => {
    const result = checkWsAuth(
      { url: '/ws', headers: { host: 'localhost:3737' }, socket: { remoteAddress: '10.0.0.5' } },
      TOKEN,
    );
    expect(result.ok).toBe(true);
  });

  it('passes with valid Authorization header', () => {
    const result = checkWsAuth(
      {
        url: '/ws',
        headers: { host: 'example.com', authorization: `Bearer ${TOKEN}` },
        socket: { remoteAddress: '10.0.0.5' },
      },
      TOKEN,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe('header');
  });

  it('passes with valid ?token= query param', () => {
    const result = checkWsAuth(
      {
        url: `/ws?token=${TOKEN}`,
        headers: { host: 'example.com' },
        socket: { remoteAddress: '10.0.0.5' },
      },
      TOKEN,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe('query');
  });

  it('rejects when no token provided and not localhost', () => {
    const result = checkWsAuth(
      { url: '/ws', headers: { host: 'example.com' }, socket: { remoteAddress: '10.0.0.5' } },
      TOKEN,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects wrong token', () => {
    const result = checkWsAuth(
      {
        url: '/ws?token=wrong',
        headers: { host: 'example.com', authorization: 'Bearer wrong' },
        socket: { remoteAddress: '10.0.0.5' },
      },
      TOKEN,
    );
    expect(result.ok).toBe(false);
  });
});

describe('getOrCreateApiToken', () => {
  let tmp: string;
  let envPath: string;
  let originalToken: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pragents-auth-'));
    envPath = join(tmp, '.env');
    originalToken = process.env.PRAGENTS_API_TOKEN;
    delete process.env.PRAGENTS_API_TOKEN;
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.PRAGENTS_API_TOKEN = originalToken;
    } else {
      delete process.env.PRAGENTS_API_TOKEN;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns existing env token without writing', () => {
    process.env.PRAGENTS_API_TOKEN = 'pre-existing';
    const t = getOrCreateApiToken(envPath);
    expect(t).toBe('pre-existing');
    expect(existsSync(envPath)).toBe(false);
  });

  it('generates token, persists to env file, exports to process.env', () => {
    const t = getOrCreateApiToken(envPath);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(process.env.PRAGENTS_API_TOKEN).toBe(t);
    const fileContent = readFileSync(envPath, 'utf-8');
    expect(fileContent).toContain(`PRAGENTS_API_TOKEN=${t}`);
  });

  it('appends without clobbering existing env contents', () => {
    writeFileSync(envPath, 'LOG_LEVEL=debug\nANTHROPIC_API_KEY=sk-foo\n');
    const t = getOrCreateApiToken(envPath);
    const fileContent = readFileSync(envPath, 'utf-8');
    expect(fileContent).toContain('LOG_LEVEL=debug');
    expect(fileContent).toContain('ANTHROPIC_API_KEY=sk-foo');
    expect(fileContent).toContain(`PRAGENTS_API_TOKEN=${t}`);
  });

  it('inserts newline separator when existing file has no trailing newline', () => {
    writeFileSync(envPath, 'LOG_LEVEL=debug');
    const t = getOrCreateApiToken(envPath);
    const fileContent = readFileSync(envPath, 'utf-8');
    expect(fileContent).toBe(`LOG_LEVEL=debug\nPRAGENTS_API_TOKEN=${t}\n`);
  });
});
