import { buildApp } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { redis, withTimeout } from './plugins/redis';

async function main() {
  const app = await buildApp();

  // Graceful shutdown: stop accepting new requests, drain in-flight ones,
  // then close DB/Redis. This is what makes blue-green deploys zero-downtime.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received — draining connections...`);
      void (async () => {
        try {
          await app.close(); // finishes in-flight requests
          await redis.quit();
          await pool.end();
          process.exit(0);
        } catch (err) {
          app.log.error(err, 'Error during shutdown');
          process.exit(1);
        }
      })();
    });
  }

  // Forces the Redis handshake and first PG connection to complete before
// request #1 arrives — eliminates the first-request fallback race we just saw.
await Promise.allSettled([
  withTimeout(redis.ping(), 2_000),
  withTimeout(pool.query('SELECT 1'), 2_000),
]);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`🚀 Server listening on :${config.PORT} (${config.NODE_ENV})`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});