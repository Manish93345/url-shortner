import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { redis } from '../../src/plugins/redis';

describe('redirect caching', () => {
  let app: FastifyInstance;
  let code: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await redis.flushdb();
    const res = await app.inject({
      method: 'POST',
      url: '/api/urls',
      payload: { url: 'https://example.com/cache-test' },
    });
    code = res.json().shortCode;
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await pool.end();
  });

  it('serves MISS then HIT with the same destination', async () => {
    const first = await app.inject({ method: 'GET', url: `/${code}` });
    expect(first.statusCode).toBe(302);
    expect(first.headers['x-cache']).toBe('MISS');

    const second = await app.inject({ method: 'GET', url: `/${code}` });
    expect(second.statusCode).toBe(302);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.headers.location).toBe(first.headers.location);
  });

  it('negatively caches unknown codes (MISS then NEG, both 404)', async () => {
    const first = await app.inject({ method: 'GET', url: '/ghost42' });
    const second = await app.inject({ method: 'GET', url: '/ghost42' });
    expect(first.statusCode).toBe(404);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.statusCode).toBe(404);
    expect(second.headers['x-cache']).toBe('NEG');
  });

  it('collapses 50 concurrent misses into ONE Postgres query', async () => {
    await redis.flushdb();
    const spy = vi.spyOn(pool, 'query');

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: 'GET', url: `/${code}` }),
      ),
    );

    expect(results.every((r) => r.statusCode === 302)).toBe(true);
    const selects = spy.mock.calls.filter(([sql]) =>
      String(sql).includes('short_code = $1'),
    );
    expect(selects.length).toBe(1); // ← the stampede guard, proven
    spy.mockRestore();
  });
});