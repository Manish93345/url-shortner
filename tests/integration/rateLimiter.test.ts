import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { redis } from '../../src/plugins/redis';
import { checkRateLimit } from '../../src/services/rateLimiter';

describe('sliding-window rate limiter', () => {
  beforeAll(async () => { await buildApp({ logger: false }).then(() => {}); });

  afterAll(async () => { await redis.quit(); await pool.end(); });

  it('allows up to the limit, then denies with Retry-After', async () => {
    const subject = `test:${randomUUID()}`;

    const first = await checkRateLimit(subject, 2);
    const second = await checkRateLimit(subject, 2);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    const third = await checkRateLimit(subject, 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
    expect(third.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('isolates subjects', async () => {
    const a = `test:${randomUUID()}`;
    const b = `test:${randomUUID()}`;
    await checkRateLimit(a, 1);
    const deniedA = await checkRateLimit(a, 1);
    const stillOkB = await checkRateLimit(b, 1);
    expect(deniedA.allowed).toBe(false);
    expect(stillOkB.allowed).toBe(true);
  });

  it('unlimited plans skip Redis entirely', async () => {
    const result = await checkRateLimit(`test:${randomUUID()}`, null);
    expect(result).toEqual({ allowed: true, limit: 0, remaining: 0, retryAfterSec: 0 });
  });
});