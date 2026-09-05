import { FastifyPluginAsync } from 'fastify';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { redis, withTimeout } from '../../plugins/redis';
import { createUrlSchema } from './schemas';
import { createShortUrl, deleteShortUrl } from './service';
import { requireAuth, rateLimit } from '../auth/middleware';
import { validationError } from '../../lib/httpError';

const urlRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/urls', { preHandler: [requireAuth, rateLimit] }, async (req, reply) => {
    const parsed = createUrlSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const shortUrl = await createShortUrl(parsed.data.url, req.auth!.userId);
    return reply.code(201).send({
      ...shortUrl,
      shortUrl: `${config.BASE_URL}/${shortUrl.shortCode}`,
    });
  });

  app.delete('/api/urls/:code', { preHandler: [requireAuth] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const deleted = await deleteShortUrl(code, req.auth!.userId);
    if (!deleted) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });

  // List the authenticated user's URLs with live click counts (demo dashboard)
  app.get('/api/urls', { preHandler: [requireAuth] }, async (req) => {
    const { rows } = await pool.query<{
      short_code: string;
      original_url: string;
      created_at: Date;
    }>(
      `SELECT short_code, original_url, created_at
         FROM urls
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.auth!.userId],
    );

    // Click counts live in a Redis hash — one read for all codes.
    let clicks: Record<string, string> = {};
    try {
      clicks = await withTimeout(redis.hgetall('stats:clicks'), 100);
    } catch {
      /* stats unavailable → show zeros; links still work */
    }

    return {
      items: rows.map((r) => ({
        shortCode: r.short_code,
        shortUrl: `${config.BASE_URL}/${r.short_code}`,
        originalUrl: r.original_url,
        createdAt: r.created_at.toISOString(),
        clicks: Number(clicks[r.short_code] ?? 0),
      })),
    };
  });
};

export default urlRoutes;