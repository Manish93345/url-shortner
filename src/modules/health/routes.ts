import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { redis, withTimeout } from '../../plugins/redis';

const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: process is up. Never touches dependencies.
  app.get('/live', async () => ({ status: 'ok' }));

  // Readiness: dependencies are up. Blue-green deploy polls THIS in Phase 8.
  app.get('/ready', async (_req, reply) => {
    const [pgResult, redisResult] = await Promise.allSettled([
      withTimeout(pool.query('SELECT 1'), 2_000),
      withTimeout(redis.ping(), 1_000),
    ]);

    const checks = {
      postgres: pgResult.status === 'fulfilled' ? 'ok' : 'fail',
      redis: redisResult.status === 'fulfilled' ? 'ok' : 'fail',
    };
    const healthy = checks.postgres === 'ok' && checks.redis === 'ok';

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checks,
    });
  });
};

export default healthRoutes;