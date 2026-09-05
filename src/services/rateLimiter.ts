import { randomUUID } from 'node:crypto';
import { redis, withTimeout } from '../plugins/redis';

const WINDOW_MS = 60_000;          // 1000 req/min → window = 1 minute
const REDIS_OP_TIMEOUT_MS = 100;

/** Plans with a limit. Anything else (e.g. 'benchmark') = unlimited → Redis is never hit. */
export const PLAN_LIMITS: Record<string, number> = { free: 1000, pro: 10_000 };
export function limitForPlan(plan: string): number | null {
  return PLAN_LIMITS[plan] ?? null;
}

/**
 * Exact sliding-window rate limiter.
 *
 * ZSET: score = timestamp(ms), member = unique request id (uuid4 — two
 * requests in the same millisecond must not collapse into one ZADD entry).
 * One Lua call = prune + count + add, atomically. Without the script, two
 * concurrent requests could both read count < limit and both slip in.
 *
 * Uses Redis TIME (not app clocks): all instances share one clock, so
 * multi-node deployment can't skew the window.
 */
const SLIDING_WINDOW_LUA = `
local time   = redis.call('TIME')
local now    = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local window = tonumber(ARGV[1])
local limit  = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])

if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local retry_ms = 0
if #oldest > 0 then
  retry_ms = math.max(0, math.floor(tonumber(oldest[2]) + window - now))
end
return {0, 0, retry_ms}
`;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;   // -1 = unknown (fail-open)
  retryAfterSec: number;
}

export async function checkRateLimit(subject: string, limit: number | null): Promise<RateLimitResult> {
  if (limit === null) {
    return { allowed: true, limit: 0, remaining: 0, retryAfterSec: 0 }; // unlimited — zero Redis cost
  }

  try {
    const [allowed, remaining, retryMs] = await withTimeout(
      redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `rl:${subject}`,
        WINDOW_MS,
        limit,
        randomUUID(),
      ) as Promise<[number, number, number]>,
      REDIS_OP_TIMEOUT_MS,
    );
    return {
      allowed: allowed === 1,
      limit,
      remaining,
      retryAfterSec: Math.ceil(retryMs / 1000),
    };
  } catch {
    // Fail open: limiter outage must not take the API down. Documented tradeoff —
    // an API enforcing paid quotas might fail closed instead.
    console.warn('Rate limiter unavailable — failing open');
    return { allowed: true, limit, remaining: -1, retryAfterSec: 0 };
  }
}