import { FastifyPluginAsync } from 'fastify';
import { resolveRedirect } from '../../services/cache';
import { redis, withTimeout } from '../../plugins/redis';

const CODE_PATTERN = /^[0-9a-zA-Z]{1,10}$/;

const redirectRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:code', async (req, reply) => {
    const { code } = req.params as { code: string };

    if (!CODE_PATTERN.test(code)) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const result = await resolveRedirect(code);
    reply.header('X-Cache', result.cache);

    if (!result.found) {
      return reply.code(404).send({ error: 'Short URL not found' });
    }

    // Real-time click counter — fire-and-forget (never blocks the redirect).
    // This is the "stats-lite" version; the full stream→worker pipeline comes later.
    void withTimeout(redis.hincrby('stats:clicks', code, 1), 100).catch(() => {});

    // 302, never 301 — browsers permanently cache 301s and stop consulting us,
    // which would silently kill click analytics.
    return reply.redirect(result.originalUrl!, 302);
  });
};

export default redirectRoutes;