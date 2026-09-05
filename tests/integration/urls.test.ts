import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { redis } from '../../src/plugins/redis';
import { randomUUID } from 'node:crypto';
import { registerUser, createApiKey } from '../../src/modules/auth/service';

describe('URL shortener flow', () => {
  let app: FastifyInstance;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    const user = await registerUser(`t-${randomUUID()}@example.com`, 'password123');
    apiKey = (await createApiKey(user.id, 'test')).key;
  });

  

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await pool.end();
  });

  it('creates a short URL and redirects to the original', async () => {
    const createRes = await app.inject({
      headers: { 'x-api-key': apiKey },
      method: 'POST',
      url: '/api/urls',
      payload: { url: 'https://example.com/some/very/long/path?with=query' },
    });

    expect(createRes.statusCode).toBe(201);
    const body = createRes.json();
    expect(body.shortCode).toMatch(/^[0-9a-zA-Z]{1,10}$/);

    const redirectRes = await app.inject({ method: 'GET', url: `/${body.shortCode}` });
    expect(redirectRes.statusCode).toBe(302);
    expect(redirectRes.headers.location).toBe(
      'https://example.com/some/very/long/path?with=query',
    );
  });

  it('rejects non-http(s) schemes', async () => {
    const res = await app.inject({
      headers: { 'x-api-key': apiKey },
      method: 'POST',
      url: '/api/urls',
      payload: { url: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown codes', async () => {
    const res = await app.inject({ method: 'GET', url: 'ZZZnope' });
    expect(res.statusCode).toBe(404);
  });
});