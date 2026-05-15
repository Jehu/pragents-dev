import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createFilesRoute } from '../files.js';

describe('createFilesRoute — /api/v1/files/meta', () => {
  let root: string;
  let app: Hono;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'files-route-'));
    mkdirSync(join(root, 'skills'), { recursive: true });
    writeFileSync(join(root, 'pragents.yaml'), 'company:\n  name: t\n', 'utf8');
    writeFileSync(join(root, 'skills', 'skill-a.md'), '---\nname: a\n---\nbody\n', 'utf8');
    app = new Hono().route(
      '/api/v1/files',
      createFilesRoute({
        allowedRoots: [join(root, 'pragents.yaml'), join(root, 'skills')],
      }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('GET returns mtime + etag for a file inside the allow-list', async () => {
    const res = await app.request(`/api/v1/files/meta?path=${join(root, 'pragents.yaml')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
    const body = (await res.json()) as { mtime: number; etag: string };
    expect(body.mtime).toBeTypeOf('number');
    expect(body.etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
  });

  it('HEAD returns 200 with ETag header and empty body', async () => {
    const res = await app.request(`/api/v1/files/meta?path=${join(root, 'pragents.yaml')}`, {
      method: 'HEAD',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('returns 400 when path query is missing', async () => {
    const res = await app.request('/api/v1/files/meta');
    expect(res.status).toBe(400);
  });

  it('returns 400 for literal ../../etc/passwd', async () => {
    const res = await app.request('/api/v1/files/meta?path=../../etc/passwd');
    expect(res.status).toBe(400);
  });

  it('returns 400 for URL-encoded traversal', async () => {
    const res = await app.request('/api/v1/files/meta?path=%2e%2e%2fetc%2fpasswd');
    expect(res.status).toBe(400);
  });

  it('returns 400 for double-encoded traversal', async () => {
    const res = await app.request('/api/v1/files/meta?path=%252e%252e%252fetc%252fpasswd');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a path inside the allow-list that does not exist', async () => {
    const res = await app.request(
      `/api/v1/files/meta?path=${join(root, 'skills', 'missing.md')}`,
    );
    expect(res.status).toBe(404);
  });

  it('accepts a file under a directory root (skills)', async () => {
    const res = await app.request(
      `/api/v1/files/meta?path=${join(root, 'skills', 'skill-a.md')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { etag: string };
    expect(body.etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
  });
});
