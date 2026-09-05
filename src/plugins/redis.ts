import Redis from 'ioredis';
import { config } from '../config';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,     // fail fast — the cache layer handles fallback
  enableOfflineQueue: false,   // while disconnected: reject commands NOW, don't queue them
  connectTimeout: 5_000,
  retryStrategy: (times) => Math.min(times * 200, 3_000), // reconnect: 0.2s → 3s cap
});

redis.on('error', (err) =>
  console.error('Redis error:', err.message || err.code || 'unknown'),
);

/**
 * Bounded-latency Redis operation. ioredis has NO per-command timeout: if a
 * socket dies without a TCP RST (container stop, network partition), commands
 * hang until the OS TCP retransmit timeout — we measured ~70s. Every awaited
 * Redis call on a request path MUST go through this.
 */
export function withTimeout<T>(op: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis op exceeded ${ms}ms timeout`)), ms);
  });
  return Promise.race([op, timeout]).finally(() => clearTimeout(timer));
}