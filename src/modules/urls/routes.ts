import { FastifyPluginAsync } from 'fastify';
import { config } from '../../config';
import { createUrlSchema } from './schemas';
import { createShortUrl } from './service';
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
};

export default urlRoutes;