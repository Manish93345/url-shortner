import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { redis } from '../../src/plugins/redis';
import { registerUser, createApiKey } from '../../src/modules/auth/service';

describe('auth + protected create', () => {
  let app: FastifyInstance;
  let token: string;
  let apiKey: string;
  const email = `auth-${randomUUID()}@example.com`;
  const password = 'supersecret123';

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    const user = await registerUser(email, password);
    apiKey = (await createApiKey(user.id, 'test')).key;
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    token = res.json().token;
  });

  afterAll(async () => { await app.close(); await redis.quit(); await pool.end(); });

  it('blocks unauthenticated creates (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/urls', payload: { url: 'https://example.com/x' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid API keys (401)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/urls',
      headers: { 'x-api-key': 'us_totally_bogus' },
      payload: { url: 'https://example.com/x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates with a valid API key and returns rate-limit headers', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/urls',
      headers: { 'x-api-key': apiKey },
      payload: { url: 'https://example.com/authed' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-ratelimit-limit']).toBe('1000');
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('registers with a JWT, rejects duplicates, and manages API keys', async () => {
    const dup = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password } });
    expect(dup.statusCode).toBe(409);

    const badLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'wrong-password' } });
    expect(badLogin.statusCode).toBe(401);

    const keyRes = await app.inject({
      method: 'POST', url: '/auth/api-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'ci' },
    });
    expect(keyRes.statusCode).toBe(201);
    expect(keyRes.json().key).toMatch(/^us_/);
  });
});