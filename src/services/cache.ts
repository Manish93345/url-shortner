import { pool } from '../db/pool';
import { redis, withTimeout } from '../plugins/redis';
const REDIS_OP_TIMEOUT_MS = 100; 

const URL_TTL_SECONDS = 24 * 60 * 60; // positive cache: 24h
const NEG_TTL_SECONDS = 60;           // negative cache: 60s — defends against
                                      // random-code scanning (cache penetration)

export interface ResolveResult {
  found: boolean;
  originalUrl: string | null;
  cache: 'HIT' | 'MISS' | 'NEG';
}

const urlKey = (code: string) => `url:${code}`;
const negKey = (code: string) => `nf:${code}`;

/**
 * Stampede guard: at most ONE in-flight DB lookup per code per process.
 * Check-then-set happens synchronously (no await between them), so under
 * Node's single-threaded event loop this is race-free: 1000 concurrent
 * misses for the same cold code → exactly 1 Postgres query.
 */
const inflight = new Map<string, Promise<ResolveResult>>();

export async function resolveRedirect(code: string): Promise<ResolveResult> {
  const existing = inflight.get(code);
  if (existing) return existing;

  const promise = doResolve(code);
  inflight.set(code, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(code);
  }
}

async function doResolve(code: string): Promise<ResolveResult> {
  // One round trip for both keys (MGET, not two GETs).
  let cached: string | null;
  let negative: string | null;
   try {
    [cached, negative] = await withTimeout(
      redis.mget(urlKey(code), negKey(code)),
      REDIS_OP_TIMEOUT_MS,
    );
  } catch {
    // Timeout or Redis down → serve from Postgres (fail open)
    console.warn('Redis unavailable during resolve — falling back to Postgres');
    cached = null;
    negative = null;
  }

  if (cached !== null) {
    return { found: true, originalUrl: cached, cache: 'HIT' };
  }
  if (negative !== null) {
    return { found: false, originalUrl: null, cache: 'NEG' };
  }
  return loadFromDbAndCache(code);
}

async function loadFromDbAndCache(code: string): Promise<ResolveResult> {
  const { rows } = await pool.query<{ original_url: string }>(
    `SELECT original_url
       FROM urls
      WHERE short_code = $1
        AND (expires_at IS NULL OR expires_at > now())`,
    [code],
  );

  if (rows.length > 0) {
    const originalUrl = rows[0].original_url;
    // Fire-and-forget: don't block the redirect on the SETEX round trip.
    // If it fails, the next request just re-queries — harmless.
    void redis
      .set(urlKey(code), originalUrl, 'EX', URL_TTL_SECONDS)
      .catch(() => {});
    return { found: true, originalUrl, cache: 'MISS' };
  }

  void redis.set(negKey(code), '1', 'EX', NEG_TTL_SECONDS).catch(() => {});
  return { found: false, originalUrl: null, cache: 'MISS' };
}