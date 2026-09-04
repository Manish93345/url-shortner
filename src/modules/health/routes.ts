import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { redis } from '../../plugins/redis';

const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: process is up. Never touches dependencies.
  app.get('/live', async () => ({ status: 'ok' }));

  // Readiness: dependencies are up. Blue-green deploy polls THIS in Phase 8.
  app.get('/ready', async (_req, reply) => {
    const [pgResult, redisResult] = await Promise.allSettled([
      pool.query('SELECT 1'),
      redis.ping(),
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